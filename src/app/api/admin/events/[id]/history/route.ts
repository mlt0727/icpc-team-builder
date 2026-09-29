import { ApiError, apiFailure, json, requireAdmin, uuidFrom } from "@/lib/admin-server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const client = await requireAdmin();
    const id = uuidFrom((await params).id);
    const cursor = new URL(request.url).searchParams.get("before");
    if (cursor && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) < 1)) throw new ApiError("Invalid history page.", 400);
    let query = client.from("team_departures").select("*").eq("event_id", id).order("id", { ascending: false }).limit(100);
    if (cursor) query = query.lt("id", Number(cursor));
    const { data, error } = await query;
    if (error) throw error;
    return json({ history: data, nextCursor: data.length === 100 ? data[data.length - 1].id : null });
  } catch (e) { return apiFailure(e); }
}
