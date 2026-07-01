import "@/components/kite-studio/landing-scoped.css";
import type { Metadata } from "next";
import Link from "next/link";
import { KiteStudioLandingFooter } from "@/components/kite-studio/KiteStudioLandingFooter";

const description =
  "How Kite Studio handles your data: peer-to-peer jam sessions, Supabase authentication, and what we do not store on our servers.";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description,
  openGraph: {
    title: "Privacy Policy | Kite Studio",
    description,
    url: "/privacy",
    type: "website",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-[100dvh] bg-black px-6 py-12 text-white/80">
      <div className="mx-auto max-w-3xl">
        <p className="mb-2 text-sm font-semibold text-[#FF4500]">Kite Studio</p>
        <h1 className="mb-2 text-3xl font-semibold text-white">Privacy Policy</h1>
        <p className="mb-10 text-sm text-white/50">Effective date: June 30, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">1. Who we are</h2>
            <p>
              Kite Studio is a browser-based musical loopstation and real-time collaboration
              platform. If you have questions about this policy or your data, contact us at{" "}
              <a
                href="mailto:supportkite@gmail.com"
                className="text-[#FF4500] underline-offset-2 hover:underline"
              >
                supportkite@gmail.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">2. Scope</h2>
            <p>
              This Privacy Policy applies to Kite Studio when you use our website, progressive web
              app (PWA), and related services (including kitestudiopro.vercel.app). It describes
              how we handle information when you create an account, join a jam room, or use studio
              features.
            </p>
            <p className="mt-3">
              Legacy persistent chat and messaging features have been removed from Kite Studio. This
              policy reflects the current product: live peer-to-peer jam sessions, not server-stored
              chat history.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">
              3. Peer-to-peer sessions (what we do not store)
            </h2>
            <p>
              Kite Studio is built on WebRTC. During a live jam session, audio, video, loop and
              musical data exchanged between participants, and in-session text messages are
              transmitted directly between peers when possible.
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                We do <strong className="text-white">not</strong> record, store, or retain session
                audio, video, loop recordings, or in-session chat transcripts on our servers.
              </li>
              <li>
                Session content exists only on participants&apos; devices for the duration of the
                connection, unless a participant chooses to save something locally outside Kite
                Studio.
              </li>
              <li>
                When direct peer-to-peer connectivity is blocked by a network, encrypted media may
                pass through a third-party TURN relay to complete the connection. Kite Studio does
                not decrypt, log, or persist that relay traffic.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">4. Information we collect</h2>
            <p className="mb-3">We collect and store only what is needed to run the service:</p>
            <ul className="list-disc space-y-3 pl-5">
              <li>
                <strong className="text-white">Account data (Supabase Auth):</strong> email address,
                authentication credentials, session tokens, and related auth cookies required to sign
                in and keep you logged in.
              </li>
              <li>
                <strong className="text-white">Optional profile data:</strong> if you choose to save
                a profile, we may store a nickname, bio, profile picture URL, language preference,
                and similar fields you provide.
              </li>
              <li>
                <strong className="text-white">Connection signaling:</strong> to establish WebRTC
                links, we temporarily store room codes and WebRTC signaling data (such as SDP offers,
                answers, and ICE candidates) in our database. This metadata is used only to connect
                peers and is removed when sessions end.
              </li>
              <li>
                <strong className="text-white">TURN credentials:</strong> when needed, we issue
                short-lived ICE/TURN credentials so your browser can connect through restrictive
                networks. These tokens expire automatically.
              </li>
              <li>
                <strong className="text-white">Local device data:</strong> your browser may store
                language preferences (for example, a language cookie), PWA cache, and other local
                storage on your device.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">5. How we use information</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Authenticate you and maintain your account</li>
              <li>Establish and manage live jam room connections</li>
              <li>Display optional profile information you choose to save</li>
              <li>Improve reliability and security of the service</li>
              <li>Respond to support requests</li>
            </ul>
            <p className="mt-3">
              We do <strong className="text-white">not</strong> sell your personal information.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">6. Third-party services</h2>
            <p className="mb-3">We rely on trusted providers to operate Kite Studio:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-white">Supabase</strong> — authentication and database
                services
              </li>
              <li>
                <strong className="text-white">Vercel</strong> — application hosting
              </li>
              <li>
                <strong className="text-white">TURN/ICE provider</strong> — network relay when
                direct peer-to-peer paths are unavailable (configured via environment variables)
              </li>
            </ul>
            <p className="mt-3">
              The landing page may load fonts from Google Fonts. This privacy page uses only
              on-site styling and does not load external font resources.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">7. Retention and deletion</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                WebRTC signaling rows are kept only as long as needed to establish and maintain a
                session, then cleaned up.
              </li>
              <li>
                Account and profile data are retained while your account is active. You may request
                deletion by contacting{" "}
                <a
                  href="mailto:supportkite@gmail.com"
                  className="text-[#FF4500] underline-offset-2 hover:underline"
                >
                  supportkite@gmail.com
                </a>
                .
              </li>
              <li>
                When an account is deleted, authentication records and associated profile data are
                removed from our systems.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">8. Your rights</h2>
            <p>
              Depending on where you live, you may have rights to access, correct, or delete personal
              information we hold about you. To exercise these rights, email{" "}
              <a
                href="mailto:supportkite@gmail.com"
                className="text-[#FF4500] underline-offset-2 hover:underline"
              >
                supportkite@gmail.com
              </a>
              . We will respond within a reasonable time.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">9. Children</h2>
            <p>
              Kite Studio is not directed at children under 13. We do not knowingly collect personal
              information from children under 13. If you believe a child has provided us personal data,
              contact us and we will take appropriate steps to delete it.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">10. International transfers</h2>
            <p>
              Our service providers may process data in countries other than your own. By using Kite
              Studio, you understand that your information may be transferred to and processed in
              those locations, subject to applicable law and our providers&apos; safeguards.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">11. Changes to this policy</h2>
            <p>
              We may update this Privacy Policy from time to time. When we do, we will revise the
              effective date at the top of this page. Continued use of Kite Studio after changes
              means you accept the updated policy.
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-white/10 pt-8">
          <Link
            href="/"
            className="inline-flex rounded-xl bg-[#FF4500] px-5 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
          >
            Back to Kite Studio
          </Link>
        </div>
      </div>
      <div className="kite-studio-landing">
        <KiteStudioLandingFooter privacyPage />
      </div>
    </main>
  );
}
