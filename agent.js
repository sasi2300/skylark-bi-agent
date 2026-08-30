import fetch from "node-fetch";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

async function askGemini(prompt, attempt = 1) {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (res.status === 503 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500));
    return askGemini(prompt, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status}`);
  }

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object found in: ${cleaned.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

// ---------------------------------------------------------------------
// Generic, reusable data operations — no business logic baked in, so
// these work for any question shape, not just ones anticipated in advance.
// ---------------------------------------------------------------------

function matchesFilters(row, filters = {}) {
  return Object.entries(filters).every(([key, val]) => {
    const rowVal = row[key];
    if (rowVal == null) return false;
    return String(rowVal).toLowerCase().includes(String(val).toLowerCase());
  });
}

function groupByCount(rows, field, filters = {}) {
  const subset = rows.filter((r) => matchesFilters(r, filters));
  const counts = {};
  for (const row of subset) {
    // Missing values get their own honest "Unknown" bucket rather than
    // being silently dropped from the total.
    const key = row[field] ?? "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// Missing/non-numeric values are excluded from the sum (not treated as 0
// contributing rows) and reported separately, so a total never silently
// understates itself without saying how much of the dataset it covers.
function sumField(rows, field, filters = {}) {
  const subset = rows.filter((r) => matchesFilters(r, filters));
  let total = 0;
  let missingValueRows = 0;

  for (const row of subset) {
    const raw = row[field];
    const val = parseFloat(raw);
    if (raw == null || isNaN(val)) {
      missingValueRows++;
    } else {
      total += val;
    }
  }

  return {
    total,
    matchedRows: subset.length,
    rowsWithValue: subset.length - missingValueRows,
    missingValueRows,
  };
}

function countRows(rows, filters = {}) {
  return rows.filter((r) => matchesFilters(r, filters)).length;
}

function sampleRows(rows, filters = {}, limit = 10) {
  return rows.filter((r) => matchesFilters(r, filters)).slice(0, limit);
}

function getFieldNames(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter((k) => k !== "id");
}

// "Leadership updates" interpretation: a compact, pre-aggregated snapshot
// across both boards — status/sector breakdowns and totals — suitable for
// a founder-level digest rather than a raw data dump. See Decision Log.
function leadershipSummary(dealRows, workOrderRows) {
  return {
    deals: {
      total: dealRows.length,
      byStatus: groupByCount(dealRows, "Deal Status"),
      bySector: groupByCount(dealRows, "Sector/Service"),
      value: sumField(dealRows, "Masked Deal value"),
    },
    workOrders: {
      total: workOrderRows.length,
      byExecutionStatus: groupByCount(workOrderRows, "Execution Status"),
      bySector: groupByCount(workOrderRows, "Sector"),
      billedValue: sumField(
        workOrderRows,
        "Billed Value in Rupees (Excl of GST.) (Masked)"
      ),
    },
  };
}

// ---------------------------------------------------------------------
// Step 1: ask the LLM to produce a query SPEC (an instruction), not an
// answer directly. This keeps exact counting/summing in deterministic
// code and reserves the LLM for understanding intent + phrasing.
// ---------------------------------------------------------------------

async function generateSpec(question, dealFields, woFields) {
  const prompt = `
You are a query planner for a business intelligence agent with two datasets:

DEALS fields available: ${JSON.stringify(dealFields)}
WORK ORDERS fields available: ${JSON.stringify(woFields)}

User question: "${question}"

Respond with ONLY a JSON object (no markdown, no explanation) in ONE of these shapes:

1. If the question is too ambiguous to answer confidently (unclear time period, unclear board, unclear metric), respond:
{ "clarify": "your one clarifying question here" }

2. If the question asks for a general leadership/executive/status update or summary (not a specific single metric), respond:
{ "operation": "leadershipSummary" }

3. Otherwise, respond with a specific operation:
{
  "board": "deals" | "workOrders" | "both",
  "operation": "groupByCount" | "sumField" | "countRows" | "sampleRows",
  "field": "exact field name from the list above (required for groupByCount and sumField)",
  "filters": { "fieldName": "value to match, case-insensitive substring" }
}

Only use field names that exactly match the lists above. Use filters to scope by sector, status, etc. when the question implies it.
`;
  const raw = await askGemini(prompt);
  return parseJsonLoose(raw);
}

function runSpec(spec, dealRows, workOrderRows) {
  if (spec.operation === "leadershipSummary") {
    return leadershipSummary(dealRows, workOrderRows);
  }

  const targetRows =
    spec.board === "workOrders"
      ? workOrderRows
      : spec.board === "both"
      ? [...dealRows, ...workOrderRows]
      : dealRows;

  switch (spec.operation) {
    case "groupByCount":
      return groupByCount(targetRows, spec.field, spec.filters || {});
    case "sumField":
      return sumField(targetRows, spec.field, spec.filters || {});
    case "countRows":
      return countRows(targetRows, spec.filters || {});
    case "sampleRows":
      return sampleRows(targetRows, spec.filters || {});
    default:
      throw new Error(`Unknown operation: ${spec.operation}`);
  }
}

// ---------------------------------------------------------------------
// Step 2: ask the LLM to phrase the answer using the real, exact result.
// ---------------------------------------------------------------------

async function phraseAnswer(question, result, warnings) {
  const prompt = `
You are a business intelligence assistant for Skylark Drones.

User question: "${question}"

EXACT computed result (trust this completely, do not recalculate): ${JSON.stringify(result)}

Known data quality issues: ${warnings.slice(0, 5).join("; ") || "none"}

Write a concise, natural-language answer using the exact result above. If a
sum includes "missingValueRows" or "rowsWithValue", mention how many records
the total actually covers (e.g. "based on 165 of 346 records with a recorded
value") rather than presenting the total as if it covered everything. Add
brief context/insight where helpful. Mention relevant data caveats briefly
at the end if any apply.
`;
  return askGemini(prompt);
}

// ---------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------

export async function answerQuery(question, dealRows, workOrderRows, warnings) {
  const dealFields = getFieldNames(dealRows);
  const woFields = getFieldNames(workOrderRows);

  let spec;
  try {
    spec = await generateSpec(question, dealFields, woFields);
  } catch (e) {
    console.error("Spec generation failed:", e.message);
    return {
      answer: "I had trouble understanding that question — could you rephrase it?",
      caveats: warnings.slice(0, 3),
    };
  }

  if (spec.clarify) {
    return { answer: spec.clarify, caveats: [] };
  }

  let result;
  try {
    result = runSpec(spec, dealRows, workOrderRows);
  } catch (e) {
    console.error("Spec execution failed:", e.message, JSON.stringify(spec));
    return {
      answer: `I understood the question but hit an issue computing the answer (${e.message}). Could you rephrase it?`,
      caveats: warnings.slice(0, 3),
    };
  }

  const answer = await phraseAnswer(question, result, warnings);
  return { answer, caveats: warnings.slice(0, 3) };
}
