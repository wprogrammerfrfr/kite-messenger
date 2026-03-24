import { redirect } from "next/navigation";

/** Dashboard is the in-app home; it lives at `/chat` with no active thread. */
export default function DashboardRedirect() {
  redirect("/chat");
}
