import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { networkInterfaces } from "node:os";

type ToolInfo = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type ConnectionRecord = {
  url: string;
  client: Client;
  transport: SSEClientTransport;
  tools: ToolInfo[];
  connectedAt: string;
};

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

const connections = new Map<string, ConnectionRecord>();
const toolQueues = new Map<string, Promise<unknown>>();
const CONNECT_TIMEOUT_MS = 5000;
const DISCOVERY_WORKERS = 48;
const DISCOVERY_PROBE_TIMEOUT_MS = 500;
const DISCOVERY_TIME_BUDGET_MS = 3600;
const CONNECT_TIMEOUT_MESSAGE =
  "HUSKYLENS에 연결할 수 없습니다. 같은 Wi-Fi에 있는지 확인하고 주소를 다시 입력하세요.";

function connectionKey(url: string) {
  return normalizeHuskyLensUrl(url);
}

export async function connectHuskyLens(url: string) {
  const key = connectionKey(url);
  if (!key) {
    throw new Error("HUSKYLENS MCP URL이 필요합니다.");
  }

  const existing = connections.get(key);
  if (existing) {
    return {
      url: existing.url,
      connectedAt: existing.connectedAt,
      tools: existing.tools
    };
  }

  const client = new Client({
    name: "huskylens-local-webapp",
    version: "0.1.0"
  });
  const transport = new SSEClientTransport(new URL(key));

  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, CONNECT_TIMEOUT_MESSAGE);
    const toolList = await withTimeout(
      client.listTools(),
      CONNECT_TIMEOUT_MS,
      "HUSKYLENS 기능 목록을 가져오지 못했습니다. 장치를 다시 연결한 뒤 시도하세요."
    );
    const tools = toolList.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));

    const record: ConnectionRecord = {
      url: key,
      client,
      transport,
      tools,
      connectedAt: new Date().toISOString()
    };
    connections.set(key, record);

    return {
      url: key,
      connectedAt: record.connectedAt,
      tools
    };
  } catch (error) {
    try {
      await client.close();
    } catch {
      // Failed connection sessions can already be closed by the MCP transport.
    }
    throw normalizeConnectionError(error);
  }
}

export async function disconnectHuskyLens(url: string) {
  const key = connectionKey(url);
  const record = connections.get(key);
  if (!record) return;
  await record.client.close();
  connections.delete(key);
}

export async function getHuskyLensToolSchemas(url: string) {
  const key = connectionKey(url);
  if (!key) return [];
  const existing = connections.get(key);
  if (existing) return existing.tools;
  const created = await connectHuskyLens(key);
  return created.tools;
}

async function getClient(url: string) {
  const key = connectionKey(url);
  const record = connections.get(key);
  if (record) return record.client;
  await connectHuskyLens(key);
  const created = connections.get(key);
  if (!created) throw new Error("HUSKYLENS MCP 연결을 만들 수 없습니다.");
  return created.client;
}

export async function callHuskyLensTool(
  url: string,
  name: string,
  args: Record<string, unknown> = {},
  options: { timeoutMs?: number; timeoutMessage?: string } = {}
) {
  const key = connectionKey(url);
  if (!key) {
    throw new Error("HUSKYLENS MCP URL이 필요합니다.");
  }
  return enqueueToolCall(key, async () => {
    return callToolWithRetry(key, name, args, options);
  });
}

async function callToolWithRetry(
  key: string,
  name: string,
  args: Record<string, unknown>,
  options: { timeoutMs?: number; timeoutMessage?: string },
  retried = false
) {
  const client = await getClient(key);
  try {
    return await withTimeout(
      client.callTool({
        name,
        arguments: args
      }),
      options.timeoutMs ?? 12000,
      options.timeoutMessage ??
        `${name} 호출 시간이 초과되었습니다. HUSKYLENS 화면에서 실행 중인 앱과 Wi-Fi 상태를 확인하세요.`
    );
  } catch (error) {
    const shouldReset =
      error instanceof TimeoutError || getErrorText(error).includes("Session not initialized");
    if (shouldReset) {
      await resetConnection(key);
      if (!retried && !(error instanceof TimeoutError)) {
        return callToolWithRetry(key, name, args, options, true);
      }
    }
    throw error;
  }
}

export async function getRecognitionResult(
  url: string,
  options: { timeoutMs?: number; timeoutMessage?: string } = {}
) {
  const currentApplication = await getApplications(url, "current_application", options);
  const algorithm = extractAlgorithmId(currentApplication);
  if (!algorithm) {
    throw new Error(`현재 HUSKYLENS 알고리즘 ID를 확인할 수 없습니다: ${formatUnknown(currentApplication)}`);
  }

  const result = await callHuskyLensTool(url, "get_recognition_result", {
    operation: "get_result",
    algorithm
  }, options);
  return normalizeRecognitionPayload(url, algorithm, currentApplication, normalizeMcpContent(result));
}

export async function getApplications(
  url: string,
  instruction?: string,
  options: { timeoutMs?: number; timeoutMessage?: string } = {}
) {
  const operation = normalizeApplicationOperation(instruction);
  const result = await callHuskyLensTool(url, "manage_applications", {
    operation
  }, options);
  return normalizeMcpContent(result);
}

export async function takePhoto(
  url: string,
  options: { timeoutMs?: number; timeoutMessage?: string } = {}
) {
  const result = await callHuskyLensTool(url, "multimedia_control", {
    operation: "take_photo",
    resolution: "1280x720"
  }, options);
  return normalizeMediaPayload(url, normalizeMcpContent(result));
}

export async function takeScreenshot(
  url: string,
  options: { timeoutMs?: number; timeoutMessage?: string } = {}
) {
  const result = await callHuskyLensTool(url, "multimedia_control", {
    operation: "take_screenshot"
  }, {
    timeoutMs: options.timeoutMs ?? 3500,
    timeoutMessage:
      options.timeoutMessage ??
      "화면 수신이 지연되고 있습니다. Wi-Fi 상태를 확인하거나 잠시 후 다시 시도하세요."
  });
  return normalizeMediaPayload(url, normalizeMcpContent(result));
}

export async function schedulePhotoTask(
  url: string,
  trigger: string,
  options: { timeoutMs?: number; timeoutMessage?: string } = {}
) {
  const trimmedTrigger = trigger.trim();
  if (!trimmedTrigger) {
    throw new Error("사진을 찍을 조건을 알려주세요.");
  }

  const result = await callHuskyLensTool(url, "task_scheduler", {
    operation: "create_task",
    tasks: JSON.stringify([
      {
        trigger: trimmedTrigger,
        handler: "take_photo"
      }
    ])
  }, {
    timeoutMs: options.timeoutMs ?? 5000,
    timeoutMessage:
      options.timeoutMessage ??
      "촬영 조건을 등록하지 못했습니다. HUSKYLENS 화면과 Wi-Fi 상태를 확인하세요."
  });
  return normalizeMcpContent(result);
}

export async function drawText(
  url: string,
  options: {
    text: string;
    color?: string;
    x?: number;
    y?: number;
    fontSize?: number;
  }
) {
  const text = String(options.text || "").trim().slice(0, 80);
  if (!text) {
    throw new Error("화면에 표시할 문구를 입력하세요.");
  }

  const result = await callHuskyLensTool(url, "draw_control", {
    operation: "draw_text",
    text,
    color: normalizeHexColor(options.color),
    x: clampInteger(options.x, 0, 320, 12),
    y: clampInteger(options.y, 0, 240, 16),
    font_size: normalizeFontSize(options.fontSize)
  });
  return normalizeMcpContent(result);
}

export async function clearText(url: string) {
  const result = await callHuskyLensTool(url, "draw_control", {
    operation: "clear_text"
  });
  return normalizeMcpContent(result);
}

export function normalizeMcpContent(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const maybeContent = value as { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown };
  if (maybeContent.structuredContent) return maybeContent.structuredContent;
  if (Array.isArray(maybeContent.content)) {
    return maybeContent.content
      .map((item) => {
        if (item.type === "text") return item.text ?? "";
        return JSON.stringify(item);
      })
      .filter(Boolean)
      .join("\n");
  }
  return value;
}

export async function discoverHuskyLens() {
  const candidates = getSubnetCandidates();
  const found: string[] = [];
  const queue = [...candidates];
  const deadline = Date.now() + DISCOVERY_TIME_BUDGET_MS;
  const workers = Array.from({ length: DISCOVERY_WORKERS }, async () => {
    while (queue.length > 0 && Date.now() < deadline) {
      const url = queue.shift();
      if (!url) return;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return;
      if (await looksLikeMcpSse(url, Math.min(DISCOVERY_PROBE_TIMEOUT_MS, remainingMs))) {
        found.push(url);
      }
    }
  });
  await Promise.all(workers);
  return found.sort();
}

function getSubnetCandidates() {
  const urls = new Set<string>();
  for (const [interfaceName, values] of Object.entries(networkInterfaces())) {
    if (!isDiscoveryInterface(interfaceName)) continue;
    for (const value of values || []) {
      if (value.family !== "IPv4" || value.internal) continue;
      if (isLinkLocalAddress(value.address)) continue;
      const parts = value.address.split(".");
      if (parts.length !== 4) continue;
      const prefix = parts.slice(0, 3).join(".");
      for (let host = 1; host <= 254; host += 1) {
        const address = `${prefix}.${host}`;
        if (address !== value.address) {
          urls.add(`http://${address}:3000/sse`);
        }
      }
    }
  }
  return [...urls];
}

function isDiscoveryInterface(name: string) {
  return !/^(lo|utun|tun|tap|wg|zt|tailscale|awdl|llw|bridge|vboxnet|vmnet|docker)/i.test(name);
}

function isLinkLocalAddress(address: string) {
  return address.startsWith("169.254.") || address === "0.0.0.0";
}

function normalizeHuskyLensUrl(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (!url.port) url.port = "3000";
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/sse";
    return url.toString();
  } catch {
    return trimmed;
  }
}

function normalizeConnectionError(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === CONNECT_TIMEOUT_MESSAGE ||
      error.message.includes("기능 목록")
    ) {
      return error;
    }
  }
  return new Error(CONNECT_TIMEOUT_MESSAGE);
}

async function looksLikeMcpSse(url: string, timeoutMs = DISCOVERY_PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(80, timeoutMs));
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "text/event-stream" }
    });
    const contentType = response.headers.get("content-type") || "";
    return response.ok && contentType.includes("text/event-stream");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeApplicationOperation(value?: string) {
  if (value === "application_list" || value === "current_application" || value === "switch_application") {
    return value;
  }
  return "current_application";
}

function normalizeRecognitionPayload(mcpUrl: string, algorithm: number, currentApplication: unknown, payload: unknown) {
  const parsed = parseRecognitionLines(payload);
  const resources: Array<Record<string, unknown>> = [];
  const detections: unknown[] = [];

  for (const item of parsed) {
    if (Array.isArray(item)) {
      detections.push(...item);
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.type === "resource_link" && typeof record.uri === "string") {
        resources.push({
          ...record,
          uri: rewriteHuskyLensResourceUrl(mcpUrl, record.uri)
        });
      } else {
        detections.push(record);
      }
    }
  }

  return {
    algorithm,
    currentApplication: parseMaybeJson(currentApplication),
    resources,
    detections,
    raw: payload
  };
}

function normalizeMediaPayload(mcpUrl: string, payload: unknown) {
  const parsed = parseRecognitionLines(payload);
  const resources: Array<Record<string, unknown>> = [];
  const values: unknown[] = [];

  for (const item of parsed) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (record.type === "resource_link" && typeof record.uri === "string") {
        resources.push({
          ...record,
          uri: rewriteHuskyLensResourceUrl(mcpUrl, record.uri)
        });
        continue;
      }
    }
    values.push(item);
  }

  return {
    resources,
    raw: payload,
    values
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeFontSize(value: unknown) {
  const supported = [20, 24, 26, 27, 28, 32, 36, 40, 48];
  const requested = clampInteger(value, 20, 48, 24);
  return supported.reduce((best, current) =>
    Math.abs(current - requested) < Math.abs(best - requested) ? current : best
  );
}

function normalizeHexColor(value: unknown) {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value.trim())) {
    return value.trim();
  }
  return "#00FF00";
}

function parseRecognitionLines(payload: unknown) {
  if (typeof payload !== "string") return [parseMaybeJson(payload)];
  const values = parseJsonValues(payload);
  return values.length > 0 ? values : [payload];
}

function parseJsonValues(text: string) {
  const values: unknown[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const chunk = text.slice(start, index + 1);
        values.push(parseMaybeJson(chunk));
        start = -1;
      }
    }
  }

  return values;
}

function rewriteHuskyLensResourceUrl(mcpUrl: string, resourceUrl: string) {
  try {
    const resource = new URL(resourceUrl);
    const mcp = new URL(mcpUrl);
    if (resource.hostname !== mcp.hostname) {
      resource.protocol = mcp.protocol;
      resource.hostname = mcp.hostname;
      resource.port = mcp.port;
    }
    return resource.toString();
  } catch {
    return resourceUrl;
  }
}

function extractAlgorithmId(value: unknown): number | null {
  const parsed = parseMaybeJson(value);
  const direct = findAlgorithmNumber(parsed);
  if (direct) return direct;

  const text = formatUnknown(parsed).toLowerCase();
  const idMatch = text.match(/(?:algorithm|algo|id)[^0-9]{0,12}([1-9][0-9]?)/i);
  if (idMatch) return Number(idMatch[1]);

  const nameMap: Array<[RegExp, number]> = [
    [/face.*recognition|face.*detection/, 1],
    [/object.*recognition/, 2],
    [/object.*tracking/, 3],
    [/color.*recognition/, 4],
    [/object.*classification/, 5],
    [/self.*learning/, 6],
    [/segment|segmentation/, 7],
    [/hand/, 8],
    [/pose|human.*key/, 9],
    [/license/, 10],
    [/ocr|optical.*char|text.*recognition/, 11],
    [/line/, 12],
    [/emotion|expression/, 13],
    [/gaze/, 14],
    [/orientation/, 15],
    [/tag|apriltag/, 16],
    [/barcode/, 17],
    [/qr/, 18],
    [/fall/, 19]
  ];

  for (const [pattern, id] of nameMap) {
    if (pattern.test(text)) return id;
  }

  return null;
}

function findAlgorithmNumber(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAlgorithmNumber(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase();
    if (
      typeof item === "number" &&
      Number.isInteger(item) &&
      item > 0 &&
      item < 128 &&
      (normalizedKey.includes("algorithm") || normalizedKey === "id" || normalizedKey.includes("algo"))
    ) {
      return item;
    }
  }

  for (const item of Object.values(record)) {
    const found = findAlgorithmNumber(item);
    if (found) return found;
  }
  return null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatUnknown(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return formatUnknown(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function enqueueToolCall<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = toolQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const tracked = next.finally(() => {
    if (toolQueues.get(key) === tracked) {
      toolQueues.delete(key);
    }
  }).catch(() => undefined);
  toolQueues.set(key, tracked);
  return next;
}

async function resetConnection(url: string) {
  const key = connectionKey(url);
  const record = connections.get(key);
  if (!record) return;
  connections.delete(key);
  try {
    await record.client.close();
  } catch {
    // The session is already unhealthy; the next call will create a new client.
  }
}
