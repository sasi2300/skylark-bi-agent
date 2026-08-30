# Skylark BI Agent

A conversational business intelligence agent that answers founder-level
questions about Skylark Drones' sales pipeline (Deals) and project
execution (Work Orders) data, read live from monday.com.

**Live app:** https://skylark-bi-agent-8o2l.onrender.com
**Repo:** https://github.com/sasi2300/skylark-bi-agent

---

## Architecture

```
public/index.html   → chat UI (static, no build step)
server.js            → Express API, wires the pipeline together
mondayClient.js       → monday.com GraphQL client (read-only, paginated)
normalize.js          → cleans raw board data, flags missing/messy values
agent.js              → query planning + aggregation + answer generation
```

### Request flow

1. **Frontend** sends the user's question to `POST /api/chat`.
2. **`mondayClient.js`** fetches both boards (Deals, Work Orders) via
   monday.com's GraphQL API, following pagination (`cursor` /
   `next_items_page`) to guarantee the *full* board is read, not just the
   first page.
3. **`normalize.js`** flattens each board's `column_values` into plain
   row objects, normalizes date formats, and records a warning for every
   missing field (rather than dropping or silently zeroing it).
4. **`agent.js`** answers the question in two LLM calls around
   deterministic code in between:
   - **Step 1 (spec generation):** the LLM reads the question and the
     available field names, and returns a small JSON instruction — e.g.
     `{ "operation": "groupByCount", "field": "Deal Status" }` — or a
     clarifying question if the query is ambiguous.
   - **Step 2 (execution):** plain JavaScript runs that instruction
     against the normalized rows (`groupByCount`, `sumField`, `countRows`,
     `sampleRows`, or a bundled `leadershipSummary`) — exact, deterministic
     counting/summing, not LLM arithmetic.
   - **Step 3 (phrasing):** the LLM turns the *exact* computed result into
     a natural-language answer, including any relevant data caveats.
5. The response (`{ answer, caveats }`) is sent back to the chat UI, where
   caveats render as a distinct "data caution" block.

### Why two LLM calls instead of one

An early version let the LLM read raw JSON rows directly and answer from
them. At this dataset's size (300+ rows), that produced confidently wrong
answers (e.g. "0 deals are Won" when the real answer was 165) — LLMs are
unreliable at exact counting/aggregation over long lists of raw text.
Splitting the LLM's job into *planning* (which operation, on which field,
with which filters) and *phrasing* (explaining an exact, code-computed
result) keeps arithmetic 100% reliable while still letting the LLM
interpret open-ended, founder-level phrasing it was never explicitly
programmed to expect.

---

## monday.com setup

1. Create a monday.com account/workspace.
2. Import the two provided CSVs as **two separate boards**, named
   `Deals` and `Work Orders` (any name works — you only need the board
   IDs, not the names, for configuration).
3. Column type suggestions used for this data:
   - Status-like fields (Deal Status, Deal Stage, Execution Status,
     Sector, etc.) → **Status** columns
   - Date fields → **Date** columns
   - Currency/quantity fields → **Numbers** columns
4. Get your board IDs from each board's URL:
   `https://<team>.monday.com/boards/<BOARD_ID>`
5. Generate a personal API token: **Avatar → Admin/Developers → API**.
   The integration only ever issues GraphQL *queries* (no mutations), so
   it is read-only in practice even though the token itself is not
   scope-restricted at the monday.com account level.

---

## Environment variables

Set these on your hosting platform (Render, etc.) — never commit them:

| Variable              | Description                                  |
|------------------------|-----------------------------------------------|
| `MONDAY_API_TOKEN`     | Personal API token from monday.com            |
| `DEALS_BOARD_ID`       | Board ID for the Deals board                  |
| `WORK_ORDERS_BOARD_ID` | Board ID for the Work Orders board            |
| `GEMINI_API_KEY`       | API key from Google AI Studio (aistudio.google.com) |

## Running locally

```bash
npm install
# set the four env vars above in your shell or a .env loader
npm start
# open http://localhost:3000
```

## Deployment

Deployed as a single Node/Express web service (Build: `npm install`,
Start: `npm start`) — no separate frontend deploy needed, since
`public/index.html` is served statically by the same server.

## Known limitations / next steps

See `DECISION_LOG.md` for the full list of assumptions, trade-offs, and
what would change with more time.
