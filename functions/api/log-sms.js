// Cloudflare Pages Function: /api/log-sms
import { createClient } from "@supabase/supabase-js";

export async function onRequestPost(context) {
  const { env, request } = context;

  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), { status: 400, headers: cors });
  }

  // Accept secret key in JSON body (most reliable for iOS Shortcuts)
  // Also accept Authorization header as fallback
  const bodyKey  = (body.key || "").trim();
  const authHdr  = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const token    = bodyKey || authHdr;

  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "No key provided" }), { status: 401, headers: cors });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Look up which user owns this key (multi-user support)
  const { data: keyRow } = await supabase
    .from("user_keys")
    .select("user_id")
    .eq("key_value", token)
    .maybeSingle();

  if (!keyRow) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: cors });
  }

  const userId   = keyRow.user_id;
  const sms      = (body.sms      || "").trim();
  const category = (body.category || "personal").trim().toLowerCase();
  const payMode  = (body.pay_mode || "bank").trim();

  if (!sms) {
    return new Response(JSON.stringify({ ok: false, error: "sms field required" }), { status: 400, headers: cors });
  }

  // Skip non-expense messages (OTP, credit, balance, failed txn)
  if (!isDebitSms(sms)) {
    return new Response(JSON.stringify({ ok: false, error: "Not a debit SMS — skipped", skipped: true }), { status: 422, headers: cors });
  }

  const amount = parseSmsAmount(sms);
  if (!amount) {
    return new Response(JSON.stringify({ ok: false, error: "Could not parse amount", sms }), { status: 422, headers: cors });
  }
  const note = parseSmsNote(sms);

  const catMap = { personal: "personal", work: "work", home: "home", savings: "investment", investment: "investment" };
  const catId  = catMap[category] || "personal";

  const expId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const { error } = await supabase.from("expenses").insert({
    id:       expId,
    user_id:  userId,
    amount,
    note,
    category: catId,
    pay_mode: payMode,
    date:     new Date().toISOString(),
    trip_id:  null,
  });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: cors });
  }

  return new Response(JSON.stringify({ ok: true, amount, note, category: catId, logged_for: userId }), { headers: cors });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

/**
 * Returns false for messages that should NOT be logged as expenses:
 * OTPs, credit/refund SMSes, balance alerts, failed transactions.
 */
function isDebitSms(sms) {
  const s = sms.toLowerCase();

  // Skip OTP / 2FA messages
  if (/\botp\b/.test(s) || /one.time.pass/i.test(s) || /verification\s+code/i.test(s)) return false;

  // Skip "transaction failed" / "declined" messages
  if (/(?:transaction|payment)\s+(?:failed|declined|unsuccessful|not\s+processed)/i.test(sms)) return false;

  // Skip balance alerts with no debit keyword
  if (/available\s+balance/i.test(s) && !/debit|withdrawn|transferred/i.test(s)) return false;

  // Skip credit / refund / reversal messages (where money came IN)
  // Only skip if the primary action is credit — "debited and credited" is a transfer, not an expense
  if (/\bcredited\b/.test(s) && !/debit(?:ed)?/i.test(s)) return false;
  if (/\brefund(?:ed)?\b/.test(s) && !/debit(?:ed)?/i.test(s)) return false;
  if (/\brevers(?:al|ed)\b/.test(s) && !/debit(?:ed)?/i.test(s)) return false;
  if (/money\s+received/i.test(s)) return false;

  // Must contain at least one debit-type keyword
  // "Sent Rs.X" is the HDFC UPI push notification format
  return /debit(?:ed)?|withdrawn|withdrawal|\bsent\b|spent|paid|purchase[d]?|transfer(?:red)?\s+from|payment\s+of|\bemi\b/i.test(sms);
}

/**
 * Extracts the debit amount from Indian bank SMS messages.
 * Handles HDFC (debit card, credit card, UPI, NEFT, IMPS, ATM, EMI, autopay).
 */
function parseSmsAmount(sms) {
  const patterns = [
    // "Rs.250.00" / "INR 1,000" — most common
    /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,

    // "debited with INR 500" / "debited for Rs.80"
    /debit(?:ed)?\s+(?:with|for|of)?\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,

    // "spent Rs.450" / "paid Rs.90 via"
    /(?:spent|paid(?:\s+via)?)\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,

    // "500.00 has been debited" / "1,250 debited"
    /([\d,]+(?:\.\d{1,2})?)\s*(?:INR\s*)?has\s+been\s+debited/i,
    /([\d,]+(?:\.\d{1,2})?)\s+(?:INR\s*)?debited\b/i,

    // "transaction of Rs.1500" / "purchase of INR 200"
    /(?:transaction|purchase)\s+of\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,

    // "INR 2000 transferred from" / "Rs.5000 withdrawn"
    /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)\s+(?:transferred\s+from|withdrawn|debited)/i,

    // "payment of Rs.15000" (credit card bill, utility)
    /payment\s+of\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,

    // "withdrawn Rs.10000 at ATM"
    /withdrawn\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,

    // EMI: "EMI of Rs.2500 due"
    /EMI\s+(?:of|amount)?\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
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

/**
 * Extracts a short payee/merchant description from the SMS.
 * Returns "SMS expense" if nothing parseable is found.
 */
function parseSmsNote(sms) {
  // ATM cash withdrawal
  if (/ATM\s+(?:Cash\s+)?(?:withdrawal|withdraw)|withdrawn\s+at\s+ATM/i.test(sms)) return "ATM Withdrawal";

  // EMI payment
  if (/\bEMI\b/i.test(sms)) {
    const m = sms.match(/(?:loan|card|a\/c)\s+(?:no\.?\s+)?(?:XX)?(\w+)/i);
    return m ? `EMI — ${m[1].toUpperCase()}` : "EMI Payment";
  }

  // Credit card bill payment
  if (/credit\s+card.*payment|payment.*toward.*credit\s+card/i.test(sms)) return "Credit Card Payment";

  // Standing instruction / auto-debit
  if (/standing\s+instruction|auto.?debit|auto.?pay/i.test(sms)) return "Auto-debit";

  const patterns = [
    // UPI/NEFT payee: "to Mr VISHAL BHAGVATILAL JAI on"
    /\bto\s+([A-Za-z][A-Za-z0-9 &\-\.]{2,40}?)(?=\s+on\s|\s+via\s|\s+for\s+UPI|\s+Ref|\s+UPI|\s+A\/c|[,.]|$)/i,

    // Card swipe merchant: "at AMAZON.IN on" or "at SWIGGY via"
    /\bat\s+([A-Za-z][A-Za-z0-9 &\-\.\/]{2,35}?)(?=\s+on\s|\s+via\s|\s+ref|\s+\d{2}|[,.]|$)/i,

    // VPA / UPI ID (e.g., merchant@upi)
    /(?:VPA|UPI\s*[:\-]?\s*)([A-Za-z0-9._-]+@[A-Za-z0-9]+)/i,

    // "toward LOAN / SUBSCRIPTION" etc.
    /\btoward\s+([A-Za-z][A-Za-z0-9 &\-\.]{2,35}?)(?=\s+for|\s+of|\s+on|\s*$)/i,

    // Remarks / Narration / Description fields
    /(?:Remarks|Narration|Description|Info)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9 &\-\/\.]{2,35})/i,
  ];

  for (const pat of patterns) {
    const m = sms.match(pat);
    if (m) {
      const note = m[1].trim().replace(/\s+/g, " ");
      // Skip pure-number results (account numbers, references)
      if (note.length >= 2 && !/^\d+$/.test(note)) return note.slice(0, 50);
    }
  }
  return "SMS expense";
}
