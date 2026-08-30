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
  return JSON.parse(cleaned);
}

// ---- Generic, reusable data operations (no business logic baked in) ----

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
    const key = row[field] ?? "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sumField(rows, field, filters = {}) {
  const subset = rows.filter((r) => matchesFilters(r, filters));
  const total = subset.reduce((sum, row) => sum + (parseFloat(row[field]) || 0), 0);
  return { total, matchedRows: subset.length };
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

// ---- Step 1: ask the LLM to produce a query spec, not an answer ----

async function generateSpec(question, dealFields, woFields) {
  const prompt = `
You are a query planner for a business intelligence agent with two datasets:

DEALS fields available: ${JSON.stringify(dealFields)}
WORK ORDERS fields available: ${JSON.stringify(woFields)}

User question: "${question}"

Respond with ONLY a JSON object (no markdown, no explanation) in ONE of these two shapes:

1. If the question is too ambiguous to answer confidently (e.g. unclear time period, unclear which board, unclear metric), respond:
{ "clarify": "your one clarifying question here" }

2. Otherwise, respond with an operation to run:
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
  const targetRows =
    spec.board === "workOrders" ? workOrderRows : spec.board === "both" ? [...dealRows, ...workOrderRows] : dealRows;

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

// ---- Step 2: ask the LLM to phrase the answer using the real result ----

async function phraseAnswer(question, result, warnings) {
  const prompt = `
You are a business intelligence assistant for Skylark Drones.

User question: "${question}"

EXACT computed result (trust this completely, do not recalculate): ${JSON.stringify(result)}

Known data quality issues: ${warnings.slice(0, 5).join("; ") || "none"}

Write a concise, natural-language answer using the exact result above. Add brief context/insight where helpful. Mention relevant data caveats briefly at the end if any apply.
`;
  return askGemini(prompt);
}

// ---- Main entry point ----

export async function answerQuery(question, dealRows, workOrderRows, warnings) {
  const dealFields = getFieldNames(dealRows);
  const woFields = getFieldNames(workOrderRows);

  let spec;
  try {
    spec = await generateSpec(question, dealFields, woFields);
  } catch (e) {
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
    return {
      answer: `I understood the question but hit an issue computing the answer (${e.message}). Could you rephrase it?`,
      caveats: warnings.slice(0, 3),
    };
  }

  const answer = await phraseAnswer(question, result, warnings);
  return { answer, caveats: warnings.slice(0, 3) };
}
