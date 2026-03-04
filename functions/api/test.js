// Quick test/debug endpoint
import { createClient } from "@supabase/supabase-js";

export async function onRequestGet(context) {
  const { env } = context;
  return new Response(JSON.stringify({
    ok: true,
    message: "Function is reachable",
  }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try { body = await request.json(); } catch {}
  const bodyKey = (body.key || "").trim();
  const authHdr = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const token   = bodyKey || authHdr;

  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "No key sent" }), { headers });
  }

  // Try to look up key in user_keys table
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: keyRow, error: keyErr } = await supabase
    .from("user_keys")
    .select("user_id, key_value, label")
    .eq("key_value", token)
    .maybeSingle();

  // Also fetch last 3 expenses for that user (if key found)
  let recentExpenses = [];
  if (keyRow) {
    const { data } = await supabase
      .from("expenses")
      .select("id, amount, note, date, user_id")
      .eq("user_id", keyRow.user_id)
      .order("date", { ascending: false })
      .limit(3);
    recentExpenses = data || [];
  }

  return new Response(JSON.stringify({
    ok: true,
    received_key: token,
    key_found_in_db: !!keyRow,
    key_lookup_error: keyErr?.message || null,
    user_id: keyRow?.user_id || null,
    label: keyRow?.label || null,
    recent_expenses_count: recentExpenses.length,
    recent_expenses: recentExpenses,
    body_fields: Object.keys(body),
  }), { headers });
}
