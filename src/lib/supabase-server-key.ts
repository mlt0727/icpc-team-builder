export function normalizeServerKey(value: string | undefined) {
  const key = value?.trim() ?? "";
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) return key.slice(1, -1).trim();
  return key;
}

// This checks configuration format, not authenticity. Supabase validates the
// credential on every server request; no privileged key is sent to the client.
export function serverKeyKind(value: string | undefined): "secret" | "service_role" | "public" | "missing" | "invalid" {
  const key = normalizeServerKey(value);
  if (!key) return "missing";
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return "secret";
  if (key.startsWith("sb_publishable_")) return "public";
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") return "service_role";
      if (payload.role === "anon" || payload.role === "authenticated") return "public";
    } catch { /* Malformed environment values are reported as invalid. */ }
  }
  return "invalid";
}
