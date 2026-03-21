"use client";

export function SammyNote() {
  return (
    <div
      style={{
        background: "#FFF7D6",
        border: "3px solid #FF4500",
        borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        padding: 16,
        transform: "rotate(-1.2deg)",
        maxWidth: 420,
      }}
      aria-label="Sammy's plea note"
    >
      <div
        style={{
          fontFamily:
            '"Bradley Hand", "Segoe Print", "Comic Sans MS", "Marker Felt", system-ui, -apple-system, sans-serif',
          fontWeight: 800,
          color: "#000",
          fontSize: 18,
          letterSpacing: 0.2,
        }}
      >
        PLZ USE MY APP!
      </div>

      <ol
        style={{
          margin: "10px 0 12px 18px",
          padding: 0,
          color: "#000",
          fontFamily:
            '"Bradley Hand", "Segoe Print", "Comic Sans MS", "Marker Felt", system-ui, -apple-system, sans-serif',
          fontSize: 14,
          lineHeight: 1.4,
        }}
      >
        <li>1. i made it very securely, plz (trust me plz).</li>
        <li>2. its literally my app so i wont sell your messages to facebook or openAI.</li>
        <li>3. if u find a bug u didnt thats a feature (if its a big bug plz private message me tho).</li>
        <li>4. u can also use it when u in the mountains and low connection.</li>
      </ol>

      <div
        style={{
          color: "#000",
          fontFamily:
            '"Bradley Hand", "Segoe Print", "Comic Sans MS", "Marker Felt", system-ui, -apple-system, sans-serif',
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        love, your fav (and only) kite developer Sammy
      </div>
    </div>
  );
}

