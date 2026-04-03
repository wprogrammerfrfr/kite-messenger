"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const newPassword = password.trim();
    if (!newPassword) {
      setError("Please enter a new password.");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        setError(updateError.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push("/chat");
        }, 2000);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/70 shadow-2xl shadow-black/50 backdrop-blur-xl p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-2">
          Reset Your Password
        </h1>
        <p className="text-sm text-neutral-400 text-center mb-8">
          Choose a new password for your account.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <div className="space-y-1.5">
            <label
              htmlFor="new-password"
              className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400"
            >
              New password
            </label>
            <input
              id="new-password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={success}
              className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 outline-none ring-0 transition focus:border-white/40 focus:ring-2 focus:ring-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div
              className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
              role="alert"
            >
              {error}
            </div>
          )}

          {success && (
            <div
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"
              role="status"
            >
              Password updated. Redirecting you to chat…
            </div>
          )}

          <button
            type="submit"
            disabled={loading || success}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-lg shadow-black/40 transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Updating…" : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
