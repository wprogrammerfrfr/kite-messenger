import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/** Deletes all push_subscriptions rows for the authenticated user. */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }

  const ac = createClient(url, anon);
  const {
    data: { user },
    error: userErr,
  } = await ac.auth.getUser(token);

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { error: delErr } = await userClient
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id);

  if (delErr) {
    console.error("[push/purge]", delErr.message, delErr);
    return NextResponse.json(
      { error: delErr.message ?? "Failed to purge subscriptions" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
