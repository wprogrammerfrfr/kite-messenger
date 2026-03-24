import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type Body = {
  endpoint?: string | null;
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

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const ep =
    typeof body.endpoint === "string" && body.endpoint.trim().length > 0
      ? body.endpoint.trim()
      : null;

  if (ep) {
    await userClient
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", ep);
  } else {
    await userClient.from("push_subscriptions").delete().eq("user_id", user.id);
  }

  return NextResponse.json({ ok: true });
}
