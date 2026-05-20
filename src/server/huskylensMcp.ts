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

const connections = new Map<string, ConnectionRecord>();
const toolQueues = new Map<string, Promise<unknown>>();

function connectionKey(url: string) {
  return url.trim();
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

  await client.connect(transport);
  const toolList = await client.listTools();
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

export async function callHuskyLensTool(url: string, name: string, args: Record<string, unknown> = {}) {
  const key = connectionKey(url);
  return enqueueToolCall(key, async () => {
    const client = await getClient(key);
    try {
      return await withTimeout(
        client.callTool({
          name,
          arguments: args
        }),
        12000,
        `${name} 호출 시간이 초과되었습니다. HUSKYLENS 화면에서 실행 중인 앱과 Wi-Fi 상태를 확인하세요.`
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("시간이 초과")) {
        await resetConnection(key);
      }
      throw error;
    }
  });
}

export async function getRecognitionResult(url: string) {
  const currentApplication = await getApplications(url, "current_application");
  const algorithm = extractAlgorithmId(currentApplication);
  if (!algorithm) {
    throw new Error(`현재 HUSKYLENS 알고리즘 ID를 확인할 수 없습니다: ${formatUnknown(currentApplication)}`);
  }

  const result = await callHuskyLensTool(url, "get_recognition_result", {
    operation: "get_result",
    algorithm
  });
  return normalizeRecognitionPayload(url, algorithm, currentApplication, normalizeMcpContent(result));
}

export async function getApplications(url: string, instruction?: string) {
  const operation = normalizeApplicationOperation(instruction);
  const result = await callHuskyLensTool(url, "manage_applications", {
    operation
  });
  return normalizeMcpContent(result);
}

export async function takePhoto(url: string) {
  const result = await callHuskyLensTool(url, "multimedia_control", {
    operation: "take_photo",
    resolution: "1280x720"
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
  const workers = Array.from({ length: 32 }, async () => {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) return;
      if (await looksLikeMcpSse(url)) {
        found.push(url);
      }
    }
  });
  await Promise.all(workers);
  return found.sort();
}

function getSubnetCandidates() {
  const urls = new Set<string>();
  for (const values of Object.values(networkInterfaces())) {
    for (const value of values || []) {
      if (value.family !== "IPv4" || value.internal) continue;
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

async function looksLikeMcpSse(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 650);
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
      resource.port = "";
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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function enqueueToolCall<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = toolQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  toolQueues.set(
    key,
    next.finally(() => {
      if (toolQueues.get(key) === next) {
        toolQueues.delete(key);
      }
    })
  );
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
