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

function summarizeDeals(dealRows) {
  const byStatus = {};
  const bySector = {};
  let totalValue = 0;

  for (const row of dealRows) {
    const status = row["Deal Status"] || "Unknown";
    const sector = row["Sector/Service"] || row["Sector / Service"] || "Unknown";
    const value = parseFloat(row["Masked Deal value"] || row["Deal Value"]) || 0;

    byStatus[status] = (byStatus[status] || 0) + 1;
    bySector[sector] = (bySector[sector] || 0) + 1;
    totalValue += value;
  }

  return { byStatus, bySector, totalValue, totalDeals: dealRows.length };
}


export async function answerQuery(question, dealRows, workOrderRows, warnings) {
  const dealsSummary = summarizeDeals(dealRows);

  const prompt = `
You are a business intelligence assistant for Skylark Drones.

PRE-CALCULATED DEAL STATISTICS (these numbers are exact — use them, do not recount):
- Total deals: ${dealsSummary.totalDeals}
- Deals by status: ${JSON.stringify(dealsSummary.byStatus)}
- Deals by sector: ${JSON.stringify(dealsSummary.bySector)}
- Total deal value (sum): ${dealsSummary.totalValue}

Sample deal records for context (not exhaustive): ${JSON.stringify(dealRows.slice(0, 20))}
WORK ORDERS (project execution) sample: ${JSON.stringify(workOrderRows.slice(0, 20))}

Known data quality issues: ${warnings.slice(0, 5).join("; ") || "none"}

User question: "${question}"

Answer using the PRE-CALCULATED STATISTICS for any counts, totals, or aggregates —
never count or sum from the sample records yourself. Use the sample records only
for qualitative context (e.g. specific deal names, patterns). If the question is
too ambiguous, ask ONE clarifying question. Mention relevant data caveats briefly.
`;

  const answer = await askGemini(prompt);
  return { answer, caveats: warnings.slice(0, 3) };
}
