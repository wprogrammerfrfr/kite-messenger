import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type Body = {
  endpoint?: string;
  p256dh?: string;
  auth?: string;
};

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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof body.p256dh === "string" ? body.p256dh.trim() : "";
  const auth = typeof body.auth === "string" ? body.auth.trim() : "";

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Missing subscription keys" }, { status: 400 });
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { error: upsertErr } = await userClient.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
    },
    { onConflict: "endpoint" }
  );

  if (upsertErr) {
    return NextResponse.json(
      { error: upsertErr.message ?? "Failed to save subscription" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
