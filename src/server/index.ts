import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  connectHuskyLens,
  disconnectHuskyLens,
  discoverHuskyLens,
  getApplications,
  getHuskyLensToolSchemas,
  getRecognitionResult,
  takePhoto
} from "./huskylensMcp.js";
import { answerWithOpenAI } from "./openaiClient.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  const hasServerApiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  res.json({
    ok: true,
    openaiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    hasServerApiKey,
    apiKeySource: hasServerApiKey ? "server" : "browser"
  });
});

app.post("/api/huskylens/connect", async (req, res) => {
  try {
    const data = await connectHuskyLens(req.body.url);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/huskylens/disconnect", async (req, res) => {
  try {
    await disconnectHuskyLens(req.body.url);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.get("/api/huskylens/discover", async (_req, res) => {
  try {
    const data = await discoverHuskyLens();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/huskylens/recognition", async (req, res) => {
  try {
    const data = await getRecognitionResult(req.body.url);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/huskylens/applications", async (req, res) => {
  try {
    const data = await getApplications(req.body.url, req.body.instruction);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/huskylens/photo", async (req, res) => {
  try {
    const data = await takePhoto(req.body.url);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/ask", async (req, res) => {
  try {
    const question = req.body.question || "";
    if (!question.trim()) {
      res.status(400).json({ ok: false, error: "질문을 입력하세요." });
      return;
    }

    if (!req.body.huskylensUrl) {
      res.status(400).json({ ok: false, error: "HUSKYLENS 연결이 필요합니다." });
      return;
    }

    const visionContext = await getRecognitionResult(req.body.huskylensUrl);
    const mcpTools = await getHuskyLensToolSchemas(req.body.huskylensUrl);

    const answer = await answerWithOpenAI({
      apiKey: req.body.openaiApiKey,
      model: req.body.model,
      reasoningEffort: req.body.reasoningEffort,
      question,
      visionContext,
      mcpTools,
      attachments: Array.isArray(req.body.attachments) ? req.body.attachments : []
    });

    res.json({ ok: true, data: { answer, visionContext } });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

const distPath = resolve(process.cwd(), "dist");
const indexPath = resolve(distPath, "index.html");

if (existsSync(indexPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(indexPath);
  });
}

app.listen(port, () => {
  console.log(`HUSKYLENS local server listening on http://localhost:${port}`);
});

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
