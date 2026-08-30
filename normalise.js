// Turns a raw monday.com board (with its messy column_values) into a clean,
// flat array of plain objects, plus a list of warnings about data quality.

export function normalizeBoard(board) {
  const warnings = [];
  if (!board) return { rows: [], warnings: ["Board data unavailable."] };

  const rows = board.items_page.items.map((item) => {
    const row = { id: item.id, name: item.name };

    for (const cv of item.column_values) {
      const label = cv.column?.title || cv.id;
      let value = cv.text?.trim() || null;

      if (value === "" || value === null) {
        warnings.push(`Missing value for "${label}" on item "${item.name}"`);
        value = null;
      } else if (looksLikeDate(label)) {
        value = normalizeDate(value) ?? value;
      } else {
        value = normalizeText(value);
      }

      row[label] = value;
    }
    return row;
  });

  return { rows, warnings: dedupe(warnings) };
}

function looksLikeDate(label) {
  return /date|deadline|closed|created/i.test(label);
}

function normalizeDate(str) {
  const d = new Date(str);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function normalizeText(str) {
  return str.trim().replace(/\s+/g, " ");
}

function dedupe(arr) {
  return [...new Set(arr)].slice(0, 20); // cap so it doesn't balloon
}
