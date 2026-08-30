# Decision Log — Skylark BI Agent

## Key assumptions

- **No reliable shared ID between Deals and Work Orders.** The sample
  data has no common key (`Client Code` in Deals vs. `Customer Name Code`
  in Work Orders use different, non-matching numbering). Cross-board
  questions are answered by treating **Sector** as the best available
  common dimension, rather than attempting a fragile record-level join
  that the data doesn't actually support. A production version would need
  a real shared deal/client ID from the client to do this precisely.
- **monday.com access is read-only in practice, not by token scope.**
  The generated API token is not read-only at the account level, but the
  integration code only ever issues GraphQL `query` operations — never a
  `mutation` — so it never writes to the boards regardless of token scope.
- **Month-only billing fields** (e.g. "Expected Billing Month" = "Dec")
  are treated as text, not parsed as full dates, since they aren't
  complete dates and forcing them into a Date column during import would
  have lost information.
- **Missing numeric values are excluded from sums, not treated as zero
  contributions.** `Masked Deal value` is missing in roughly half the
  Deals rows; a sum ignores those rows for the total but the response
  discloses how many records the total actually covers (e.g. "based on
  165 of 346 records with a recorded value"), so a total is never
  presented as if it silently represents the whole dataset.

## Trade-offs chosen, and why

- **API (GraphQL) over MCP.** monday.com's MCP server was newer and
  riskier to debug under a tight timeline; the GraphQL API is
  well-documented and gave the same read capability with less
  integration risk.
- **Two-step LLM architecture (plan → execute → phrase) instead of a
  single LLM call over raw data.** An early version let the LLM read raw
  JSON directly and count/sum from it — this produced confidently wrong
  answers at this dataset's size (e.g. "0 deals are Won" vs. the actual
  165), because LLMs are unreliable at exact aggregation over long lists
  of text. All counting/summing now happens in deterministic JavaScript;
  the LLM's role is narrowed to (a) turning a question into a query
  instruction, using only field names it's told exist, and (b) turning an
  exact result into a natural-language answer. This also makes the agent
  general-purpose rather than limited to a fixed set of anticipated
  question types.
- **In-memory caching (60s TTL) rather than a database.** At this data
  volume (a few hundred rows per board), re-fetching and holding data in
  memory per request is simpler and fast enough; a real production
  version handling concurrent users or larger boards would need a proper
  cache/store instead of a process-local `Map`.
- **Cursor-based pagination added to the monday.com client.** monday.com's
  `items_page` silently caps results per request even when a high `limit`
  is set; without following the returned `cursor`, only a fraction of
  each board was actually being read (discovered when a "Won deals" query
  returned 0 against 344 real rows fetched incompletely). Pagination now
  loops until monday.com signals no more pages remain.

## What I'd do differently with more time

- **Generalize the cross-board join** by asking the client for (or
  deriving, if possible from more complete data) a real shared ID between
  Deals and Work Orders, rather than falling back to Sector-only
  cross-referencing.
- **Add retrieval/pre-filtering before the LLM sees sample rows**, so the
  approach scales past a few hundred rows without relying on the model's
  full context window for the "sample records" portion of the prompt.
- **Persist normalized data and caveats** (e.g. in a small database)
  instead of re-normalizing on every request, and widen the in-memory
  cache into something shared across server instances.
- **Scope caveats to the board/question actually being asked about**,
  rather than surfacing the first few caveats from the combined list
  regardless of relevance.

## How I interpreted "leadership updates"

Implemented as a dedicated `leadershipSummary` operation: when the query
planner detects a general status/summary request (rather than a specific
metric), it returns a compact, pre-aggregated snapshot across both
boards — deal counts by status and sector, total deal value, work order
counts by execution status and sector, and total billed value — which the
LLM then writes up as a short digest. This was chosen over building a
scheduling/notification system, which felt like scope creep for a
conversational agent and out of proportion to an optional requirement.
