import fetch from "node-fetch";

const MONDAY_API_URL = "https://api.monday.com/v2";


async function mondayQuery(query, variables = {}) {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`monday.com API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`monday.com GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// Simple in-memory cache so we don't hammer the API on every chat message
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

export async function getBoardItems(boardId) {
  const cacheKey = `board:${boardId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        name
        columns { id title type }
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values { id text value column { title } }
          }
        }
      }
    }
  `;
  const data = await mondayQuery(query, { boardId: [boardId] });
  const board = data.boards[0];
  let allItems = [...board.items_page.items];
  let cursor = board.items_page.cursor;

  while (cursor) {
    const nextQuery = `
      query ($cursor: String!) {
        next_items_page(cursor: $cursor, limit: 500) {
          cursor
          items {
            id
            name
            column_values { id text value column { title } }
          }
        }
      }
    `;
    const nextData = await mondayQuery(nextQuery, { cursor });
    allItems = allItems.concat(nextData.next_items_page.items);
    cursor = nextData.next_items_page.cursor;
  }

  board.items_page.items = allItems;
  cache.set(cacheKey, { data: board, ts: Date.now() });
  return board;
}
