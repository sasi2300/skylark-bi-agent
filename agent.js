import fetch from "node-fetch";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function askGemini(prompt) {
  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

export async function answerQuery(question, dealRows, workOrderRows, warnings) {
  const prompt = `
You are a business intelligence assistant for Skylark Drones.
You have two data sources:

DEALS (sales pipeline): ${JSON.stringify(dealRows).slice(0, 6000)}
WORK ORDERS (project execution): ${JSON.stringify(workOrderRows).slice(0, 6000)}

Known data quality issues: ${warnings.slice(0, 5).join("; ") || "none"}

User question: "${question}"

Answer the question directly using only the data above. If the question is
too ambiguous to answer confidently, ask ONE clarifying question instead of
guessing. Mention any relevant data caveats briefly at the end. Keep the
answer concise.
`;

  const answer = await askGemini(prompt);
  return { answer, caveats: warnings.slice(0, 3) };
}
