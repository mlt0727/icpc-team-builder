import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_SECONDS = 8 * 60 * 60;

export function passwordMatches(input: string, expected: string) {
  return timingSafeEqual(createHash("sha256").update(input).digest(), createHash("sha256").update(expected).digest());
}

function signature(payload: string, secret: string, password: string) {
  // Changing either environment secret immediately invalidates every cookie.
  const key = createHmac("sha256", secret).update(`icpc-admin:${password}`).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createAdminToken(secret: string, password: string, now = Date.now()) {
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signature(payload, secret, password)}`;
}

export function verifyAdminToken(token: string | undefined, secret: string, password: string, now = Date.now()) {
  if (!token || token.length > 256) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d{10}$/.test(parts[0]) || !/^[\w-]{32}$/.test(parts[1])) return false;
  const expires = Number(parts[0]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + SESSION_SECONDS) return false;
  const expected = signature(`${parts[0]}.${parts[1]}`, secret, password);
  const actual = Buffer.from(parts[2]);
  return actual.length === expected.length && timingSafeEqual(actual, Buffer.from(expected));
}
