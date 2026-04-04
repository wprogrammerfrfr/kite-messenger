/**
 * End-to-End Encryption utilities using the Web Crypto API.
 *
 * PRIVACY FOR THERAPIST–PATIENT DATA:
 * - Messages are encrypted on the sender's device and decrypted only on the
 *   recipient's device. The server (and any middleman) never sees plaintext.
 * - Only the recipient's private key can derive the decryption key, so only
 *   they can read the message. This supports confidentiality and HIPAA-style
 *   expectations for sensitive health conversations.
 * - We use ECDH so the shared secret exists only in memory during encrypt/decrypt;
 *   no long-term shared keys are stored. AES-GCM provides authenticated
 *   encryption so tampering is detected.
 */

const ECDH_CURVE = "P-256";
const AES_KEY_LENGTH_BITS = 256;
const GCM_IV_LENGTH_BYTES = 12;
const HKDF_INFO = new TextEncoder().encode("nexus-e2e-aes-gcm-v1");

/** Salt length for PIN-derived backup key (PBKDF2). */
const PIN_BACKUP_SALT_BYTES = 16;
/**
 * PBKDF2 iteration count for PIN backup. 6-digit PINs are low entropy; keep this high.
 * Tune if UX on low-end devices is unacceptable (measure before lowering).
 */
const PIN_BACKUP_PBKDF2_ITERATIONS = 310_000;

/** Result of key pair generation. Keep the private key secure and never share it. */
export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

/**
 * Serialized encrypted message. Can be stored or sent over the network;
 * only the recipient (with their private key) can decrypt it.
 */
export interface EncryptedPayload {
  /** Sender's public key (base64). Recipient uses this with their private key to derive the decryption key. */
  senderPublicKeyBase64: string;
  /** Initialization vector for AES-GCM (base64). Must be unique per encryption. */
  ivBase64: string;
  /** Ciphertext plus GCM auth tag (base64). */
  ciphertextBase64: string;
}

/**
 * Generates a new ECDH P-256 key pair for a user.
 *
 * PRIVACY: Each user (therapist or patient) has their own key pair. The public
 * key can be shared; the private key must be kept secret and used only on
 * devices they control so only they can decrypt messages intended for them.
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: ECDH_CURVE,
    },
    true,
    ["deriveBits"]
  );

  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
  };
}

/**
 * Exports a public key to base64 for storage or sending to other users.
 * Safe to share; it cannot be used to decrypt messages.
 */
export async function exportPublicKeyToBase64(publicKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", publicKey);
  return arrayBufferToBase64(raw);
}

/**
 * Imports a public key from base64 (e.g. from a server or another user).
 */
export async function importPublicKeyFromBase64(base64: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "ECDH", namedCurve: ECDH_CURVE },
    true,
    []
  );
}

/**
 * Exports a private key to base64. Caller must store this securely (e.g.
 * encrypted at rest, only on trusted devices). Never send the private key
 * over the network.
 */
export async function exportPrivateKeyToBase64(privateKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("pkcs8", privateKey);
  return arrayBufferToBase64(raw);
}

/**
 * Imports a private key from base64. Use only with data that was securely
 * stored and never transmitted in cleartext.
 */
export async function importPrivateKeyFromBase64(base64: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    "pkcs8",
    raw,
    { name: "ECDH", namedCurve: ECDH_CURVE },
    true,
    ["deriveBits"]
  );
}

/**
 * Derives a shared secret using ECDH (recipient's public key + sender's private key),
 * then derives an AES-GCM key via HKDF. Only the sender and recipient can derive
 * this key; the server cannot.
 */
async function deriveAesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> {
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: publicKey,
    },
    privateKey,
    AES_KEY_LENGTH_BITS
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new ArrayBuffer(0),
      info: HKDF_INFO,
    },
    aesKey,
    AES_KEY_LENGTH_BITS
  );

  return crypto.subtle.importKey(
    "raw",
    derived,
    { name: "AES-GCM", length: AES_KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a text message for a specific recipient using ECDH + AES-GCM.
 *
 * PRIVACY: The plaintext is encrypted with a key derived from the recipient's
 * public key and the sender's private key. Only the recipient (with their
 * private key) can derive the same key and decrypt. Therapist–patient
 * conversations stay between the two parties; the server only sees opaque
 * ciphertext.
 *
 * @param plaintext - The message to encrypt (e.g. session notes or patient message).
 * @param recipientPublicKey - Recipient's public key (CryptoKey).
 * @param senderPrivateKey - Sender's private key (CryptoKey).
 * @param senderPublicKey - Sender's public key (CryptoKey); included in the payload so the recipient can derive the same shared secret.
 */
export async function encrypt(
  plaintext: string,
  recipientPublicKey: CryptoKey,
  senderPrivateKey: CryptoKey,
  senderPublicKey: CryptoKey
): Promise<EncryptedPayload> {
  const aesKey = await deriveAesKey(senderPrivateKey, recipientPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH_BYTES));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    aesKey,
    encoded
  );

  const senderPublicKeyBase64 = await exportPublicKeyToBase64(senderPublicKey);

  return {
    senderPublicKeyBase64,
    ivBase64: arrayBufferToBase64(iv.buffer),
    ciphertextBase64: arrayBufferToBase64(ciphertext),
  };
}

/**
 * Decrypts a message using the recipient's private key.
 *
 * PRIVACY: Only the holder of the recipient's private key can derive the
 * AES key (using the sender's public key from the payload). This ensures
 * only the intended recipient (therapist or patient) can read the message,
 * keeping the conversation confidential and under their control.
 *
 * @param payload - The encrypted payload (from encrypt()).
 * @param recipientPrivateKey - The recipient's private key (CryptoKey).
 * @returns The original plaintext string.
 */
export async function decrypt(
  payload: EncryptedPayload,
  recipientPrivateKey: CryptoKey
): Promise<string> {
  const senderPublicKey = await importPublicKeyFromBase64(
    payload.senderPublicKeyBase64
  );
  const aesKey = await deriveAesKey(recipientPrivateKey, senderPublicKey);
  const iv = base64ToArrayBuffer(payload.ivBase64);
  const ciphertext = base64ToArrayBuffer(payload.ciphertextBase64);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    aesKey,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * High-level helper to encrypt a plaintext message into a string that can be
 * stored in the database (e.g. in a `content` or `encrypted_content` column).
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: CryptoKey,
  senderKeys: KeyPair
): Promise<string> {
  const payload = await encrypt(
    plaintext,
    recipientPublicKey,
    senderKeys.privateKey,
    senderKeys.publicKey
  );
  return JSON.stringify(payload);
}

/**
 * High-level helper to decrypt a stored encrypted string back into plaintext.
 * If parsing fails or the payload is malformed, the caller should catch and
 * handle the error (e.g. show "[Encrypted Message]").
 */
export async function decryptMessage(
  encrypted: string,
  recipientPrivateKey: CryptoKey
): Promise<string> {
  const payload = JSON.parse(encrypted) as EncryptedPayload;
  return decrypt(payload, recipientPrivateKey);
}

/**
 * Values to store in `profiles.key_backup_salt` and `profiles.encrypted_private_key_backup`.
 * Only salt and ciphertext (IV + AES-GCM output) leave the device; PIN and raw key never do.
 */
export interface PinWrappedPrivateKeyBackup {
  saltBase64: string;
  /** Base64 of IV (12 bytes) concatenated with AES-GCM ciphertext (includes auth tag). */
  encryptedPrivateKeyBackupBase64: string;
}

function normalizePinForBackup(pin: string): string {
  const trimmed = pin.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    throw new Error("PIN must be exactly 6 digits");
  }
  return trimmed;
}

async function deriveAesKeyFromPin(
  pin: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const normalized = normalizePinForBackup(pin);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalized),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PIN_BACKUP_PBKDF2_ITERATIONS,
    },
    keyMaterial,
    AES_KEY_LENGTH_BITS
  );

  return crypto.subtle.importKey(
    "raw",
    derived,
    { name: "AES-GCM", length: AES_KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Wraps the ECDH private key (PKCS#8) with AES-GCM using a key derived from the PIN (PBKDF2).
 * Caller should validate UX (PIN confirmation) before calling.
 */
export async function wrapPrivateKeyWithPin(
  privateKey: CryptoKey,
  pin: string
): Promise<PinWrappedPrivateKeyBackup> {
  normalizePinForBackup(pin);

  const salt = crypto.getRandomValues(new Uint8Array(PIN_BACKUP_SALT_BYTES));
  const aesKey = await deriveAesKeyFromPin(pin, salt);

  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH_BYTES));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    aesKey,
    pkcs8
  );

  const ct = new Uint8Array(ciphertext);
  const combined = new Uint8Array(GCM_IV_LENGTH_BYTES + ct.length);
  combined.set(iv, 0);
  combined.set(ct, GCM_IV_LENGTH_BYTES);

  return {
    saltBase64: uint8ArrayToBase64(salt),
    encryptedPrivateKeyBackupBase64: uint8ArrayToBase64(combined),
  };
}

/**
 * Decrypts a PIN backup and imports the ECDH private key. Wrong PIN or tampered data throws.
 */
export async function unwrapPrivateKeyWithPin(
  encryptedPrivateKeyBackupBase64: string,
  saltBase64: string,
  pin: string
): Promise<CryptoKey> {
  normalizePinForBackup(pin);

  const salt = base64ToUint8Array(saltBase64);
  if (salt.length < 8) {
    throw new Error("Invalid backup salt");
  }

  const combined = base64ToUint8Array(encryptedPrivateKeyBackupBase64);
  if (combined.length < GCM_IV_LENGTH_BYTES + 16) {
    throw new Error("Invalid encrypted backup");
  }

  const iv = combined.subarray(0, GCM_IV_LENGTH_BYTES);
  const ciphertext = combined.subarray(GCM_IV_LENGTH_BYTES);

  const aesKey = await deriveAesKeyFromPin(pin, salt);

  const pkcs8 = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    aesKey,
    ciphertext
  );

  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "ECDH", namedCurve: ECDH_CURVE },
    true,
    ["deriveBits"]
  );
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  return arrayBufferToBase64(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
}

function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(base64ToArrayBuffer(base64));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
