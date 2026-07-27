// Redaction module for the SMS training-sample feature. NOT a route — no onRequest*
// exports, not registered in src/worker.js's API_ROUTES. Imported by log-sms.js only.
//
// Deliberately independent from parseSmsAmount/parseSmsNote in log-sms.js: this module
// must keep working on messages the main parser currently fails on (that's the whole
// point of the training corpus), and must not be weakened by future changes to parsing
// logic made for accuracy reasons rather than safety reasons.
//
// Design: redact every digit run and VPA local-part with a shape-preserving placeholder,
// then fail closed via an ALLOW-ONLY-KNOWN-GOOD check — strip every recognized-safe
// element (safe words, placeholder runs, whitespace, allowed punctuation) out of what's
// left, and refuse to sample if ANYTHING survives that pass. This is deliberately not
// "flag known-bad words": an only-reject-bad-ASCII-words scan would silently let non-Latin
// script (a Devanagari/Gujarati name, say) straight through, since it never matches an
// ASCII word pattern in the first place and so is never flagged as suspicious — the
// allow-only-known-good direction fails closed on ANYTHING unrecognized by construction,
// scripts included, because unrecognized text simply can't be stripped out.
//
// This is intentionally conservative — formats with free-text beneficiary names (e.g.
// SBI-style NEFT SMS) will usually be refused rather than sampled. Under-collecting is
// the safe failure mode here; leaking a name is not.

const SAFE_WORDS = new Set([
  // Bank names / aliases
  "hdfc", "icici", "sbi", "axis", "kotak", "indusind", "idfc", "first", "yes",
  "pnb", "bob", "federal", "canara", "union", "boi", "dcb", "bank", "state", "punjab",
  "national", "baroda", "india",
  // Transaction vocabulary
  "txn", "transaction", "spent", "debit", "debited", "withdrawn", "withdrawal",
  "transferred", "transfer", "paid", "payment", "purchase", "purchased", "sent",
  "received", "credited", "charged", "used",
  // Structural / boilerplate
  "on", "at", "to", "from", "using", "card", "credit", "account", "acc", "acct",
  "ac", "by", "upi", "vpa", "ref", "info", "avl", "lmt", "limit", "available",
  "balance", "bal", "not", "you", "call", "sms", "block", "cc", "dispute", "emi",
  "neft", "imps", "rtgs", "standing", "instruction", "auto", "pay", "top", "up",
  "lite", "amounting", "amount", "rs", "inr", "rupees", "dear", "customer",
  "alert", "money", "towards", "remarks", "narration", "description", "your",
  "a", "of", "is", "the", "for", "was", "has", "have", "been", "with", "please",
  "thank", "thanks", "regards", "atm", "cash", "withdrawal", "wdl", "location",
  "near", "branch", "dispute", "if", "immediately", "report", "fraud", "help",
  "support", "utr", "rrn", "type", "mode", "successful", "success", "confirmed",
  "confirmation", "processed", "pending", "id", "no", "number", "new", "old",
  "current", "savings", "pos", "ecom", "ending", "via",
  // Placeholder token this module inserts itself
  "vpa",
]);

const DATE_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
DATE_MONTHS.forEach(m => SAFE_WORDS.add(m));

// Curated, deliberately non-exhaustive list of high-frequency Indian merchant/payment-app
// names. These are NOT personal information — a chain name doesn't reveal which user sent
// the SMS — so allow-listing them doesn't weaken the fail-closed guarantee below: an actual
// personal name (e.g. an NEFT beneficiary) is still never on this list and still trips the
// residue check exactly as before. This list will always miss real merchants; that's fine,
// under-collecting is the safe failure mode (see module header). Expand as needed, but
// never add anything here that could be a person's name rather than a brand.
const SAFE_MERCHANTS = [
  "swiggy", "zomato", "amazon", "flipkart", "uber", "ola", "rapido", "myntra",
  "ajio", "nykaa", "meesho", "bigbasket", "blinkit", "zepto", "dunzo",
  "phonepe", "paytm", "gpay", "googlepay", "irctc", "netflix", "spotify",
  "hotstar", "dominos", "mcdonalds", "starbucks", "bookmyshow", "makemytrip",
  "airtel", "jio", "vodafone",
];
SAFE_MERCHANTS.forEach(m => SAFE_WORDS.add(m));

/**
 * Redacts a raw SMS for the training corpus. Returns { ok: false, redacted: null } if
 * the message contains any free-text span this module can't confidently redact — the
 * caller must not store `redacted` unless `ok` is true.
 */
export function redactSms(sms) {
  if (!sms || typeof sms !== "string") return { ok: false, redacted: null };

  let text = sms;

  // 1. Shape-preserving digit-run redaction — same-length "X" run.
  // Covers amounts ("Rs.80.00" -> "Rs.XX.XX"), last4/account digits, dates
  // ("15-07" -> "XX-XX"), phone numbers, and reference/UTR numbers uniformly.
  // \d+ (not \d{2,}): a single-digit amount ("Rs.2 debited") is still an amount —
  // leaving lone digits unredacted meant they survived as unexplained residue in
  // the safety check below and wrongly refused an otherwise-clean message.
  text = text.replace(/\d+/g, (m) => "X".repeat(m.length));

  // 2. VPA handling — keep the @domain (a fixed, NPCI-assigned PSP handle suffix
  // like @ybl/@paytm/@rzp, shared across many users' VPAs, never arbitrary personal
  // text), replace the local part. The domain must NOT enter the safety scan below
  // (step 3) as free text — it's pulled out and reinserted after the scan passes,
  // rather than allowlisted, since new PSP suffixes appear over time and an
  // allowlist would silently fail-closed on legitimate ones.
  const vpaDomains = [];
  const scanText = text.replace(/\b[A-Za-z0-9][A-Za-z0-9._-]*@([A-Za-z0-9.]+)\b/g, (_, domain) => {
    vpaDomains.push(domain);
    return "vpa";
  });

  // 3. Fail-closed check, allow-only-known-good: strip every recognized-safe element
  // out of scanText — safe words (whole-word, case-insensitive), our own "X"/"vpa"
  // placeholder runs, whitespace, and a small set of structural punctuation. If
  // anything survives that pass, we can't guarantee it's free of a real name or an
  // unrecognized string in any script — refuse to sample this message. Unlike a
  // reject-known-bad-words scan, this fails closed on non-Latin script too: those
  // characters simply don't match any of the "safe" patterns below, so they're never
  // stripped and always trip the final length check.
  //
  // "a/c" (and "a / c") is normalized to "account" for THIS check only — word-boundary
  // matching would otherwise split it into orphan single-character tokens ("a", "c") on
  // either side of the slash, and a bare "c" trips the residue check even though "a/c" is
  // just the extremely common bank abbreviation for "account". This does not touch `text`
  // (the string that gets stored), so a sampled message keeps "a/c" in its original shape.
  const normalizedForCheck = scanText.replace(/\ba\s*\/\s*c\b/gi, "account");
  const safeWordPattern = new RegExp(`\\b(${[...SAFE_WORDS].join("|")})\\b`, "gi");
  const residue = normalizedForCheck
    .replace(safeWordPattern, "")
    // Case-insensitive: some banks mask with lowercase "x" (HDFC: "Card x8812"), which after
    // digit-run redaction (step 1) leaves a mixed-case token like "xXXXX" — a case-sensitive
    // X+ here would miss it (no word boundary between the leading lowercase "x" and the
    // uppercase run), leaving it as unexplained residue and wrongly refusing the message.
    .replace(/\b(?:X+|vpa)\b/gi, "")
    // "*" included: DCB and others mask with asterisks ("a/c*3272"), same structural role as X.
    .replace(/[\s.,:;\-/@?!'"()&*]/g, "");
  if (residue.length > 0) {
    return { ok: false, redacted: null };
  }

  // 4. Scan passed — rebuild the output with real domains restored.
  let domainIdx = 0;
  const redacted = text.replace(/\b[A-Za-z0-9][A-Za-z0-9._-]*@([A-Za-z0-9.]+)\b/g, () => "vpa@" + vpaDomains[domainIdx++]);

  return { ok: true, redacted };
}
