// Cloudflare Pages Function: /api/log-sms
// iPhone Shortcut posts bank SMS here → parsed → inserted into Supabase

export async function onRequestPost(context) {
  const { env, request } = context;

  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  // Bearer token auth
  const auth = (request.headers.get("Authorization") || "").trim();
  if (auth !== `Bearer ${env.LOG_SMS_SECRET}`) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: cors });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), { status: 400, headers: cors });
  }

  const sms      = (body.sms      || "").trim();
  const category = (body.category || "personal").trim();
  const payMode  = (body.pay_mode || "bank").trim();

  if (!sms) {
    return new Response(JSON.stringify({ ok: false, error: "sms field required" }), { status: 400, headers: cors });
  }

  // ── Parse amount ─────────────────────────────────────────────────────────
  const amount = parseSmsAmount(sms);
  if (!amount) {
    return new Response(JSON.stringify({ ok: false, error: "Could not parse amount", sms }), { status: 422, headers: cors });
  }

  const note = parseSmsNote(sms);

  // ── Insert into Supabase via REST API (bypasses RLS with service key) ────
  const supabaseUrl  = env.SUPABASE_URL;
  const serviceKey   = env.SUPABASE_SERVICE_KEY;
  const ownerUserId  = env.OWNER_USER_ID;

  const expId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const res = await fetch(`${supabaseUrl}/rest/v1/expenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      id:        expId,
      user_id:   ownerUserId,
      amount:    amount,
      note:      note,
      category:  category,
      pay_mode:  payMode,
      date:      new Date().toISOString(),
      trip_id:   null,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(JSON.stringify({ ok: false, error: err }), { status: 500, headers: cors });
  }

  return new Response(JSON.stringify({ ok: true, amount, note, category }), { headers: cors });
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// ── SMS Parsing ──────────────────────────────────────────────────────────────

function parseSmsAmount(sms) {
  // Ordered by specificity — covers HDFC, ICICI, SBI, Axis, Kotak, Paytm, credit cards, UPI
  const patterns = [
    // "Rs.1,234.56" or "Rs 1234" or "INR 1234.56"
    /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
    // "debited for 1234" / "spent 1234"
    /(?:debited(?:\s+for)?|spent|paid(?:\s+via)?)\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    // "1234.56 debited" / "1234 has been debited"
    /([\d,]+(?:\.\d{1,2})?)\s*(?:INR\s*)?has\s+been\s+debited/i,
    /([\d,]+(?:\.\d{1,2})?)\s+(?:INR\s*)?debited/i,
    // "transaction of 1234"
    /transaction\s+of\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    // "purchase of 1234"
    /purchase\s+of\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];

  for (const pat of patterns) {
    const m = sms.match(pat);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (val > 0 && val < 10_000_000) return Math.round(val);
    }
  }
  return null;
}

function parseSmsNote(sms) {
  // Try to extract merchant / payee / UPI handle
  const patterns = [
    // "at MERCHANT NAME on" / "to MERCHANT on"
    /\b(?:at|to)\s+([A-Za-z0-9][A-Za-z0-9 &\-\.]{2,35}?)(?:\s+on\s|\s+via\s|\s+using\s|\s+ref|\s+\d|[.,]|$)/i,
    // UPI VPA: someone@bank
    /(?:VPA|UPI[:\s]+)([A-Za-z0-9._-]+@[A-Za-z0-9]+)/i,
    // "Info: MERCHANT" or "Remarks: MERCHANT"
    /(?:Info|Remarks|Narration|Description)[:\s]+([A-Za-z0-9][A-Za-z0-9 &\-\/\.]{2,35})/i,
    // "credited by SENDER" (for reference)
    /(?:credited\s+by)\s+([A-Za-z0-9][A-Za-z0-9 &\-\.]{2,30})/i,
  ];

  for (const pat of patterns) {
    const m = sms.match(pat);
    if (m) {
      const note = m[1].trim().replace(/\s+/g, " ");
      if (note.length >= 2) return note.slice(0, 50);
    }
  }
  return "SMS expense";
}
