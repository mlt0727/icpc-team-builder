import { ApiError, apiFailure, json, namesFrom, readJson, requireAdmin, requireSameOrigin, uuidFrom } from "@/lib/admin-server";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const client = await requireAdmin();
    const id = uuidFrom((await params).id);
    const { data, error } = await client.from("participants").select("*").eq("event_id", id).order("first_name").order("last_name");
    if (error) throw error;
    return json({ participants: data });
  } catch (e) { return apiFailure(e); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    const client = await requireAdmin();
    const id = uuidFrom((await params).id);
    const body = await readJson(request);
    if (body.action === "add") {
      const names = namesFrom(body.names);
      if (!names.length) throw new ApiError("Enter at least one name.", 400);
      const { data, error } = await client.rpc("admin_add_participants", { p_event_id: id, p_names: names });
      if (error) throw error;
      return json({ added: data });
    }
    if (body.action === "set-open" && typeof body.isOpen === "boolean") {
      const { data, error } = await client.from("events").update({ is_open: body.isOpen }).eq("id", id).select().single();
      if (error) throw error;
      return json({ event: data });
    }
    throw new ApiError("Choose a valid action.", 400);
  } catch (e) { return apiFailure(e); }
}
