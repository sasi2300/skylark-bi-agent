import express from "express";
import fetch from "node-fetch";
import { getBoardItems } from "./mondayClient.js";
import { normalizeBoard } from "./normalize.js";
import { answerQuery } from "./agent.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const dealsBoard = await getBoardItems(process.env.DEALS_BOARD_ID);
const woBoard = await getBoardItems(process.env.WORK_ORDERS_BOARD_ID);

app.get("/debug", async (req, res) => {
  const keyPresent = !!process.env.GEMINI_API_KEY;
  const keyPreview = process.env.GEMINI_API_KEY
    ? process.env.GEMINI_API_KEY.slice(0, 6) + "..." + process.env.GEMINI_API_KEY.slice(-4)
    : "MISSING";

  let geminiTest = "not tried";
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY || "",
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: "say hi" }] }] }),
      }
    );
    const bodyText = await r.text();
    geminiTest = { status: r.status, body: bodyText.slice(0, 300) };
  } catch (e) {
    geminiTest = `fetch failed: ${e.message}`;
  }

  let boardCounts = "not tried";
  try {
    const dealsBoard = await getBoardItems(process.env.DEALS_BOARD_ID);
    const woBoard = await getBoardItems(process.env.WORK_ORDERS_BOARD_ID);
    boardCounts = {
      dealsCount: dealsBoard.items_page.items.length,
      woCount: woBoard.items_page.items.length,
    };
  } catch (e) {
    boardCounts = `fetch failed: ${e.message}`;
  }

  res.json({ keyPresent, keyPreview, geminiTest, boardCounts });
});
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });
    const [dealsBoard, woBoard] = await Promise.all([
      getBoardItems(DEALS_BOARD_ID),
      getBoardItems(WORK_ORDERS_BOARD_ID),
    ]);
    const deals = normalizeBoard(dealsBoard);
    const workOrders = normalizeBoard(woBoard);
    const allWarnings = [...deals.warnings, ...workOrders.warnings];
    const result = await answerQuery(message, deals.rows, workOrders.rows, allWarnings);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      answer: "Something went wrong reaching monday.com. Please try again shortly.",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
