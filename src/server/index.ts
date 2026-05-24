import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  connectHuskyLens,
  clearText,
  disconnectHuskyLens,
  discoverHuskyLens,
  drawText,
  getApplications,
  getHuskyLensToolSchemas,
  getRecognitionResult,
  takePhoto,
  takeScreenshot
} from "./huskylensMcp.js";
import { answerWithOpenAI } from "./openaiClient.js";

dotenv.config({ quiet: true });

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
    res.json({ ok: false, error: getErrorMessage(error) });
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
    const data = await getRecognitionResult(
      req.body.url,
      req.body.fast
        ? {
            timeoutMs: 2500,
            timeoutMessage: "장면 수신이 지연되고 있습니다. 화면을 잠시 후 다시 확인하세요."
          }
        : {}
    );
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

app.post("/api/huskylens/screenshot", async (req, res) => {
  try {
    const data = await takeScreenshot(req.body.url);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/huskylens/screen", async (req, res) => {
  const startedAt = Date.now();
  const background = req.body.background === true;

  try {
    if (!req.body.url) {
      throw new Error("HUSKYLENS MCP URL이 필요합니다.");
    }

    const data = await takeScreenshot(req.body.url, {
      timeoutMs: background ? 900 : 2200,
      timeoutMessage: background
        ? "화면 갱신이 지연되고 있습니다."
        : "화면 수신이 지연되고 있습니다. Wi-Fi 상태를 확인하거나 잠시 후 다시 시도하세요."
    });
    res.json({
      ok: true,
      data: {
        ...asRecord(data),
        captureMode: "screenshot",
        durationMs: Date.now() - startedAt
      }
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/huskylens/draw-text", async (req, res) => {
  try {
    const data = await drawText(req.body.url, {
      text: req.body.text,
      color: req.body.color,
      x: req.body.x,
      y: req.body.y,
      fontSize: req.body.fontSize
    });
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/huskylens/clear-text", async (req, res) => {
  try {
    const data = await clearText(req.body.url);
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

    const providedVisionContext = req.body.visionContext || null;
    const providedScreenContext = req.body.screenContext || null;
    const fallbackVisionContext = providedVisionContext || providedScreenContext;
    const hasFallbackVisionContext = Boolean(fallbackVisionContext);
    let visionContext: unknown;
    try {
      visionContext = await getRecognitionResult(req.body.huskylensUrl, {
        timeoutMs: hasFallbackVisionContext ? 1800 : 4500,
        timeoutMessage: "HUSKYLENS 장면 수신이 지연되고 있습니다. 카메라 화면을 확인한 뒤 다시 질문하세요."
      });
    } catch (error) {
      if (!hasFallbackVisionContext) throw error;
      visionContext = fallbackVisionContext;
    }

    const screenContext = providedScreenContext || (req.body.includeScreen
      ? await takeScreenshot(req.body.huskylensUrl).catch(() => null)
      : null);
    const mcpTools = await getHuskyLensToolSchemas(req.body.huskylensUrl);

    const answer = await answerWithOpenAI({
      apiKey: req.body.openaiApiKey,
      question,
      visionContext,
      screenContext,
      mcpTools,
      history: Array.isArray(req.body.history) ? req.body.history : []
    });

    res.json({ ok: true, data: { answer, visionContext, screenContext } });
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

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { raw: value };
}
