import dotenv from "dotenv";
import { existsSync } from "node:fs";
import http from "node:http";
import { networkInterfaces } from "node:os";

dotenv.config({ quiet: true });

type FetchJsonResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const requiredMajor = 20;
const nodeMajor = Number(process.versions.node.split(".")[0]);
let hasCriticalFailure = false;

console.log("HUSKYLENS AI 점검");
console.log("");

section("실행 환경");
line("Node.js", process.version, nodeMajor >= requiredMajor);
line(".env", existsSync(".env") ? "있음" : "없음", existsSync(".env"), false);
line(
  "OPENAI_API_KEY",
  process.env.OPENAI_API_KEY?.trim() ? "서버 키 사용 가능" : "웹앱에서 입력 필요",
  true
);

section("앱 주소");
console.log("- http://localhost:5173");
for (const item of getLocalAddresses()) {
  console.log(`- http://${item}:5173`);
}

section("서버 상태");
const apiPortInUse = await checkPort(8787, "API 서버");
const webPortInUse = await checkPort(5173, "웹 서버");

if (apiPortInUse) {
  const health = await fetchJson("http://localhost:8787/api/health", 1200);
  const healthData = health.ok ? asRecord(health.data) : {};
  line(
    "API 응답",
    health.ok ? `정상 · 모델 ${String(healthData.openaiModel || "-")}` : health.error,
    health.ok
  );

  const startedAt = Date.now();
  const discovery = await fetchJson("http://localhost:8787/api/huskylens/discover", 5200);
  const duration = Date.now() - startedAt;
  line(
    "자동 찾기",
    discovery.ok
      ? `${duration}ms · ${Array.isArray(discovery.data) ? discovery.data.length : 0}대 발견`
      : discovery.error,
    discovery.ok
  );

  const askWithoutDevice = await postJson(
    "http://localhost:8787/api/ask",
    { question: "지금 무엇이 보여?" },
    1200
  );
  line(
    "연결 없는 질문 차단",
    askWithoutDevice.ok ? "차단되지 않음" : askWithoutDevice.error,
    !askWithoutDevice.ok && askWithoutDevice.error.includes("HUSKYLENS 연결이 필요합니다")
  );

  const screenWithoutUrl = await postJson(
    "http://localhost:8787/api/huskylens/screen",
    {},
    1200
  );
  line(
    "주소 없는 화면 차단",
    screenWithoutUrl.ok ? "차단되지 않음" : screenWithoutUrl.error,
    !screenWithoutUrl.ok && screenWithoutUrl.error.includes("HUSKYLENS MCP URL이 필요합니다")
  );
} else {
  console.log("- API 서버: 실행 전");
}

if (!webPortInUse) {
  console.log("- 웹 서버: 실행 전");
}

section("HUSKYLENS 연결 확인");
console.log("- HUSKYLENS 2와 노트북을 같은 Wi-Fi에 연결하세요.");
console.log("- HUSKYLENS 2에서 MCP Service를 켜세요.");
console.log("- 주소 형식: http://<HUSKYLENS_IP>:3000/sse");
console.log("- 실제 장치 검증: docs/hardware-validation.md");

if (hasCriticalFailure) {
  process.exitCode = 1;
}

function section(title: string) {
  console.log("");
  console.log(`[${title}]`);
}

function line(label: string, value: string, ok: boolean, critical = true) {
  if (!ok && critical) hasCriticalFailure = true;
  console.log(`- ${label}: ${ok ? "OK" : "확인 필요"} · ${value}`);
}

function getLocalAddresses() {
  const addresses: string[] = [];
  for (const [name, values] of Object.entries(networkInterfaces())) {
    if (!isClassroomInterface(name)) continue;
    for (const value of values || []) {
      if (value.family === "IPv4" && !value.internal && !isLinkLocalAddress(value.address)) {
        addresses.push(value.address);
      }
    }
  }
  return addresses;
}

function isClassroomInterface(name: string) {
  return !/^(lo|utun|tun|tap|wg|zt|tailscale|awdl|llw|bridge|vboxnet|vmnet|docker)/i.test(name);
}

function isLinkLocalAddress(address: string) {
  return address.startsWith("169.254.") || address === "0.0.0.0";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function checkPort(port: number, label: string) {
  return new Promise<boolean>((resolve) => {
    const req = http.get({ host: "localhost", port, path: "/", timeout: 900 }, (res) => {
      res.resume();
      line(label, `port ${port} 응답`, true);
      resolve(true);
    });
    req.on("timeout", () => {
      req.destroy();
      line(label, `port ${port} 응답 없음`, false);
      resolve(false);
    });
    req.on("error", () => {
      line(label, `port ${port} 응답 없음`, false);
      resolve(false);
    });
  });
}

async function fetchJson(url: string, timeoutMs: number): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const json = await response.json();
    if (!response.ok || json?.ok === false) {
      return {
        ok: false,
        error: String(json?.error || `${response.status} ${response.statusText}`)
      };
    }
    return { ok: true, data: json.data ?? json };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const json = await response.json();
    if (!response.ok || json?.ok === false) {
      return {
        ok: false,
        error: String(json?.error || `${response.status} ${response.statusText}`)
      };
    }
    return { ok: true, data: json.data ?? json };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
