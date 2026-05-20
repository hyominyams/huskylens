import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MCP_REFERENCE = loadMcpReference();

const ASSISTANT_INSTRUCTIONS = [
  "너는 HUSKYLENS 2와 연결된 정밀한 비전 AI 비서다.",
  "사용자에게 정확하고 세련된 한국어 답변을 제공한다.",
  "HUSKYLENS의 structured detection과 실제 이미지를 함께 참고한다.",
  "detection label은 중요한 단서지만, 이미지와 맞지 않거나 확신이 낮으면 불확실성을 명확히 말한다.",
  "이미지가 흐리거나 장면 정보가 부족하면 단정하지 말고 무엇을 다시 보여주면 좋은지 짧게 안내한다.",
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
  "백엔드가 실제 MCP 도구를 호출하지 않은 작업은 실행했다고 말하지 않는다."
].join("\n");

type AnswerInput = {
  apiKey?: string;
  model?: string;
  reasoningEffort?: string;
  question: string;
  visionContext: unknown;
  mcpTools?: unknown;
  attachments?: string[];
};

export async function answerWithOpenAI(input: AnswerInput) {
  const apiKey = input.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API 키가 필요합니다. 화면에 입력하거나 .env에 OPENAI_API_KEY를 설정하세요.");
  }

  const client = new OpenAI({ apiKey });
  const model = input.model || process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const reasoningEffort = input.reasoningEffort || process.env.OPENAI_REASONING_EFFORT || "low";
  const visionImages = await getVisionImageInputs(input.visionContext);
  const userImages = (input.attachments || [])
    .filter((url) => typeof url === "string" && url.startsWith("data:image/"))
    .slice(0, 4)
    .map((url) => ({ type: "input_image", image_url: url }));

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
              `사용자 첨부 이미지 수: ${userImages.length}`,
              `HUSKYLENS 첨부 이미지 수: ${visionImages.length}`,
              "HUSKYLENS 2 인식 결과:",
              summarizeVisionContext(input.visionContext),
              "답변 지침:",
              "- 먼저 사용자의 질문에 직접 답한다.",
              "- 사용자가 직접 업로드한 이미지가 있으면 이를 우선 참고한다.",
              "- detection 결과와 이미지가 모두 비어 있거나 불명확하면 그렇게 말한다.",
              "- 일반 질문은 MCP 도구 규칙에 갇히지 말고 자연스럽게 답한다.",
              "- MCP 기능이나 장치 조작 질문은 raw tool schema와 참조 문서를 근거로 판단한다.",
              "- 답변은 Markdown으로 작성해도 된다."
            ].join("\n\n")
          },
          ...userImages,
          ...visionImages
        ] as any
      }
    ]
  });

  return response.output_text;
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

async function getVisionImageInputs(visionContext: unknown) {
  const urls = extractImageUrls(visionContext).slice(0, 1);
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
    if (typeof record.uri === "string" && String(record.mimeType || "").startsWith("image/")) {
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
