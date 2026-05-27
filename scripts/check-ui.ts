import { readFileSync } from "node:fs";

type Check = {
  label: string;
  file: string;
  pattern: RegExp;
  message: string;
};

type RequiredCheck = {
  label: string;
  file: string;
  value: string;
  message: string;
};

const forbiddenChecks: Check[] = [
  {
    label: "UI gradient",
    file: "src/web/main.tsx",
    pattern: /(?:bg-gradient|linear-gradient|radial-gradient)/i,
    message: "화면 UI에는 gradient를 쓰지 않습니다."
  },
  {
    label: "CSS gradient",
    file: "src/web/styles.css",
    pattern: /(?:linear-gradient|radial-gradient)/i,
    message: "스타일시트에는 gradient를 쓰지 않습니다."
  },
  {
    label: "Meta copy",
    file: "src/web/main.tsx",
    pattern: /(?:정리했습니다|구성했습니다|배치했습니다|비교할 수 있도록)/,
    message: "사용자 화면 문구는 구현 설명처럼 보이면 안 됩니다."
  },
  {
    label: "Old default URL",
    file: "src/web/main.tsx",
    pattern: /192\.168\.0\.100/,
    message: "허스키렌즈 주소를 고정 기본값으로 넣지 않습니다."
  },
  {
    label: "Model UI",
    file: "src/web/main.tsx",
    pattern: /(?:defaultModel|setModel|reasoningEffort|setReasoningEffort)/,
    message: "학생 화면에서 모델과 추론 강도 선택을 노출하지 않습니다."
  },
  {
    label: "Upload UI",
    file: "src/web/main.tsx",
    pattern: /(?:MAX_ATTACHMENTS|attachments|ImagePlus)/,
    message: "대회 앱에는 카메라 외 업로드 흐름을 두지 않습니다."
  },
  {
    label: "Implementation copy",
    file: "src/web/main.tsx",
    pattern: /(?:OpenAI API Key|서버 API 키 사용 중|raw tool|schema)/i,
    message: "학생 화면에는 내부 구현 문구를 노출하지 않습니다."
  },
  {
    label: "Glass effect",
    file: "src/web/main.tsx",
    pattern: /(?:backdrop-blur|panel-glass)/,
    message: "IDE형 화면에는 흐릿한 glass 효과를 쓰지 않습니다."
  }
];

const requiredChecks: RequiredCheck[] = [
  {
    label: "Primary screen",
    file: "src/web/main.tsx",
    value: "허스키렌즈 화면",
    message: "큰 HUSKYLENS 화면이 기본 학생 화면에 남아 있어야 합니다."
  },
  {
    label: "Right chat",
    file: "src/web/main.tsx",
    value: "AI 채팅",
    message: "오른쪽 패널이 AI 채팅 영역이라는 신호가 보여야 합니다."
  },
  {
    label: "Chat disabled before device connection",
    file: "src/web/main.tsx",
    value: "허스키렌즈를 연결하면 질문할 수 있습니다",
    message: "연결 전 채팅 입력은 장치 연결이 필요하다는 상태를 보여야 합니다."
  },
  {
    label: "Connection checklist service",
    file: "src/web/main.tsx",
    value: "MCP Service 켜기",
    message: "학생이 장치에서 켜야 할 항목이 연결 전 화면에 보여야 합니다."
  },
  {
    label: "Connection checklist Wi-Fi",
    file: "src/web/main.tsx",
    value: "같은 Wi-Fi 연결",
    message: "같은 Wi-Fi 안내가 연결 전 화면에 보여야 합니다."
  },
  {
    label: "Connection checklist discovery",
    file: "src/web/main.tsx",
    value: "자동 찾기 또는 주소 입력",
    message: "자동 찾기와 직접 입력이 모두 가능한 흐름이 보여야 합니다."
  },
  {
    label: "Discovered device direct connect",
    file: "src/web/main.tsx",
    value: "장치를 누르면 연결됩니다",
    message: "자동으로 찾은 장치는 한 번 누르면 바로 연결되어야 합니다."
  },
  {
    label: "Markdown renderer",
    file: "src/web/main.tsx",
    value: "<ReactMarkdown",
    message: "AI 답변은 Markdown으로 렌더링되어야 합니다."
  },
  {
    label: "RTSP stream proxy",
    file: "src/web/main.tsx",
    value: "getHuskyLensRtspProxyUrl",
    message: "큰 화면은 로컬 백엔드를 거친 HUSKYLENS RTSP 영상을 사용해야 합니다."
  },
  {
    label: "Answer preserves RTSP stream",
    file: "src/web/main.tsx",
    value: "includeScreen: false",
    message: "일반 AI 답변은 영상을 멈출 수 있는 MCP 화면 캡처를 요청하지 않아야 합니다."
  },
  {
    label: "Answer RTSP status",
    file: "src/web/main.tsx",
    value: "RTSP 영상",
    message: "RTSP 영상 상태를 학생 화면에서 알 수 있어야 합니다."
  },
  {
    label: "Ignore late screen refresh while answering",
    file: "src/web/main.tsx",
    value: "holdScreenForAnswer();",
    message: "질문 직전에 진행 중이던 화면 갱신 결과가 답변 중 화면을 흔들지 않아야 합니다."
  },
  {
    label: "Screen stale guard",
    file: "src/web/main.tsx",
    value: "clearSceneForAddressChange",
    message: "주소 변경 시 이전 화면과 장면 맥락을 지우는 보호 로직이 필요합니다."
  },
  {
    label: "Conversation reset on device change",
    file: "src/web/main.tsx",
    value: "resetConversationState();\n      clearSceneForAddressChange();",
    message: "연결된 장치 주소가 바뀌면 이전 대화와 장면 상태를 함께 초기화해야 합니다."
  },
  {
    label: "Answer stale guard",
    file: "src/web/main.tsx",
    value: "askRequestSeqRef",
    message: "주소 변경 중 늦게 도착한 이전 AI 답변을 무시해야 합니다."
  },
  {
    label: "Ask requires device",
    file: "src/server/index.ts",
    value: "HUSKYLENS 연결이 필요합니다.",
    message: "AI 질문은 실제 HUSKYLENS 연결 없이는 처리되면 안 됩니다."
  },
  {
    label: "Ask reads scene",
    file: "src/server/index.ts",
    value: "getRecognitionResult(req.body.huskylensUrl",
    message: "AI 질문은 HUSKYLENS 인식 결과 읽기를 우선 시도해야 합니다."
  },
  {
    label: "Ask reuses latest screen when recognition is slow",
    file: "src/server/index.ts",
    value: "visionContext = fallbackVisionContext;",
    message: "이미 받은 인식 결과나 화면이 있으면 느린 인식 호출 때문에 질문이 과하게 지연되면 안 됩니다."
  },
  {
    label: "Ask sends latest vision context",
    file: "src/web/main.tsx",
    value: "visionContext: latestVisionContext ?? recognition.data",
    message: "프론트는 이미 받은 최신 인식 결과를 질문 요청에 함께 보내야 합니다."
  },
  {
    label: "Ask uses OpenAI after scene",
    file: "src/server/index.ts",
    value: "answerWithOpenAI({",
    message: "OpenAI 답변은 서버가 수집한 장면 컨텍스트와 함께 생성되어야 합니다."
  },
  {
    label: "Screen route uses screenshot",
    file: "src/server/index.ts",
    value: "takeScreenshot(req.body.url",
    message: "큰 화면 엔드포인트는 HUSKYLENS 화면 스냅샷을 우선 사용해야 합니다."
  },
  {
    label: "Screen route is screenshot only",
    file: "src/server/index.ts",
    value: "captureMode: \"screenshot\"",
    message: "큰 화면 엔드포인트는 인식 결과 이미지 fallback 없이 스크린샷 결과만 반환해야 합니다."
  },
  {
    label: "OpenAI sees HUSKYLENS image",
    file: "src/server/openaiClient.ts",
    value: "HUSKYLENS 이미지 수",
    message: "AI 답변에는 HUSKYLENS 이미지 컨텍스트가 전달되어야 합니다."
  }
];

const oldUiChecks: Check[] = [
  {
    label: "Old scene button",
    file: "src/web/main.tsx",
    pattern: /현재 장면 읽기/,
    message: "학생 화면은 별도 장면 읽기 버튼 대신 큰 화면과 채팅을 중심으로 둡니다."
  },
  {
    label: "Old vision data panel",
    file: "src/web/main.tsx",
    pattern: /비전 데이터/,
    message: "원시 데이터 패널은 기본 학생 화면에 다시 넣지 않습니다."
  },
  {
    label: "Old model panel",
    file: "src/web/main.tsx",
    pattern: /언어 모델/,
    message: "학생 화면에는 모델 설정 패널을 노출하지 않습니다."
  },
  {
    label: "Old attachment copy",
    file: "src/web/main.tsx",
    pattern: /첨부/,
    message: "대회 앱에는 카메라 외 업로드 흐름을 두지 않습니다."
  }
];

const noRecognitionScreenFallbackChecks: Check[] = [
  {
    label: "No recognition screen mode",
    file: "src/web/main.tsx",
    pattern: /장면 화면|screenCaptureMode|captureMode === "recognition"|setScreenCaptureMode/,
    message: "큰 화면은 인식 결과 이미지 모드로 전환하지 않습니다."
  },
  {
    label: "No server recognition screen fallback",
    file: "src/server/index.ts",
    pattern: /preferRecognition|captureMode: "recognition"|timeoutMs: background \? 800/,
    message: "화면 엔드포인트는 인식 결과 이미지 fallback을 쓰지 않습니다."
  }
];

let failed = false;

for (const check of [...forbiddenChecks, ...oldUiChecks, ...noRecognitionScreenFallbackChecks]) {
  const source = readFileSync(check.file, "utf8");
  const match = source.match(check.pattern);
  if (match) {
    failed = true;
    console.error(`FAIL ${check.label}: ${check.message}`);
    console.error(`  ${check.file}: ${match[0]}`);
  }
}

for (const check of requiredChecks) {
  const source = readFileSync(check.file, "utf8");
  if (!source.includes(check.value)) {
    failed = true;
    console.error(`FAIL ${check.label}: ${check.message}`);
    console.error(`  ${check.file}: missing ${JSON.stringify(check.value)}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI guardrails: OK");
}
