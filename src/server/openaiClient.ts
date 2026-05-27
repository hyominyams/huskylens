import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MCP_REFERENCE = loadMcpReference();

const ASSISTANT_INSTRUCTIONS = [
  "너는 HUSKYLENS 2와 연결된 정밀한 비전 AI 비서다.",
  "사용자에게 정확하고 세련된 한국어 답변을 제공한다.",
  "HUSKYLENS의 structured detection과 실제 이미지를 함께 참고한다.",
  "실제 이미지가 전달되지 않아도 HUSKYLENS structured detection은 장치가 관측한 사실 데이터로 취급한다.",
  "이미지가 없다는 이유만으로 '볼 수 없다', '판단할 수 없다'고 답하지 않는다.",
  "이미지가 없고 detection 데이터가 있으면 detection 데이터 기준으로 직접 답하되, 필요한 경우 '인식 결과 기준'이라고만 짧게 밝힌다.",
  "detection label은 중요한 단서지만, 이미지와 맞지 않거나 확신이 낮으면 불확실성을 명확히 말한다.",
  "detection 데이터도 비어 있고 이미지도 없을 때만 장면 정보가 부족하다고 말한다.",
  "인식 결과의 xCenter, yCenter, width, height 같은 좌표나 bbox 값은 사용자에게 그대로 말하지 않는다.",
  "위치는 초등학생도 이해할 수 있게 '화면 왼쪽', '오른쪽 위', '가운데 아래', '앞쪽에 크게'처럼 쉬운 말로 설명한다.",
  "무엇이 보이는지, 화면의 어느 쪽에 있는지, 어느 방향으로 보이는지를 짧고 자연스럽게 말한다.",
  "숫자 좌표가 필요하지 않은 질문에는 좌표, 픽셀, bbox, center 같은 표현을 쓰지 않는다.",
  "학생 대회 환경에 맞게 실행 가능한 다음 행동을 제안한다.",
  "기본 답변은 1-3문장으로 간결하게 쓴다.",
  "사용자가 비교, 절차, 목록을 요청하면 Markdown 목록이나 표를 사용한다.",
  "필요할 때만 굵게 표시를 사용하고, 과장된 표현은 피한다.",
  "원시 JSON, 내부 파라미터, MCP 구현 세부사항은 사용자가 묻지 않으면 노출하지 않는다.",
  "MCP 기능에 대해 답할 때는 제공된 MCP 참조 문서를 우선 따른다.",
  "raw tool schema는 MCP 기능 판단의 원문 근거로 사용하되, 일반 장면 대화의 답변을 제한하는 규칙으로 쓰지 않는다.",
  "HUSKYLENS MCP가 지원하는 기능과 현재 웹앱에서 실제 실행 가능한 기능을 구분한다.",
  "문서에 정확히 맞지 않는 일반 질문도 거절하지 말고, 장면 맥락과 사용자의 의도에 맞게 자연스럽게 답한다.",
  "애매한 장치 조작 요청은 바로 거절하지 말고 가장 가까운 가능한 기능을 설명한다.",
  "백엔드가 실제 MCP 도구를 호출하지 않은 작업은 실행했다고 말하지 않는다.",
  "사진 촬영을 실행한 경우에는 컴퓨터 화면 캡처가 아니라 HUSKYLENS MCP로 장치에 촬영 명령을 보냈다는 의미로 답한다."
].join("\n");

type AnswerInput = {
  apiKey?: string;
  question: string;
  visionContext: unknown;
  screenContext?: unknown;
  mcpTools?: unknown;
  history?: Array<{ role?: unknown; text?: unknown }>;
};

export type AiMcpActionPlan =
  | { action: "none"; reason?: string; userMessage?: string }
  | { action: "take_photo"; reason?: string; userMessage?: string }
  | { action: "schedule_photo"; trigger: string; originalTrigger?: string; reason?: string; userMessage?: string }
  | { action: "ask_clarification"; question: string; reason?: string; userMessage?: string };

type ActionPlanInput = {
  apiKey?: string;
  question: string;
  mcpTools?: unknown;
  history?: Array<{ role?: unknown; text?: unknown }>;
};

type ActionResultInput = AnswerInput & {
  deviceAction: unknown;
};

export async function planMcpActionWithOpenAI(input: ActionPlanInput): Promise<AiMcpActionPlan> {
  const apiKey = input.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API 키가 필요합니다. 화면에 입력하거나 .env에 OPENAI_API_KEY를 설정하세요.");
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || "low";

  const response = await client.responses.create({
    model,
    reasoning: {
      effort: normalizeReasoningEffort(reasoningEffort)
    },
    input: [
      {
        role: "system",
        content: [
          "너는 HUSKYLENS 2 MCP 액션 라우터다.",
          "사용자 요청을 먼저 판단하고, MCP 도구 호출이 필요한지 결정한다.",
          "백엔드 정규식이 아니라 네가 MCP 호출 여부를 결정한다.",
          "사진 찍기, 촬영, 캡처 요청은 컴퓨터 화면 캡처가 아니라 HUSKYLENS 2 MCP multimedia_control take_photo 의도로 판단한다.",
          "어떤 대상이 보이거나 감지될 때마다 촬영하라는 요청은 task_scheduler create_task 의도로 판단한다.",
          "조건부 촬영인데 대상이 빠져 있으면 ask_clarification을 선택한다.",
          "일반 질문이나 장면 설명 요청이면 none을 선택한다.",
          "반드시 JSON 하나만 출력한다.",
          "허용 JSON 형태:",
          '{"action":"none","reason":"..."}',
          '{"action":"take_photo","reason":"..."}',
          '{"action":"schedule_photo","trigger":"person","originalTrigger":"사람","reason":"..."}',
          '{"action":"ask_clarification","question":"무엇이 보일 때 사진을 찍을까요?","reason":"..."}',
          "HUSKYLENS MCP 참조 문서:",
          MCP_REFERENCE,
          "현재 연결된 HUSKYLENS MCP raw tool schema:",
          formatMcpTools(input.mcpTools)
        ].join("\n\n")
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `사용자 요청: ${input.question}`,
              "최근 대화:",
              formatConversationHistory(input.history),
              "JSON만 출력한다."
            ].join("\n\n")
          }
        ]
      }
    ]
  });

  return normalizeActionPlan(response.output_text);
}

export async function answerWithOpenAI(input: AnswerInput) {
  const apiKey = input.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API 키가 필요합니다. 화면에 입력하거나 .env에 OPENAI_API_KEY를 설정하세요.");
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || "low";
  const visionImages = await getVisionImageInputs(input.screenContext);

  const response = await client.responses.create({
    model,
    reasoning: {
      effort: normalizeReasoningEffort(reasoningEffort)
    },
    input: [
      {
        role: "system",
        content: [
          ASSISTANT_INSTRUCTIONS,
          "HUSKYLENS MCP 참조 문서:",
          MCP_REFERENCE,
          "현재 연결된 HUSKYLENS MCP raw tool schema:",
          formatMcpTools(input.mcpTools)
        ].join("\n\n")
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `학생 질문: ${input.question}`,
              `HUSKYLENS 이미지 수: ${visionImages.length}`,
              "최근 대화:",
              formatConversationHistory(input.history),
              "HUSKYLENS 2 인식 결과:",
              summarizeVisionContext(input.visionContext),
              "HUSKYLENS 화면 스냅샷:",
              summarizeScreenContext(input.screenContext),
              "답변 지침:",
              "- 먼저 사용자의 질문에 직접 답한다.",
              "- 최근 대화가 있으면 맥락을 이어서 답한다.",
              "- 이미지가 없어도 detection 결과가 있으면 그 데이터를 사실 근거로 삼아 답한다.",
              "- detection 결과와 이미지가 모두 비어 있을 때만 장면 정보가 부족하다고 말한다.",
              "- 좌표값, bbox, xCenter, yCenter를 그대로 말하지 말고 쉬운 위치 표현으로 바꿔 말한다.",
              "- 예: 'xCenter가 240입니다' 대신 '화면 오른쪽에 보여요'라고 답한다.",
              "- 초등학생도 이해할 수 있게 무엇이 보이는지와 화면 어느 쪽에 있는지를 중심으로 설명한다.",
              "- '보지는 못하지만', '이미지가 없어 판단할 수 없습니다' 같은 회피 답변을 기본으로 쓰지 않는다.",
              "- 일반 질문은 MCP 도구 규칙에 갇히지 말고 자연스럽게 답한다.",
              "- MCP 기능이나 장치 조작 질문은 raw tool schema와 참조 문서를 근거로 판단한다.",
              "- 답변은 Markdown으로 작성해도 된다."
            ].join("\n\n")
          },
          ...visionImages
        ] as any
      }
    ]
  });

  return response.output_text;
}

export async function answerAfterMcpActionWithOpenAI(input: ActionResultInput) {
  return answerWithOpenAI({
    ...input,
    question: [
      input.question,
      "",
      "MCP 장치 작업 실행 결과를 바탕으로 사용자에게 자연스럽게 답한다.",
      "장치 작업은 이미 백엔드에서 실행되었다. 성공이면 실행했다고 말하고, 실패면 실패 이유와 다음 확인 항목을 짧게 말한다.",
      "컴퓨터 화면 캡처가 아니라 HUSKYLENS 2 기기 MCP 명령이라는 점을 혼동하지 않는다.",
      `MCP 장치 작업 결과: ${formatForPrompt(input.deviceAction, 12000)}`
    ].join("\n")
  });
}

function normalizeActionPlan(text: string): AiMcpActionPlan {
  const parsed = parseJsonObject(text);
  if (!parsed) return { action: "none", reason: "AI action plan JSON parse failed." };
  const action = typeof parsed.action === "string" ? parsed.action : "none";
  if (action === "take_photo") {
    return {
      action,
      reason: stringOrUndefined(parsed.reason),
      userMessage: stringOrUndefined(parsed.userMessage)
    };
  }
  if (action === "schedule_photo") {
    const trigger = stringOrUndefined(parsed.trigger)?.trim();
    if (!trigger) {
      return {
        action: "ask_clarification",
        question: "무엇이 보일 때 사진을 찍을까요?",
        reason: "조건부 촬영 대상이 없습니다."
      };
    }
    return {
      action,
      trigger,
      originalTrigger: stringOrUndefined(parsed.originalTrigger) || trigger,
      reason: stringOrUndefined(parsed.reason),
      userMessage: stringOrUndefined(parsed.userMessage)
    };
  }
  if (action === "ask_clarification") {
    return {
      action,
      question: stringOrUndefined(parsed.question) || "무엇을 할지 조금 더 알려주세요.",
      reason: stringOrUndefined(parsed.reason),
      userMessage: stringOrUndefined(parsed.userMessage)
    };
  }
  return {
    action: "none",
    reason: stringOrUndefined(parsed.reason),
    userMessage: stringOrUndefined(parsed.userMessage)
  };
}

function parseJsonObject(text: string) {
  try {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatConversationHistory(history: AnswerInput["history"]) {
  if (!Array.isArray(history) || history.length === 0) return "최근 대화 없음";
  return history
    .filter((message) => message && (message.role === "assistant" || message.role === "user") && typeof message.text === "string")
    .slice(-8)
    .map((message, index) => {
      const role = message.role === "assistant" ? "assistant" : "user";
      return `${index + 1}. ${role}: ${String(message.text).slice(0, 1400)}`;
    })
    .join("\n");
}

function formatForPrompt(value: unknown, maxLength: number) {
  try {
    return JSON.stringify(value, null, 2).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function formatMcpTools(value: unknown) {
  if (!value) return "[]";
  try {
    return JSON.stringify(value, null, 2).slice(0, 30000);
  } catch {
    return "[]";
  }
}

function loadMcpReference() {
  const candidatePaths = [
    resolve(process.cwd(), "docs/MCP_REFERENCE.md"),
    resolve(process.cwd(), "../docs/MCP_REFERENCE.md"),
    resolve(process.cwd(), "../../docs/MCP_REFERENCE.md")
  ];
  try {
    const path = candidatePaths.find((candidate) => {
      try {
        readFileSync(candidate, "utf8");
        return true;
      } catch {
        return false;
      }
    });
    if (!path) throw new Error("MCP reference not found.");
    return readFileSync(path, "utf8").slice(0, 16000);
  } catch {
    return [
      "MCP reference unavailable.",
      "The assistant must not claim device actions were executed unless the backend actually called an MCP tool.",
      "Scene answers can use structured detections and HUSKYLENS images when available."
    ].join("\n");
  }
}

function summarizeVisionContext(value: unknown) {
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? value : "인식 결과가 없습니다.";
  }

  const context = value as {
    algorithm?: unknown;
    detections?: Array<Record<string, unknown>>;
    resources?: Array<Record<string, unknown>>;
    currentApplication?: unknown;
  };

  const detections = Array.isArray(context.detections) ? context.detections : [];
  const resources = Array.isArray(context.resources) ? context.resources : [];
  const detectionSummary =
    detections.length > 0
      ? detections
          .map((item, index) => {
            const name = item.name || item.content || "unknown";
            const id = item.id ?? "n/a";
            const hasBox = [item.xCenter, item.yCenter, item.width, item.height].every(
              (part) => typeof part === "number"
            );
            const box = hasBox
              ? `bbox(center=${item.xCenter},${item.yCenter}, size=${item.width}x${item.height})`
              : "bbox=n/a";
            return `${index + 1}. ${name} (id=${id}, ${box})`;
          })
          .join("\n")
      : "감지된 객체 없음";

  return [
    `activeAlgorithm: ${context.algorithm ?? "unknown"}`,
    `imageResources: ${resources.length}`,
    "detections:",
    detectionSummary,
    "rawContext:",
    JSON.stringify(value, null, 2)
  ].join("\n");
}

function normalizeReasoningEffort(value: string) {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "low";
}

function summarizeScreenContext(value: unknown) {
  if (!value) return "화면 스냅샷 없음";
  const urls = extractImageUrls(value);
  return [
    `imageResources: ${urls.length}`,
    "rawContext:",
    JSON.stringify(value, null, 2).slice(0, 12000)
  ].join("\n");
}

async function getVisionImageInputs(...contexts: unknown[]) {
  const urls = [...new Set(contexts.flatMap((context) => extractImageUrls(context)))].slice(0, 2);
  const images = [];
  for (const url of urls) {
    const dataUrl = await fetchImageAsDataUrl(url);
    if (dataUrl) {
      images.push({
        type: "input_image",
        image_url: dataUrl
      });
    }
  }
  return images;
}

function extractImageUrls(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const urls: string[] = [];
  const visit = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    const record = item as Record<string, unknown>;
    const mimeType = typeof record.mimeType === "string" ? record.mimeType : "";
    if (typeof record.uri === "string" && (!mimeType || mimeType.startsWith("image/"))) {
      urls.push(record.uri);
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return urls;
}

async function fetchImageAsDataUrl(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
