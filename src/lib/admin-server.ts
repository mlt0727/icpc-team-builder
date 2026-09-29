import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { verifyAdminToken } from "./admin-token";
import { friendlyError } from "./messages";
import { normalizeServerKey, serverKeyKind } from "./supabase-server-key";
import type { Database } from "./types";

export const ADMIN_COOKIE = "icpc_admin_session";
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function adminConfigured() {
  const kind = serverKeyKind(process.env.SUPABASE_SECRET_KEY);
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (kind === "secret" || kind === "service_role") &&
    (process.env.ADMIN_PASSWORD?.length ?? 0) >= 8 &&
    (process.env.ADMIN_PASSWORD?.length ?? 0) <= 256 &&
    (process.env.ADMIN_SESSION_SECRET?.length ?? 0) >= 32;
}

export function adminSetupMessage() {
  const kind = serverKeyKind(process.env.SUPABASE_SECRET_KEY);
  if (kind === "missing") return "SUPABASE_SECRET_KEY is missing. Add the Secret key from Supabase Settings > API Keys to Vercel, then redeploy. This key is separate from your admin password.";
  if (kind === "public") return "SUPABASE_SECRET_KEY contains a public key. Replace it with the Supabase Secret key (sb_secret_) or legacy service_role key, then redeploy.";
  if (kind === "invalid") return "SUPABASE_SECRET_KEY is present, but its value is not a Supabase server API key. Copy the Secret key (sb_secret_) or legacy service_role key from Supabase Settings > API Keys. Do not use your admin password, database password, or JWT signing secret. Save it in Vercel and redeploy.";
  return "Admin configuration is incomplete. Check the project URL, admin password, and session secret in Vercel, then redeploy.";
}

export function adminClient() {
  if (!adminConfigured()) throw new ApiError(adminSetupMessage(), 503);
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, normalizeServerKey(process.env.SUPABASE_SECRET_KEY), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    }) },
  });
}

export async function hasAdminSession() {
  if (!adminConfigured()) return false;
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return verifyAdminToken(token, process.env.ADMIN_SESSION_SECRET!, process.env.ADMIN_PASSWORD!);
}

export async function requireAdmin() {
  if (!await hasAdminSession()) throw new ApiError("Please sign in again.", 401);
  return adminClient();
}

export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new ApiError("This request is not allowed.", 403);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError("Use a JSON request.", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("The request is empty.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new ApiError("This request is too large.", 413); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ApiError("Check the form and try again.", 400); }
}

export function namesFrom(value: unknown) {
  if (typeof value !== "string") throw new ApiError("Enter one name per line.", 400);
  const names = value.split(/\r?\n/).map((name) => name.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (names.length > 500 || names.some((name) => name.length > 100)) throw new ApiError("Use up to 500 names, at most 100 characters each.", 400);
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new ApiError("Remove duplicate names before saving.", 400);
  return names;
}

export function uuidFrom(value: unknown) {
  if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) throw new ApiError("Choose a valid event or participant.", 400);
  return value;
}

export function loginRateKey(request: Request) {
  // Vercel overwrites x-vercel-forwarded-for at its trusted ingress. Do not
  // trust client-supplied x-forwarded-for; local/non-Vercel hosting shares a bucket.
  const address = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown" : "local";
  return createHash("sha256").update(`${process.env.ADMIN_SESSION_SECRET}:${address}`).digest("hex");
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiFailure(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  return json({ error: friendlyError(error, "Couldn't save this change. Please try again.") }, 400);
}
