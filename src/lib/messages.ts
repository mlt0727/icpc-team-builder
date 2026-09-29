export function friendlyError(error: unknown, fallback = "Couldn't connect. Please try again.") {
  const item = error as { message?: string; code?: string } | null;
  const message = item?.message ?? "";
  const messages: Record<string, string> = {
    TEAM_FULL: "Team is full.",
    AUTH_REQUIRED: "Your session expired. Refresh to reconnect.",
    INVALID_TEAM: "Please choose a valid team.",
    EVENT_CLOSED: "This event is closed. The final teams are still visible.",
    NOT_FOUND: "This participant or event no longer exists.",
    DUPLICATE_NAME: "A name is repeated or already in this event. Check the list.",
    INVALID_NAMES: "Enter one name per line, up to 500 names (100 characters each).",
    INVALID_EVENT: "Check the title, URL, and number of teams.",
    SLUG_TAKEN: "That event URL is already in use. Choose another.",
    EVENT_LIMIT: "An event can contain at most 500 participants.",
  };
  for (const [code, text] of Object.entries(messages)) if (message.includes(code)) return text;
  if (item?.code === "over_request_rate_limit") return "Too many attempts. Please wait a few minutes.";
  if (item?.code === "anonymous_provider_disabled") return "Anonymous sign-in is unavailable. Please contact the organizer.";
  return fallback;
}
