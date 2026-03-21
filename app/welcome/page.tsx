import { redirect } from "next/navigation";

/** Legacy URL: landing page now lives at `/`. */
export default function WelcomeLegacyRedirect() {
  redirect("/");
}
