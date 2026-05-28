import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import ffmpegStatic from "ffmpeg-static";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  schedulePhotoTask,
  takePhoto,
  takeScreenshot
} from "./huskylensMcp.js";
import {
  answerAfterMcpActionWithOpenAI,
  answerWithOpenAI,
  planMcpActionWithOpenAI,
  type AiMcpActionPlan
} from "./openaiClient.js";

dotenv.config({ quiet: true });

const app = express();
const port = Number(process.env.PORT || 8787);
const capturesDir = resolve(process.cwd(), "data", "captures");
const capturesDbPath = resolve(capturesDir, "captures.json");

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/captures", express.static(capturesDir));

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

    const frame = await takeDisplayFrame(req.body.url, background);
    res.json({
      ok: true,
      data: {
        ...asRecord(frame.data),
        captureMode: frame.captureMode,
        durationMs: Date.now() - startedAt
      }
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.get("/api/huskylens/rtsp.mjpeg", (req, res) => {
  const mcpUrl = typeof req.query.url === "string" ? req.query.url : "";
  const rtspUrl = getRtspStreamUrl(mcpUrl);
  if (!rtspUrl) {
    res.status(400).send("HUSKYLENS RTSP 주소가 필요합니다.");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace;boundary=huskylens",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Connection: "close"
  });

  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
  const ffmpeg = spawn(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-rtsp_transport",
    "tcp",
    "-fflags",
    "nobuffer",
    "-flags",
    "low_delay",
    "-i",
    rtspUrl,
    "-an",
    "-vf",
    "fps=12",
    "-q:v",
    "5",
    "-f",
    "mpjpeg",
    "-boundary_tag",
    "huskylens",
    "pipe:1"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  let closed = false;
  let forceKillTimer: NodeJS.Timeout | undefined;
  const closeStream = () => {
    if (closed) return;
    closed = true;
    try {
      ffmpeg.kill("SIGTERM");
    } catch {
      // The stream process has already exited.
    }
    forceKillTimer = setTimeout(() => {
      try {
        ffmpeg.kill("SIGKILL");
      } catch {
        // The stream process has already exited.
      }
    }, 1200);
    forceKillTimer.unref();
  };
  const finishStream = () => {
    if (forceKillTimer) clearTimeout(forceKillTimer);
    if (!res.destroyed) res.end();
  };

  req.on("close", closeStream);
  res.on("close", closeStream);

  ffmpeg.stderr.on("data", () => {
    // Keep stderr drained so a noisy RTSP session cannot block ffmpeg.
  });
  ffmpeg.stdout.pipe(res);
  ffmpeg.once("error", () => {
    finishStream();
  });
  ffmpeg.once("exit", () => {
    finishStream();
  });
});

app.get("/api/stream/captures", async (_req, res) => {
  try {
    const captures = await readCaptureDb();
    res.json({ ok: true, data: captures });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/stream/capture", async (req, res) => {
  const startedAt = Date.now();
  try {
    const mcpUrl = typeof req.body.url === "string" ? req.body.url : "";
    const rtspUrl = getRtspStreamUrl(mcpUrl);
    if (!rtspUrl) {
      throw new Error("HUSKYLENS 주소가 필요합니다.");
    }

    await ensureCapturesDir();
    const deviceHost = hostFromMcpUrl(mcpUrl);
    const cameraName = typeof req.body.cameraName === "string"
      ? req.body.cameraName.trim().slice(0, 120)
      : "";
    const timestamp = new Date().toISOString();
    const displayName = cameraName || deviceHost;
    const fileName = `${timestamp.replace(/[:.]/g, "-")}-${displayName.replace(/[^a-z0-9가-힣._-]/gi, "_")}.jpg`;
    const absolutePath = resolve(capturesDir, fileName);

    await captureRtspFrame(rtspUrl, absolutePath);

    const entry = {
      id: randomUUID(),
      timestamp,
      deviceHost,
      cameraName,
      displayName,
      mcpUrl,
      rtspUrl,
      fileName,
      path: `/captures/${fileName}`,
      absolutePath,
      metadata: {
        source: "rtsp",
        durationMs: Date.now() - startedAt
      }
    };
    const captures = await readCaptureDb();
    await writeCaptureDb([entry, ...captures].slice(0, 300));
    res.json({ ok: true, data: entry });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/stream/open-folder", async (_req, res) => {
  try {
    await ensureCapturesDir();
    openFolder(capturesDir);
    res.json({ ok: true, data: { path: capturesDir } });
  } catch (error) {
    res.status(400).json({ ok: false, error: getErrorMessage(error) });
  }
});

async function takeDisplayFrame(url: string, background: boolean) {
  const timeoutMessage = background
    ? "화면 갱신이 지연되고 있습니다."
    : "화면 수신이 지연되고 있습니다. Wi-Fi 상태를 확인하거나 잠시 후 다시 시도하세요.";
  let screenshotError: unknown = null;

  try {
    const data = await takeScreenshot(url, {
      timeoutMs: background ? 900 : 2200,
      timeoutMessage
    });
    if (hasImageResource(data)) {
      return { data, captureMode: "screenshot" as const };
    }
  } catch (error) {
    screenshotError = error;
  }

  try {
    const data = await takePhoto(url, {
      timeoutMs: background ? 1400 : 3000,
      timeoutMessage
    });
    if (hasImageResource(data)) {
      return { data, captureMode: "photo" as const };
    }
  } catch (error) {
    if (screenshotError) throw error;
  }

  if (screenshotError) throw screenshotError;
  throw new Error("화면 이미지를 받지 못했습니다. HUSKYLENS 화면과 Wi-Fi 연결을 확인한 뒤 다시 시도하세요.");
}

async function captureRtspFrame(rtspUrl: string, outputPath: string) {
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
  await new Promise<void>((resolveCapture, rejectCapture) => {
    const ffmpeg = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-rtsp_transport",
      "tcp",
      "-y",
      "-i",
      rtspUrl,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputPath
    ], {
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    const timeout = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
      rejectCapture(new Error("캡처 시간이 초과되었습니다. RTSP Streaming 상태를 확인하세요."));
    }, 7000);
    timeout.unref();

    ffmpeg.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    ffmpeg.once("error", (error) => {
      clearTimeout(timeout);
      rejectCapture(error);
    });
    ffmpeg.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveCapture();
        return;
      }
      rejectCapture(new Error(stderr.trim() || "RTSP 프레임을 캡처하지 못했습니다."));
    });
  });
}

function getRtspStreamUrl(mcpUrl: string) {
  try {
    const trimmed = mcpUrl.trim();
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (!parsed.hostname) return "";
    return `rtsp://${parsed.hostname}:8554/live`;
  } catch {
    return "";
  }
}

function hostFromMcpUrl(mcpUrl: string) {
  try {
    const trimmed = mcpUrl.trim();
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`).hostname;
  } catch {
    return "huskylens";
  }
}

async function ensureCapturesDir() {
  await mkdir(capturesDir, { recursive: true });
}

async function readCaptureDb() {
  await ensureCapturesDir();
  if (!existsSync(capturesDbPath)) return [];
  const content = await readFile(capturesDbPath, "utf8");
  const parsed = JSON.parse(content) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

async function writeCaptureDb(captures: unknown[]) {
  await ensureCapturesDir();
  await writeFile(capturesDbPath, `${JSON.stringify(captures, null, 2)}\n`, "utf8");
}

function openFolder(path: string) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "explorer"
      : "xdg-open";
  const child = spawn(command, [path], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

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

    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const mcpTools = await getHuskyLensToolSchemas(req.body.huskylensUrl);
    const actionPlan = await planMcpActionWithOpenAI({
      apiKey: req.body.openaiApiKey,
      question,
      mcpTools,
      history
    });
    if (actionPlan.action !== "none") {
      const actionResult = await runCameraAction(req.body.huskylensUrl, actionPlan, mcpTools);
      if (actionResult.deviceAction?.ok === false && actionPlan.action === "ask_clarification") {
        res.json({ ok: true, data: actionResult });
        return;
      }
      const actionAnswer = await answerAfterMcpActionWithOpenAI({
        apiKey: req.body.openaiApiKey,
        question,
        visionContext: actionResult.visionContext,
        screenContext: actionResult.screenContext,
        mcpTools,
        history,
        deviceAction: actionResult.deviceAction
      });
      res.json({
        ok: true,
        data: {
          ...actionResult,
          answer: actionAnswer
        }
      });
      return;
    }

    const providedScreenContext = req.body.screenContext || null;
    const rawVisionContext = await getRecognitionResult(req.body.huskylensUrl, {
      timeoutMs: 6000,
      timeoutMessage: "HUSKYLENS 최신 장면 수신이 지연되고 있습니다. 카메라 화면을 확인한 뒤 다시 질문하세요."
    });
    const visionContext = {
      ...asRecord(rawVisionContext),
      mcpReadAt: new Date().toISOString(),
      mcpReadMode: "fresh_per_question"
    };

    const screenContext = providedScreenContext;
    const answer = await answerWithOpenAI({
      apiKey: req.body.openaiApiKey,
      question,
      visionContext,
      screenContext,
      mcpTools,
      history
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

async function runCameraAction(
  url: string,
  action: AiMcpActionPlan,
  tools: Array<{ name?: string }>
) {
  if (action.action === "take_photo") {
    const photo = await takePhoto(url, {
      timeoutMs: 6000,
      timeoutMessage: "사진 촬영이 지연되고 있습니다. HUSKYLENS 화면과 Wi-Fi 상태를 확인하세요."
    });
    return {
      answer: "허스키렌즈로 사진을 찍었습니다.",
      visionContext: null,
      screenContext: null,
      deviceAction: {
        type: action.action,
        plannedBy: "openai",
        reason: action.reason,
        ok: true,
        raw: photo
      }
    };
  }

  if (action.action === "ask_clarification") {
    return {
      answer: action.question,
      visionContext: null,
      screenContext: null,
      deviceAction: {
        type: action.action,
        plannedBy: "openai",
        reason: action.reason,
        ok: false
      }
    };
  }

  if (action.action !== "schedule_photo") {
    return {
      answer: "",
      visionContext: null,
      screenContext: null,
      deviceAction: {
        type: action.action,
        plannedBy: "openai",
        reason: action.reason,
        ok: false
      }
    };
  }

  if (!tools.some((tool) => tool.name === "task_scheduler")) {
    return {
      answer: "이 HUSKYLENS MCP에서는 조건부 촬영을 등록할 수 없습니다.",
      visionContext: null,
      screenContext: null,
      deviceAction: {
        type: action.action,
        plannedBy: "openai",
        reason: action.reason,
        ok: false,
        trigger: action.originalTrigger || action.trigger
      }
    };
  }

  const result = await schedulePhotoTask(url, action.trigger);
  const originalTrigger = action.originalTrigger || action.trigger;
  return {
    answer:
      action.trigger === originalTrigger
        ? `${originalTrigger}이 보일 때마다 허스키렌즈가 사진을 찍도록 설정했습니다.`
        : `${originalTrigger}이 보일 때마다 허스키렌즈가 사진을 찍도록 설정했습니다. 조건 이름은 ${action.trigger}로 보냈습니다.`,
    visionContext: null,
    screenContext: null,
    deviceAction: {
      type: action.action,
      plannedBy: "openai",
      reason: action.reason,
      ok: true,
      trigger: action.trigger,
      raw: result
    }
  };
}

function hasImageResource(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const visit = (item: unknown): boolean => {
    if (!item || typeof item !== "object") return false;
    if (Array.isArray(item)) return item.some(visit);
    const record = item as Record<string, unknown>;
    if (typeof record.uri === "string") {
      const mimeType = typeof record.mimeType === "string" ? record.mimeType : "";
      if (!mimeType || mimeType.startsWith("image/")) return true;
    }
    return Object.values(record).some(visit);
  };
  return visit(value);
}
