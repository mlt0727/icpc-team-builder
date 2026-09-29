import { NextResponse } from "next/server";
import { ADMIN_COOKIE, ApiError, adminClient, adminConfigured, adminSetupMessage, apiFailure, hasAdminSession, json, loginRateKey, readJson, requireSameOrigin } from "@/lib/admin-server";
import { createAdminToken, passwordMatches, SESSION_SECONDS } from "@/lib/admin-token";

export const runtime = "nodejs";
export async function GET() {
  const configured = adminConfigured();
  return json({ authenticated: await hasAdminSession(), configured, setupMessage: configured ? null : adminSetupMessage() });
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const client = adminClient();
    const body = await readJson(request);
    if (typeof body.password !== "string" || body.password.length > 256) throw new ApiError("Enter your admin password.", 400);
    const { data: allowed, error } = await client.rpc("check_admin_login_limit", { p_key: loginRateKey(request) });
    if (error) throw new ApiError("Couldn't sign in. Check the database setup and try again.", 503);
    if (!allowed) throw new ApiError("Too many attempts. Please wait 15 minutes.", 429);
    if (!passwordMatches(body.password, process.env.ADMIN_PASSWORD!)) throw new ApiError("Incorrect password.", 401);
    const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(ADMIN_COOKIE, createAdminToken(process.env.ADMIN_SESSION_SECRET!, process.env.ADMIN_PASSWORD!), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: SESSION_SECONDS,
    });
    return response;
  } catch (e) { return apiFailure(e); }
}
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
    return response;
  } catch (e) { return apiFailure(e); }
}
