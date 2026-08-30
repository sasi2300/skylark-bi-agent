import express from "express";
import { getBoardItems } from "./mondayClient.js";
import { normalizeBoard } from "./normalize.js";
import { answerQuery } from "./agent.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const DEALS_BOARD_ID = process.env.DEALS_BOARD_ID;
const WORK_ORDERS_BOARD_ID = process.env.WORK_ORDERS_BOARD_ID;

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

    const result = answerQuery(message, deals.rows, workOrders.rows, allWarnings);
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
