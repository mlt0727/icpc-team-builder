import { ApiError, apiFailure, json, namesFrom, readJson, requireAdmin, requireSameOrigin } from "@/lib/admin-server";

export async function GET() {
  try {
    const client = await requireAdmin();
    const { data, error } = await client.from("events").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return json({ events: data });
  } catch (e) { return apiFailure(e); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const client = await requireAdmin();
    const body = await readJson(request);
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 100 ||
        typeof body.slug !== "string" || body.slug.length < 3 || body.slug.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.slug) ||
        typeof body.teamCount !== "number" || !Number.isInteger(body.teamCount) || body.teamCount < 1 || body.teamCount > 50) throw new ApiError("Check the title, URL, and team count (1–50).", 400);
    const { data, error } = await client.rpc("admin_create_event", {
      p_title: body.title.trim(), p_slug: body.slug, p_team_count: body.teamCount, p_names: namesFrom(body.names),
    });
    if (error) throw error;
    return json({ event: data }, 201);
  } catch (e) { return apiFailure(e); }
}
