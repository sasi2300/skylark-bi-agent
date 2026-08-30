// Very simple intent + filter matcher so the agent works with zero API keys.
// Swap this out for an LLM call later without touching mondayClient/normalize.

export function answerQuery(question, dealRows, workOrderRows, warnings) {
  const q = question.toLowerCase();
  let scope = [];
  let scopeName = "";

  if (q.includes("deal") || q.includes("pipeline") || q.includes("revenue") || q.includes("sales")) {
    scope = dealRows;
    scopeName = "Deals";
  } else if (q.includes("work order") || q.includes("project") || q.includes("execution")) {
    scope = workOrderRows;
    scopeName = "Work Orders";
  } else {
    return {
      answer:
        "I can answer about Deals (pipeline/revenue/sales) or Work Orders (project execution). Which are you asking about?",
      caveats: [],
    };
  }

  // naive keyword filter across all fields
  const keywords = q
    .replace(/[^a-z0-9\s]/g, "")
    .split(" ")
    .filter((w) => w.length > 3);

  const matches = scope.filter((row) =>
    keywords.some((kw) =>
      Object.values(row).some((v) => typeof v === "string" && v.toLowerCase().includes(kw))
    )
  );

  if (matches.length === 0) {
    return {
      answer: `I couldn't find matching records in ${scopeName} for that query. Could you rephrase or narrow it down (e.g. by sector, status, or date range)?`,
      caveats: warnings.slice(0, 3),
    };
  }

  return {
    answer: `Found ${matches.length} matching record(s) in ${scopeName}. Top result: "${matches[0].name}".`,
    matches: matches.slice(0, 10),
    caveats: warnings.slice(0, 3),
  };
}
