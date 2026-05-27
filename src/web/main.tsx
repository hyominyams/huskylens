import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Aperture,
  Camera,
  Check,
  CircleAlert,
  Eye,
  FolderOpen,
  Loader2,
  MessageSquare,
  Monitor,
  Pause,
  Play,
  Radar,
  RefreshCcw,
  Send,
  Settings2,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
  X,
  Zap,
  Power
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./styles.css";

type ApiState<T = unknown> = {
  loading: boolean;
  error: string;
  data: T | null;
};

type ToolInfo = {
  name: string;
  description?: string;
};

type ConnectionData = {
  url: string;
  connectedAt: string;
  tools: ToolInfo[];
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  context?: unknown;
  at: number;
  displayLen?: number;
};

type ScreenPayload = {
  resources?: Array<Record<string, unknown>>;
  detections?: Array<Record<string, unknown>>;
  captureMode?: "screenshot" | "photo";
  durationMs?: number;
  raw?: unknown;
  values?: unknown[];
};

type AppMode = "select" | "stream" | "chat";

type StreamCapture = {
  id: string;
  timestamp: string;
  deviceHost: string;
  cameraName?: string;
  displayName?: string;
  path: string;
  fileName: string;
  absolutePath?: string;
  metadata?: {
    source?: string;
    durationMs?: number;
  };
};

const initialAssistantMessage = {
  role: "assistant" as const,
  text: "허스키렌즈를 연결하고 카메라가 보는 장면에 대해 자유롭게 질문해 주세요. 인식 데이터를 함께 읽고 답변해 드립니다."
};

const defaultMcpUrl = localStorage.getItem("huskylens:mcpUrl") || "";
const defaultStreamUrl = localStorage.getItem("huskylens:streamUrl") || "";
const defaultCameraName = localStorage.getItem("huskylens:cameraName") || "";

function App() {
  const [appMode, setAppMode] = useState<AppMode>("select");
  const [mcpUrl, setMcpUrl] = useState(defaultMcpUrl);
  const [cameraName, setCameraName] = useState(defaultCameraName);
  const [openaiApiKey, setOpenaiApiKey] = useState(
    localStorage.getItem("huskylens:openaiApiKey") || ""
  );
  const [question, setQuestion] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [screenPolling, setScreenPolling] = useState(false);
  const [screenFrameTick, setScreenFrameTick] = useState(0);
  const [latestVisionContext, setLatestVisionContext] = useState<unknown>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createInitialAssistantMessage()]);
  const [health, setHealth] = useState<ApiState<Record<string, unknown>>>({
    loading: true,
    error: "",
    data: null
  });
  const [connection, setConnection] = useState<ApiState<ConnectionData>>({
    loading: false,
    error: "",
    data: null
  });
  const [discovery, setDiscovery] = useState<ApiState<string[]>>({
    loading: false,
    error: "",
    data: null
  });
  const [recognition, setRecognition] = useState<ApiState>({
    loading: false,
    error: "",
    data: null
  });
  const [screenCapture, setScreenCapture] = useState<ApiState<ScreenPayload>>({
    loading: false,
    error: "",
    data: null
  });
  const [answer, setAnswer] = useState<
    ApiState<{ answer: string; visionContext: unknown; screenContext?: unknown }>
  >({ loading: false, error: "", data: null });
  const [captureHistory, setCaptureHistory] = useState<ApiState<StreamCapture[]>>({
    loading: false,
    error: "",
    data: []
  });
  const [captureAction, setCaptureAction] = useState<ApiState<StreamCapture>>({
    loading: false,
    error: "",
    data: null
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const activeScreenRequestRef = useRef<number | null>(null);
  const screenRequestSeqRef = useRef(0);
  const screenDelayRef = useRef(800);
  const screenFailureCountRef = useRef(0);
  const connectRequestRef = useRef(0);
  const discoveryRequestRef = useRef(0);
  const askRequestSeqRef = useRef(0);
  const initialDiscoveryRef = useRef(false);

  useEffect(() => {
    void loadHealth();
  }, []);

  useEffect(() => {
    if (openaiApiKey) localStorage.setItem("huskylens:openaiApiKey", openaiApiKey);
    else localStorage.removeItem("huskylens:openaiApiKey");
  }, [openaiApiKey]);

  useEffect(() => {
    if (cameraName.trim()) localStorage.setItem("huskylens:cameraName", cameraName.trim());
    else localStorage.removeItem("huskylens:cameraName");
  }, [cameraName]);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, answer.loading]);

  const hasServerApiKey = health.data?.apiKeySource === "server" || Boolean(health.data?.hasServerApiKey);
  const needsApiKey =
    !health.loading && !hasServerApiKey && openaiApiKey.trim().length === 0;
  const urlMatchesConnection = connection.data?.url === mcpUrl.trim();
  const connectedToCurrentUrl = Boolean(connection.data && urlMatchesConnection);
  const canAsk = useMemo(() => {
    const hasKey = hasServerApiKey || openaiApiKey.trim().length > 0;
    const hasInput = question.trim().length > 0;
    return hasInput && hasKey && connectedToCurrentUrl;
  }, [connectedToCurrentUrl, hasServerApiKey, openaiApiKey, question]);

  useEffect(() => {
    if (!streamingId) return;
    const message = messages.find((m) => m.id === streamingId);
    if (!message || typeof message.displayLen !== "number") {
      setStreamingId(null);
      return;
    }
    const total = message.text.length;
    if (message.displayLen >= total) {
      setMessages((curr) =>
        curr.map((m) =>
          m.id === streamingId ? { ...m, displayLen: undefined } : m
        )
      );
      setStreamingId(null);
      return;
    }
    const step = Math.max(2, Math.ceil(total / 90));
    const next = Math.min(total, message.displayLen + step);
    const timer = window.setTimeout(() => {
      setMessages((curr) =>
        curr.map((m) =>
          m.id === streamingId ? { ...m, displayLen: next } : m
        )
      );
    }, 22);
    return () => window.clearTimeout(timer);
  }, [messages, streamingId]);

  useEffect(() => {
    if (needsApiKey) setShowSettings(true);
  }, [needsApiKey]);

  useEffect(() => {
    if (appMode === "select") return;
    if (appMode === "stream") {
      const storedUrl = (
        localStorage.getItem("huskylens:streamUrl") ||
        localStorage.getItem("huskylens:mcpUrl") ||
        defaultStreamUrl ||
        defaultMcpUrl
      ).trim();
      if (storedUrl) {
        setMcpUrl(normalizeHuskyLensUrl(storedUrl, "stream"));
        setScreenPolling(true);
        setScreenFrameTick(Date.now());
      }
      return;
    }
    if (initialDiscoveryRef.current) return;
    initialDiscoveryRef.current = true;
    const storedUrl = (
      localStorage.getItem("huskylens:mcpUrl") ||
      localStorage.getItem("huskylens:streamUrl") ||
      defaultMcpUrl ||
      defaultStreamUrl
    ).trim();
    if (!storedUrl) {
      void discover();
      return;
    }

    const normalizedStoredUrl = normalizeHuskyLensUrl(storedUrl, "chat");
    void (async () => {
      let fallbackStarted = false;
      const fallbackTimer = window.setTimeout(() => {
        fallbackStarted = true;
        void discover();
      }, 2200);
      const connected = await connect(storedUrl);
      window.clearTimeout(fallbackTimer);
      if (connected === false) {
        localStorage.removeItem("huskylens:mcpUrl");
        setMcpUrl((current) =>
          normalizeHuskyLensUrl(current) === normalizedStoredUrl ? "" : current
        );
        setConnection({ loading: false, error: "", data: null });
        if (!fallbackStarted) {
          await discover();
        }
      }
    })();
  }, [appMode]);

  useEffect(() => {
    if (!connectedToCurrentUrl || !screenPolling) return;
    setScreenCapture((current) => ({ ...current, error: "" }));
  }, [connectedToCurrentUrl, screenPolling]);

  useEffect(() => {
    if (appMode === "stream") {
      void loadCaptureHistory();
      if (connectedToCurrentUrl) {
        setScreenPolling(true);
        setScreenFrameTick(Date.now());
      }
      return;
    }
    setScreenPolling(false);
  }, [appMode, connectedToCurrentUrl]);

  const liveContext = connectedToCurrentUrl ? latestVisionContext ?? recognition.data : null;
  const sceneState: "live" | "ready" | "idle" = connection.data
    ? connectedToCurrentUrl
      ? liveContext
        ? "ready"
        : "live"
      : "idle"
    : "idle";
  const canClearConversation = messages.some((message) => message.role === "user");

  async function loadHealth() {
    setHealth({ loading: true, error: "", data: null });
    const result = await apiGet<Record<string, unknown>>("/api/health");
    setHealth({ loading: false, error: result.error, data: result.data });
  }

  async function connect(url = mcpUrl) {
    const nextUrl = normalizeHuskyLensUrl(url, "chat");
    if (!nextUrl) return false;
    discoveryRequestRef.current += 1;
    const previousUrl = connection.data?.url;
    const switchingDevice = Boolean(previousUrl && previousUrl !== nextUrl);
    if (switchingDevice) {
      resetConversationState();
      clearSceneForAddressChange();
    }
    if (nextUrl !== mcpUrl) setMcpUrl(nextUrl);
    const requestId = connectRequestRef.current + 1;
    connectRequestRef.current = requestId;
    setConnection({ loading: true, error: "", data: null });
    const result = await apiPost<ConnectionData>("/api/huskylens/connect", {
      url: nextUrl
    });
    if (connectRequestRef.current !== requestId) return;
    setConnection({ loading: false, error: result.error, data: result.data });
    if (result.data) {
      if (previousUrl && previousUrl !== result.data.url) {
        resetConversationState();
      }
      localStorage.setItem("huskylens:mcpUrl", result.data.url);
      screenFailureCountRef.current = 0;
      setScreenPolling(appMode === "stream");
      if (appMode === "stream") setScreenFrameTick(Date.now());
      return true;
    }
    return false;
  }

  function changeMcpUrl(value: string) {
    setMcpUrl(value);
    connectRequestRef.current += 1;
    discoveryRequestRef.current += 1;
    const normalized = normalizeHuskyLensUrl(value, appMode === "stream" ? "stream" : "chat");
    setConnection((current) => ({
      ...current,
      loading: false,
      error: ""
    }));
    setDiscovery((current) => ({
      ...current,
      loading: false,
      error: "",
      data: null
    }));
    if (connection.data?.url !== normalized) {
      if (connection.data) {
        resetConversationState();
        clearSceneForAddressChange();
      } else {
        clearSceneForAddressChange();
      }
      setScreenPolling(false);
    } else {
      clearSceneForAddressChange();
    }
  }

  function clearSceneForAddressChange() {
    setRecognition({ loading: false, error: "", data: null });
    setScreenCapture({ loading: false, error: "", data: null });
    setLatestVisionContext(null);
    setAnswer({ loading: false, error: "", data: null });
    setStreamingId(null);
    screenRequestSeqRef.current += 1;
    activeScreenRequestRef.current = null;
    screenFailureCountRef.current = 0;
    askRequestSeqRef.current += 1;
  }

  function holdScreenForAnswer() {
    screenRequestSeqRef.current += 1;
    activeScreenRequestRef.current = null;
    setScreenCapture((current) => ({
      ...current,
      loading: false,
      error: ""
    }));
  }

  function normalizeMcpUrlInput() {
    const normalized = normalizeHuskyLensUrl(mcpUrl, appMode === "stream" ? "stream" : "chat");
    if (normalized && normalized !== mcpUrl) changeMcpUrl(normalized);
  }

  async function discover() {
    const requestId = discoveryRequestRef.current + 1;
    discoveryRequestRef.current = requestId;
    setDiscovery({ loading: true, error: "", data: null });
    const result = await apiGet<string[]>("/api/huskylens/discover");
    if (discoveryRequestRef.current !== requestId) return;
    setDiscovery({ loading: false, error: result.error, data: result.data });
    if (appMode === "stream") {
      if (result.data?.[0]) {
        setMcpUrl(normalizeHuskyLensUrl(result.data[0], "stream"));
        setScreenPolling(true);
        setScreenFrameTick(Date.now());
      }
      return;
    }
    if (result.data?.length === 1) {
      await connect(result.data[0]);
      return;
    }
    if (result.data?.[0]) setMcpUrl(result.data[0]);
  }

  async function refreshScreen(
    url = connectedToCurrentUrl ? connection.data?.url : mcpUrl,
    quiet = false,
    retryScreenshot = false
  ) {
    if (!url || activeScreenRequestRef.current !== null) return;
    const requestId = screenRequestSeqRef.current + 1;
    screenRequestSeqRef.current = requestId;
    activeScreenRequestRef.current = requestId;
    if (!quiet) setScreenCapture((current) => ({ ...current, loading: true, error: "" }));

    const result = await apiPost<ScreenPayload>("/api/huskylens/screen", {
      url,
      background: quiet
    });

    if (activeScreenRequestRef.current !== requestId) return;

    if (result.data) {
      screenFailureCountRef.current = 0;
      tuneScreenDelay(result.data.durationMs, true);
      setScreenCapture({
        loading: false,
        error: "",
        data: result.data
      });
      setScreenFrameTick(Date.now());
      activeScreenRequestRef.current = null;
      return;
    }

    screenFailureCountRef.current += 1;
    setScreenCapture((current) => ({
      loading: false,
      error: quiet && current.data ? "" : result.error || "화면을 가져오지 못했습니다.",
      data: current.data
    }));
    tuneScreenDelay(null, false);
    activeScreenRequestRef.current = null;
  }

  function tuneScreenDelay(durationMs: unknown, success: boolean) {
    if (!success) {
      screenDelayRef.current = Math.max(1000, Math.min(1400, screenDelayRef.current + 200));
      return;
    }
    const duration = typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : 900;
    if (duration < 650) {
      screenDelayRef.current = 650;
    } else if (duration < 1300) {
      screenDelayRef.current = 800;
    } else if (duration < 2200) {
      screenDelayRef.current = 1000;
    } else {
      screenDelayRef.current = 1200;
    }
  }

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed) return;
    const huskylensUrl = connectedToCurrentUrl ? connection.data?.url : "";
    if (!huskylensUrl) return;
    const requestId = askRequestSeqRef.current + 1;
    askRequestSeqRef.current = requestId;
    holdScreenForAnswer();

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      at: Date.now()
    };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setAnswer({ loading: true, error: "", data: null });

    const result = await apiPost<{ answer: string; visionContext: unknown; screenContext?: unknown }>(
      "/api/ask",
      {
        huskylensUrl,
        openaiApiKey,
        includeScreen: false,
        visionContext: latestVisionContext ?? recognition.data,
        screenContext: null,
        question: trimmed,
        history: buildConversationHistory(messages)
      }
    );

    if (askRequestSeqRef.current !== requestId) return;

    if (result.data) {
      const assistantId = crypto.randomUUID();
      setLatestVisionContext(result.data.visionContext);
      if (result.data.screenContext) {
        setScreenCapture({ loading: false, error: "", data: result.data.screenContext as ScreenPayload });
        setScreenFrameTick(Date.now());
      }
      setAnswer({ loading: false, error: "", data: result.data });
      setMessages((current) => [
        ...current,
        {
          id: assistantId,
          role: "assistant",
          text: result.data?.answer || "",
          context: result.data?.visionContext,
          at: Date.now(),
          displayLen: 0
        }
      ]);
      setStreamingId(assistantId);
      return;
    }

    setAnswer({ loading: false, error: result.error, data: null });
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.error || "응답을 만들 수 없습니다.",
        at: Date.now()
      }
    ]);
  }

  function chooseMode(mode: Exclude<AppMode, "select">) {
    setAppMode(mode);
    if (mode === "stream") {
      void loadCaptureHistory();
      const storedUrl = localStorage.getItem("huskylens:streamUrl") || mcpUrl;
      const normalized = normalizeHuskyLensUrl(storedUrl, "stream");
      if (normalized) setMcpUrl(normalized);
      setScreenPolling(Boolean(connectedToCurrentUrl));
      setScreenFrameTick(Date.now());
      return;
    }
    const storedUrl = localStorage.getItem("huskylens:mcpUrl") || mcpUrl;
    const normalized = normalizeHuskyLensUrl(storedUrl, "chat");
    if (normalized) setMcpUrl(normalized);
    setScreenPolling(false);
  }

  function startStreamFromAddress(url = mcpUrl) {
    const normalized = normalizeHuskyLensUrl(url, "stream");
    if (!normalized) return;
    setMcpUrl(normalized);
    localStorage.setItem("huskylens:streamUrl", normalized);
    setScreenPolling(true);
    setScreenFrameTick(Date.now());
  }

  async function loadCaptureHistory() {
    setCaptureHistory((current) => ({ ...current, loading: true, error: "" }));
    const result = await apiGet<StreamCapture[]>("/api/stream/captures");
    setCaptureHistory({
      loading: false,
      error: result.error,
      data: result.data ?? []
    });
  }

  async function captureStreamFrame() {
    const url = connectedToCurrentUrl ? connection.data?.url : normalizeHuskyLensUrl(mcpUrl, "stream");
    if (!url) {
      setCaptureAction({ loading: false, error: "HUSKYLENS 주소가 필요합니다.", data: null });
      return;
    }
    setCaptureAction({ loading: true, error: "", data: null });
    const result = await apiPost<StreamCapture>("/api/stream/capture", {
      url,
      cameraName: cameraName.trim()
    });
    if (result.data) {
      setCaptureAction({ loading: false, error: "", data: result.data });
      setCaptureHistory((current) => ({
        loading: false,
        error: "",
        data: [result.data!, ...(current.data ?? [])].slice(0, 300)
      }));
      return;
    }
    setCaptureAction({ loading: false, error: result.error, data: null });
  }

  async function openCaptureFolder() {
    const result = await apiPost<{ path: string }>("/api/stream/open-folder", {});
    if (result.error) {
      setCaptureHistory((current) => ({ ...current, error: result.error }));
    }
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (canAsk && !answer.loading) void ask();
    }
  }

  function clearConversation() {
    resetConversationState();
  }

  function resetConversationState() {
    askRequestSeqRef.current += 1;
    const next = [createInitialAssistantMessage()];
    setMessages(next);
    setLatestVisionContext(null);
    setRecognition({ loading: false, error: "", data: null });
    setAnswer({ loading: false, error: "", data: null });
    setStreamingId(null);
  }

  return (
    <main className="relative z-10 min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-[1540px] flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
        <AppHeader
          connectedToCurrentUrl={connectedToCurrentUrl}
          showSettings={showSettings}
          mode={appMode}
          onBackToModes={() => setAppMode("select")}
          onToggleSettings={() => setShowSettings((v) => !v)}
        />

        {appMode === "select" ? (
          <ModeSelect
            onChooseStream={() => chooseMode("stream")}
            onChooseChat={() => chooseMode("chat")}
          />
        ) : appMode === "stream" ? (
          <div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="reveal relative min-h-[520px] overflow-hidden rounded-[8px] panel-deep lg:h-[calc(100vh-102px)]">
              <VisionStage
                mode="stream"
                context={null}
                frameTick={screenFrameTick}
                connection={connection}
                connectedToCurrentUrl={connectedToCurrentUrl}
                discovery={discovery}
                recognition={recognition}
                screenCapture={screenCapture}
                answerLoading={false}
                mcpUrl={mcpUrl}
                screenPolling={screenPolling}
                captureLoading={captureAction.loading}
                cameraName={cameraName}
                onCapture={() => void captureStreamFrame()}
                onChangeCameraName={setCameraName}
                onChangeUrl={changeMcpUrl}
                onNormalizeUrl={normalizeMcpUrlInput}
                onDiscover={discover}
                onConnect={() => startStreamFromAddress()}
                onConnectUrl={(url) => startStreamFromAddress(url)}
                onRefresh={() => {
                  setScreenCapture((current) => ({ ...current, error: "" }));
                  setScreenFrameTick(Date.now());
                }}
                onTogglePolling={() => {
                  if (!normalizeHuskyLensUrl(mcpUrl, "stream")) return;
                  const next = !screenPolling;
                  setScreenPolling(next);
                  if (next) setScreenFrameTick(Date.now());
                }}
              />
              {showSettings && (
                <CompactSettings
                  hasServerApiKey={hasServerApiKey}
                  openaiApiKey={openaiApiKey}
                  onChangeApiKey={setOpenaiApiKey}
                />
              )}
            </section>
            <aside className="reveal min-h-[420px] overflow-hidden rounded-[8px] panel-light lg:h-[calc(100vh-102px)]">
              <CaptureHistoryPanel
                captures={captureHistory.data ?? []}
                loading={captureHistory.loading}
                actionLoading={captureAction.loading}
                error={captureAction.error || captureHistory.error}
                cameraName={cameraName}
                onCapture={() => void captureStreamFrame()}
                onOpenFolder={() => void openCaptureFolder()}
                onRefresh={() => void loadCaptureHistory()}
              />
            </aside>
          </div>
        ) : (
          <div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="reveal order-1 relative h-[50vh] min-h-[300px] overflow-hidden rounded-[8px] panel-deep lg:order-2 lg:h-[calc(100vh-102px)]">
              <VisionStage
                mode="chat"
                context={liveContext}
                frameTick={screenFrameTick}
                connection={connection}
                connectedToCurrentUrl={connectedToCurrentUrl}
                discovery={discovery}
                recognition={recognition}
                screenCapture={screenCapture}
                answerLoading={answer.loading}
                mcpUrl={mcpUrl}
                screenPolling={screenPolling}
                onChangeUrl={changeMcpUrl}
                onNormalizeUrl={normalizeMcpUrlInput}
                onDiscover={discover}
                onConnect={() => void connect()}
                onConnectUrl={(url) => void connect(url)}
                onRefresh={() => {
                  setScreenCapture((current) => ({ ...current, error: "" }));
                  setScreenFrameTick(Date.now());
                }}
                onTogglePolling={() => {
                  if (!connectedToCurrentUrl || !connection.data) return;
                  const next = !screenPolling;
                  setScreenPolling(next);
                  if (next) setScreenFrameTick(Date.now());
                }}
              />
              {showSettings && (
                <CompactSettings
                  hasServerApiKey={hasServerApiKey}
                  openaiApiKey={openaiApiKey}
                  onChangeApiKey={setOpenaiApiKey}
                />
              )}
            </section>

            <section className="reveal order-2 flex h-[58vh] min-h-[440px] flex-col overflow-hidden rounded-[8px] panel-light lg:order-1 lg:h-[calc(100vh-102px)]">
              <SceneStrip
                state={sceneState}
                connectedAt={connection.data?.connectedAt}
                canClearConversation={canClearConversation}
                onClearConversation={clearConversation}
              />

              <div
                ref={scrollRef}
                className="scroll-fade relative min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-7 sm:px-8"
              >
                {messages.map((message, index) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    index={index}
                  />
                ))}
                {answer.loading && <ThinkingBubble />}
              </div>

              <div className="border-t border-silver-200 bg-[#f6f8fb] px-4 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5">
                {answer.error && <ErrorBanner message={answer.error} />}
                <Composer
                  ref={composerRef}
                  value={question}
                  onChange={setQuestion}
                  onKeyDown={onComposerKeyDown}
                  onSubmit={ask}
                  disabled={!canAsk || answer.loading}
                  loading={answer.loading}
                  sceneState={sceneState}
                  needsApiKey={needsApiKey}
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function ModeSelect({
  onChooseStream,
  onChooseChat
}: {
  onChooseStream: () => void;
  onChooseChat: () => void;
}) {
  return (
    <section className="reveal mt-3 flex flex-1 items-center justify-center rounded-[8px] border border-silver-200 bg-[#f7f9fc] p-5 shadow-crisp">
      <div className="grid w-full max-w-[960px] gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={onChooseStream}
          className="group flex min-h-[260px] flex-col justify-between rounded-[8px] border border-silver-200 bg-white p-6 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-azure-300 hover:shadow-elevated"
        >
          <div>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-[8px] bg-ink text-azure-100">
              <Monitor size={24} strokeWidth={1.55} />
            </div>
            <h2 className="text-[26px] font-semibold tracking-[-0.015em] text-ink">
              스트리밍 모드
            </h2>
            <p className="mt-3 text-[15px] leading-[1.7] text-silver-700">
              실시간 영상을 보고 필요한 순간을 로컬에 저장합니다.
            </p>
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-silver-100 pt-4 text-[13px] font-semibold text-azure-700">
            <span>RTSP 영상</span>
            <Camera size={17} className="transition group-hover:scale-105" />
          </div>
        </button>

        <button
          type="button"
          onClick={onChooseChat}
          className="group flex min-h-[260px] flex-col justify-between rounded-[8px] border border-silver-200 bg-white p-6 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-azure-300 hover:shadow-elevated"
        >
          <div>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-[8px] bg-ink text-azure-100">
              <MessageSquare size={24} strokeWidth={1.55} />
            </div>
            <h2 className="text-[26px] font-semibold tracking-[-0.015em] text-ink">
              대화모드
            </h2>
            <p className="mt-3 text-[15px] leading-[1.7] text-silver-700">
              영상 송출 없이 MCP 데이터와 장치 기능으로 AI와 대화합니다.
            </p>
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-silver-100 pt-4 text-[13px] font-semibold text-azure-700">
            <span>MCP 대화</span>
            <Aperture size={17} className="transition group-hover:scale-105" />
          </div>
        </button>
      </div>
    </section>
  );
}

function CaptureHistoryPanel({
  captures,
  loading,
  actionLoading,
  error,
  cameraName,
  onCapture,
  onOpenFolder,
  onRefresh
}: {
  captures: StreamCapture[];
  loading: boolean;
  actionLoading: boolean;
  error: string;
  cameraName: string;
  onCapture: () => void;
  onOpenFolder: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-[#f7f9fc] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">캡처 이력</h2>
          <p className="mt-1 text-[12.5px] text-silver-600">
            {cameraName.trim() || "저장된 화면과 시간을 확인합니다"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCapture}
            disabled={actionLoading}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] bg-ink px-3.5 text-[13px] font-semibold text-white transition hover:bg-char disabled:cursor-not-allowed disabled:bg-silver-300 disabled:text-silver-500"
          >
            {actionLoading ? <Loader2 className="animate-spin" size={14} /> : <Camera size={14} />}
            캡처
          </button>
          <button
            type="button"
            onClick={onOpenFolder}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border border-silver-200 bg-white px-3.5 text-[13px] font-semibold text-ink transition hover:bg-silver-50"
          >
            <FolderOpen size={14} />
            폴더 열기
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="캡처 이력 새로고침"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] border border-silver-200 bg-white text-ink transition hover:bg-silver-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" size={14} /> : <RefreshCcw size={14} />}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {captures.length === 0 ? (
        <div className="flex min-h-[160px] flex-1 items-center justify-center rounded-[8px] border border-dashed border-silver-300 bg-white px-4 text-center text-[13px] font-medium text-silver-500">
          저장된 캡처가 없습니다
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {captures.map((capture) => (
            <a
              key={capture.id}
              href={capture.path}
              target="_blank"
              rel="noreferrer"
              className="group block overflow-hidden rounded-[8px] border border-silver-200 bg-white shadow-soft transition hover:border-azure-300"
            >
              <div className="aspect-video bg-[#07111f]">
                <img
                  src={capture.path}
                  alt="캡처 화면"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="px-3 py-2">
                <p className="truncate text-[12px] font-semibold text-ink">
                  {capture.displayName || capture.cameraName || capture.deviceHost}
                </p>
                <p className="mt-0.5 text-[11px] text-silver-500">
                  {formatDateTime(capture.timestamp)}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function VisionStage({
  mode,
  context,
  frameTick,
  connection,
  connectedToCurrentUrl,
  discovery,
  recognition,
  screenCapture,
  captureLoading = false,
  mcpUrl,
  screenPolling,
  onCapture,
  cameraName = "",
  onChangeCameraName,
  onChangeUrl,
  onNormalizeUrl,
  onDiscover,
  onConnect,
  onConnectUrl,
  onRefresh,
  onTogglePolling
}: {
  mode: "stream" | "chat";
  context: unknown;
  frameTick: number;
  connection: ApiState<ConnectionData>;
  connectedToCurrentUrl: boolean;
  discovery: ApiState<string[]>;
  recognition: ApiState;
  screenCapture: ApiState<ScreenPayload>;
  answerLoading: boolean;
  captureLoading?: boolean;
  mcpUrl: string;
  screenPolling: boolean;
  onCapture?: () => void;
  cameraName?: string;
  onChangeCameraName?: (value: string) => void;
  onChangeUrl: (value: string) => void;
  onNormalizeUrl: () => void;
  onDiscover: () => void;
  onConnect: () => void;
  onConnectUrl: (url: string) => void;
  onRefresh: () => void;
  onTogglePolling: () => void;
}) {
  const normalizedStreamUrl = normalizeHuskyLensUrl(mcpUrl, mode === "stream" ? "stream" : "chat");
  const streamSourceUrl = connectedToCurrentUrl && connection.data ? connection.data.url : normalizedStreamUrl;
  const connected = mode === "stream" ? Boolean(streamSourceUrl) : connectedToCurrentUrl;
  const [editingAddress, setEditingAddress] = useState(false);
  const [editingCameraName, setEditingCameraName] = useState(false);
  const [streamLoadFailed, setStreamLoadFailed] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const cameraNameInputRef = useRef<HTMLInputElement>(null);
  const streamHost = streamSourceUrl ? hostNameFromUrl(streamSourceUrl) : "";
  const streamPageUrl = mode === "stream" && streamSourceUrl && screenPolling
    ? getHuskyLensRtspProxyUrl(streamSourceUrl, frameTick)
    : "";
  const details = getRecognitionDetails(context);
  const screenStatus = screenPolling
    ? { label: "RTSP 영상", latency: "", slow: false }
    : getScreenStatus(screenCapture);
  const refreshLabel = "영상 다시 연결";
  const error = connection.error || discovery.error || recognition.error || screenCapture.error;
  const foundCount = discovery.data?.length ?? 0;
  const selectedFoundUrl = Boolean(discovery.data?.some((url) => sameHuskyLensHost(url, mcpUrl)));
  const helperText = connected
    ? hostFromUrl(mode === "stream" ? streamSourceUrl : connection.data!.url)
    : discovery.loading
      ? "같은 Wi-Fi에서 허스키렌즈를 찾고 있습니다"
      : foundCount > 0
        ? `${foundCount}개 발견${selectedFoundUrl ? " · 선택됨" : ""} · 장치를 누르면 연결됩니다`
        : discovery.data
          ? "장치가 보이지 않으면 IP를 직접 입력하세요"
          : mcpUrl.trim()
            ? "주소를 확인한 뒤 연결을 누르세요"
            : "IP만 입력해도 주소가 자동으로 맞춰집니다";
  const showAddressEditor = !connected || editingAddress;
  const handleStreamError = useCallback(() => {
    setStreamLoadFailed(true);
  }, []);

  useEffect(() => {
    setEditingAddress(false);
  }, [connected]);

  useEffect(() => {
    setStreamLoadFailed(false);
  }, [frameTick, streamHost]);

  useEffect(() => {
    if (!editingAddress || !showAddressEditor || connection.loading) return;
    const timer = window.setTimeout(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [connection.loading, editingAddress, showAddressEditor]);

  useEffect(() => {
    if (!editingCameraName) return;
    const timer = window.setTimeout(() => {
      cameraNameInputRef.current?.focus();
      cameraNameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editingCameraName]);

  function onAddressKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!mcpUrl.trim() || connection.loading) return;
    onConnect();
  }

  return (
    <div className="flex h-full min-h-[300px] flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#07111f]">
        <div className="relative flex h-full w-full items-center justify-center">
          {mode === "stream" && streamPageUrl && !streamLoadFailed ? (
            <RtspStreamFrame
              src={streamPageUrl}
              onError={handleStreamError}
            />
          ) : (
            <div className="flex max-w-[520px] flex-col items-center justify-center px-6 text-center text-azure-100/80">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[8px] border border-azure-200/15 bg-white/8 text-azure-100 shadow-soft">
                <Monitor size={30} strokeWidth={1.45} />
              </div>
              <h2 className="text-[26px] font-semibold tracking-[-0.018em] text-white">
                {mode === "stream" ? "허스키렌즈 화면" : "대화모드"}
              </h2>
              <p className="mt-2 text-[14px] leading-[1.7] text-azure-100/65">
                {mode === "chat"
                  ? "영상 없이 인식 데이터와 장치 기능을 사용합니다."
                  : streamLoadFailed
                  ? "영상을 다시 연결해 주세요."
                  : connected
                    ? "RTSP 영상 보기를 켜면 실시간 화면이 열립니다."
                    : "같은 Wi-Fi에서 허스키렌즈 주소로 연결하면 카메라 화면이 크게 표시됩니다."}
              </p>
              {!connected && <ConnectionChecklist />}
              <ConnectionActions
                connected={connected}
                connectionLoading={connection.loading}
                discoveryLoading={discovery.loading}
                screenLoading={screenCapture.loading}
                onRefresh={onRefresh}
                onDiscover={onDiscover}
                onEditAddress={() => setEditingAddress(true)}
              />
            </div>
          )}

          <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex h-8 items-center gap-2 rounded-[6px] border px-2.5 text-[12px] font-semibold ${
                connected
                  ? "border-signal/40 bg-signal/12 text-signal"
                  : "border-white/12 bg-white/8 text-azure-100/75"
              }`}
            >
              {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {connected ? "연결됨" : "연결 전"}
            </span>
            {mode === "stream" && screenPolling && (
              <span
                className={`inline-flex h-8 items-center gap-2 rounded-[6px] border px-2.5 text-[12px] font-semibold ${
                  screenStatus.slow
                    ? "border-warn/45 bg-ink/82 text-warn"
                    : "border-signal/35 bg-ink/82 text-signal"
                }`}
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                {screenStatus.label}
              </span>
            )}
          </div>

          {mode === "stream" && connected && (
            <div className="absolute right-4 top-4 flex items-center gap-2">
              <button
                type="button"
                onClick={onCapture}
                disabled={captureLoading || !screenPolling}
                aria-label="캡처"
                title="캡처"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] border border-white/12 bg-white text-ink transition hover:bg-azure-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {captureLoading ? <Loader2 className="animate-spin" size={15} /> : <Camera size={15} />}
              </button>
              <button
                type="button"
                onClick={() => setEditingCameraName((value) => !value)}
                aria-label="카메라 이름"
                title="카메라 이름"
                className="inline-flex h-9 items-center justify-center rounded-[6px] border border-white/12 bg-white/10 px-3 text-[12px] font-semibold text-white transition hover:bg-white/16"
              >
                이름 변경
              </button>
              <button
                type="button"
                onClick={onRefresh}
                disabled={screenCapture.loading}
                aria-label={refreshLabel}
                title={refreshLabel}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] border border-white/12 bg-white/10 text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {screenCapture.loading ? <Loader2 className="animate-spin" size={15} /> : <RefreshCcw size={15} />}
              </button>
              <button
                type="button"
                onClick={onTogglePolling}
                className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-white/12 bg-white px-3.5 text-[13px] font-semibold text-ink shadow-soft transition hover:bg-azure-50"
              >
                {screenPolling ? <Pause size={14} /> : <Play size={14} />}
                {screenPolling ? "일시정지" : "영상 보기"}
              </button>
            </div>
          )}

          {details && (
            <div className="absolute bottom-4 left-4 right-4 hidden items-end justify-between gap-4 md:flex">
              <div className="min-w-0 rounded-[8px] border border-white/12 bg-ink/86 px-4 py-3 text-white shadow-elevated">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold">
                  <span className="rounded-[4px] bg-white/10 px-2.5 py-1 text-azure-100">
                    알고리즘 {details.algorithm}
                  </span>
                  <span className="rounded-[4px] bg-signal/15 px-2.5 py-1 text-signal">
                    인식 {details.detections.length}개
                  </span>
                  {details.labels.slice(0, 4).map((label) => (
                    <span key={label} className="rounded-[4px] bg-white/10 px-2.5 py-1 text-azure-100/85">
                      {label}
                    </span>
                  ))}
                  {screenStatus.latency && (
                    <span className="rounded-[4px] bg-white/10 px-2.5 py-1 text-azure-100/85">
                      수신 {screenStatus.latency}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={`border-t border-white/10 bg-[#0c1726] px-4 ${showAddressEditor || editingCameraName ? "py-4" : "py-2.5"}`}>
        {editingCameraName && mode === "stream" && (
          <label className="mb-3 block">
            <span className="mb-1.5 block text-[12px] font-semibold text-azure-100/70">
              카메라 이름
            </span>
            <input
              ref={cameraNameInputRef}
              value={cameraName}
              onChange={(event) => onChangeCameraName?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setEditingCameraName(false);
                }
              }}
              placeholder="예: 중앙병원 3층 복도 카메라"
              className="h-10 w-full rounded-[6px] border border-white/20 bg-[#111d2d] px-3.5 text-[13px] text-white shadow-sunk outline-none transition placeholder:text-azure-100/40 focus:border-azure-300"
            />
          </label>
        )}
        {showAddressEditor ? (
          <>
            <div className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_auto]">
              <label className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="block text-[12px] font-semibold text-azure-100/70">
                    허스키렌즈 주소
                  </span>
                  {mcpUrl && !connected && (
                    <span className="text-[11px] font-medium text-azure-100/45">
                      연결 필요
                    </span>
                  )}
                </div>
                <input
                  ref={addressInputRef}
                  value={mcpUrl}
                  onChange={(event) => onChangeUrl(event.target.value)}
                  onBlur={onNormalizeUrl}
                  onKeyDown={onAddressKeyDown}
                  disabled={connection.loading}
                  spellCheck={false}
                  placeholder={
                    mode === "stream"
                      ? "10.241.134.240 또는 rtsp://...:8554/live"
                      : "10.241.134.243 또는 http://...:3000/sse"
                  }
                  className="h-10 w-full rounded-[6px] border border-white/20 bg-[#111d2d] px-3.5 font-mono text-[13px] text-white shadow-sunk outline-none transition placeholder:text-azure-100/40 focus:border-azure-300 disabled:cursor-wait disabled:opacity-70"
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button
                  type="button"
                  onClick={onDiscover}
                  disabled={discovery.loading || connection.loading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[6px] border border-white/20 bg-[#172337] px-4 text-[13px] font-semibold text-white transition hover:bg-[#1d2a40] disabled:opacity-60"
                >
                  {discovery.loading ? <Loader2 className="animate-spin" size={14} /> : <Radar size={14} />}
                  {discovery.loading ? "찾는 중" : foundCount > 0 ? "다시 찾기" : "자동 찾기"}
                </button>
                <button
                  type="button"
                  onClick={onConnect}
                  disabled={connection.loading || !mcpUrl.trim()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[6px] bg-white px-5 text-[13px] font-semibold text-ink shadow-soft transition hover:bg-azure-50 disabled:opacity-60"
                >
                  {connection.loading ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
                  {connection.loading ? "연결 중" : connected ? "재연결" : "연결"}
                </button>
                {connected && (
                  <button
                    type="button"
                    onClick={() => setEditingAddress(false)}
                    className="inline-flex h-10 items-center justify-center rounded-[6px] border border-white/16 px-4 text-[13px] font-semibold text-azure-100/75 transition hover:bg-white/8"
                  >
                    닫기
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-azure-100/60">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span>
                  {helperText}
                </span>
                {details && <span>· {summarizeRecognition(context)}</span>}
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-[6px] border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] font-semibold text-azure-100/72">
              <Wifi size={14} className="shrink-0 text-signal" />
              {mode === "stream" && cameraName.trim() && (
                <span className="truncate text-azure-100">
                  {cameraName.trim()}
                </span>
              )}
              <span className="truncate font-mono text-[11px] text-azure-100/86">
                {helperText}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setEditingAddress(true)}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-[6px] border border-white/22 bg-white/8 px-3.5 text-[12px] font-semibold text-white transition hover:bg-white/14"
            >
              <Settings2 size={13} />
              주소 변경
            </button>
          </div>
        )}

        {showAddressEditor && discovery.data && discovery.data.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scroll-fade">
            {discovery.data.map((url) => (
              <button
                type="button"
                key={url}
                onClick={() => onConnectUrl(url)}
                disabled={connection.loading}
                className={`shrink-0 rounded-[4px] border px-3 py-1.5 font-mono text-[11px] transition ${
                  sameHuskyLensHost(url, mcpUrl)
                    ? "border-signal/50 bg-signal/12 text-signal"
                    : "border-white/12 bg-white/8 text-azure-100/70 hover:bg-white/14"
                } disabled:cursor-wait disabled:opacity-60`}
              >
                {hostFromUrl(url)}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-[6px] border border-alert/30 bg-alert/10 px-3 py-2.5 text-[12.5px] font-medium text-[#ffb8c2]">
            <CircleAlert className="mt-0.5 shrink-0" size={14} />
            <span className="leading-snug">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const RtspStreamFrame = React.memo(function RtspStreamFrame({
  src,
  onError
}: {
  src: string;
  onError: () => void;
}) {
  return (
    <img
      src={src}
      alt="허스키렌즈 RTSP 영상"
      onError={onError}
      className="h-full w-full bg-black object-cover"
    />
  );
});

function ConnectionChecklist() {
  const items = [
    { icon: Power, label: "MCP Service 켜기" },
    { icon: Wifi, label: "같은 Wi-Fi 연결" },
    { icon: Radar, label: "자동 찾기 또는 주소 입력" }
  ] as const;

  return (
    <div className="mt-5 flex max-w-full flex-wrap justify-center gap-2 text-left">
      {items.map(({ icon: Icon, label }) => (
        <span
          key={label}
          className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-white/10 bg-white/[0.04] px-2.5 text-[12px] font-semibold text-azure-100/70"
        >
          <Icon size={13} />
          {label}
        </span>
      ))}
    </div>
  );
}

function ConnectionActions({
  connected,
  connectionLoading,
  discoveryLoading,
  screenLoading,
  onRefresh,
  onDiscover,
  onEditAddress
}: {
  connected: boolean;
  connectionLoading: boolean;
  discoveryLoading: boolean;
  screenLoading: boolean;
  onRefresh: () => void;
  onDiscover: () => void;
  onEditAddress: () => void;
}) {
  const disabled = connectionLoading;

  return (
    <div className="mt-4 flex max-w-full flex-wrap justify-center gap-2">
      {connected && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={screenLoading || disabled}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border border-white/22 bg-white px-3.5 text-[12px] font-semibold text-ink shadow-soft transition hover:bg-azure-50 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {screenLoading ? <Loader2 className="animate-spin" size={13} /> : <RefreshCcw size={13} />}
          영상 다시 연결
        </button>
      )}
      <button
        type="button"
        onClick={onDiscover}
        disabled={discoveryLoading || disabled}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border border-white/16 bg-white/10 px-3.5 text-[12px] font-semibold text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {discoveryLoading ? <Loader2 className="animate-spin" size={13} /> : <Radar size={13} />}
        자동 찾기
      </button>
      <button
        type="button"
        onClick={onEditAddress}
        disabled={disabled}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border border-white/16 bg-white/10 px-3.5 text-[12px] font-semibold text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-55"
      >
        <Settings2 size={13} />
        주소 입력
      </button>
    </div>
  );
}

function CompactSettings({
  hasServerApiKey,
  openaiApiKey,
  onChangeApiKey
}: {
  hasServerApiKey: boolean;
  openaiApiKey: string;
  onChangeApiKey: (v: string) => void;
}) {
  return (
    <div className="absolute right-4 top-16 z-20 w-[min(420px,calc(100%-32px))] rounded-[8px] border border-white/14 bg-[#101b2b] p-4 text-white shadow-elevated">
      <div className="mb-3 flex items-center gap-2">
        <Settings2 size={16} className="text-azure-200" />
        <h2 className="text-[14px] font-semibold">API 키</h2>
      </div>
      {!hasServerApiKey && (
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold text-azure-100/70">
            API 키
          </span>
          <input
            value={openaiApiKey}
            onChange={(event) => onChangeApiKey(event.target.value)}
            placeholder="sk-..."
            type="password"
            className="h-10 w-full rounded-[6px] border border-white/20 bg-[#111d2d] px-3.5 font-mono text-[12px] text-white outline-none placeholder:text-azure-100/40 focus:border-azure-300"
          />
        </label>
      )}
      {hasServerApiKey && (
        <div className="flex items-center gap-2 rounded-[6px] border border-signal/30 bg-signal/10 px-3 py-2 text-[12px] font-semibold text-signal">
          <Check size={14} />
          API 키 준비됨
        </div>
      )}
    </div>
  );
}

function AppHeader({
  connectedToCurrentUrl,
  showSettings,
  mode,
  onBackToModes,
  onToggleSettings
}: {
  connectedToCurrentUrl: boolean;
  showSettings: boolean;
  mode: AppMode;
  onBackToModes: () => void;
  onToggleSettings: () => void;
}) {
  const connected = connectedToCurrentUrl;
  return (
    <header className="flex h-12 items-center justify-between gap-3 rounded-[8px] border border-silver-200 bg-[#f9fbfe] px-3 shadow-crisp">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-ink text-azure-200">
          <Aperture size={17} strokeWidth={1.5} />
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ${
              connected ? "bg-signal" : "bg-silver-400"
            } ring-2 ring-[#f9fbfe]`}
            aria-hidden
          />
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="truncate font-display text-[18px] font-semibold tracking-[-0.01em] text-ink">
            HUSKYLENS AI 비서
          </h1>
        </div>
        <span className="hidden h-5 w-px bg-silver-200 sm:block" />
        <span className="hidden items-center gap-1.5 rounded-[4px] border border-silver-200 bg-white px-2 py-1 text-[11px] font-semibold text-silver-600 sm:inline-flex">
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-signal" : "bg-silver-400"}`}
            aria-hidden
          />
          {connected ? "연결" : "준비"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {mode !== "select" && (
          <button
            type="button"
            onClick={onBackToModes}
            className="inline-flex h-8 items-center justify-center rounded-[6px] border border-silver-200 bg-white px-3 text-[12px] font-semibold text-ink transition hover:bg-silver-50"
          >
            모드 선택
          </button>
        )}
        <button
          type="button"
          onClick={onToggleSettings}
          aria-label="설정 패널"
          className="lift relative inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-silver-200 bg-white text-ink transition hover:bg-silver-50"
        >
          {showSettings ? <X size={15} /> : <Settings2 size={15} />}
        </button>
      </div>
    </header>
  );
}

function SceneStrip({
  state,
  connectedAt,
  canClearConversation,
  onClearConversation
}: {
  state: "live" | "ready" | "idle";
  connectedAt?: string;
  canClearConversation: boolean;
  onClearConversation: () => void;
}) {
  const map = {
    live: {
      icon: Activity,
      label: "질문 가능",
      tone: "border-azure-200 bg-azure-50/60 text-azure-700",
      hint: "질문하면 현재 장면을 읽습니다"
    },
    ready: {
      icon: Eye,
      label: "장면 준비",
      tone: "border-signal/35 bg-signal/10 text-signal-deep",
      hint: "최근 인식 결과가 질문에 함께 들어갑니다"
    },
    idle: {
      icon: WifiOff,
      label: "장치 미연결",
      tone: "border-silver-200 bg-silver-50 text-silver-600",
      hint: "허스키렌즈를 먼저 연결하세요"
    }
  } as const;

  const cfg = map[state];
  const Icon = cfg.icon;

  return (
    <div className="border-b border-silver-200 bg-[#f3f6fa] px-5 py-3 sm:px-6">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="shrink-0 text-[13px] font-semibold text-ink">
            AI 채팅
          </h2>
          <span className="h-4 w-px bg-silver-200" aria-hidden />
          <span
            className={`inline-flex h-7 shrink-0 items-center gap-2 rounded-[4px] border px-2.5 ${cfg.tone}`}
          >
            <Icon size={13} />
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em]">
              {cfg.label}
            </span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-silver-500">
          {connectedAt && (
            <span className="hidden items-center gap-1.5 whitespace-nowrap font-mono text-[10px] text-silver-500 2xl:inline-flex">
              <span className="text-silver-400">연결</span>
              <span>{formatTime(new Date(connectedAt).getTime())}</span>
              <span className="h-3 w-px bg-silver-300" />
            </span>
          )}
          {canClearConversation && (
            <button
              type="button"
              onClick={onClearConversation}
              aria-label="대화 초기화"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-silver-200 bg-white/80 text-silver-600 shadow-crisp transition hover:border-alert/30 hover:text-alert-deep"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-snug text-silver-700">{cfg.hint}</p>
    </div>
  );
}

const ChatBubble = React.memo(function ChatBubble({ message, index }: { message: ChatMessage; index: number }) {
  const isUser = message.role === "user";
  const streaming = !isUser && typeof message.displayLen === "number";
  const visibleText = streaming
    ? message.text.slice(0, message.displayLen ?? 0)
    : message.text;
  const isEmptyBubble = !visibleText;

  return (
    <div
      className={`reveal flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
      style={{ animationDelay: `${Math.min(index * 50, 200)}ms` }}
    >
      <div
        className={`flex w-full max-w-[88%] gap-3 rounded-[6px] border px-3 py-3 ${
          isUser
            ? "border-ink/20 bg-ink text-mist"
            : "border-silver-200 bg-white/82 text-ink"
        }`}
      >
        <Avatar role={message.role} />
        <div className="min-w-0 flex-1">
          <div
            className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold ${
              isUser ? "text-mist/60" : "text-silver-500"
            }`}
          >
            <span>{isUser ? "나" : "AI"}</span>
            <span className={`h-1 w-1 rounded-full ${isUser ? "bg-mist/35" : "bg-silver-400"}`} />
            <span>{formatTime(message.at)}</span>
            {streaming && (
              <span className={`ml-1 inline-flex items-center gap-1 ${isUser ? "text-mist/70" : "text-azure-600"}`}>
                <span className={`h-1 w-1 animate-pulse rounded-full ${isUser ? "bg-mist/70" : "bg-azure-500"}`} />
                작성 중
              </span>
            )}
          </div>

          {(visibleText || streaming) && (
            <div
              className={`text-[15px] leading-[1.65] ${
                isEmptyBubble ? "py-1" : ""
              }`}
            >
              {isUser ? (
                <p className="whitespace-pre-wrap">{visibleText}</p>
              ) : (
                <div className="markdown-body">
                  <MarkdownMessage
                    text={streaming ? closeOpenMarkdown(visibleText) : visibleText}
                    isUser={false}
                  />
                  {streaming && <TypingCursor />}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function TypingCursor() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1.05em] w-[6px] translate-y-[3px] rounded-[1.5px] bg-azure-500 align-baseline animate-pulse"
    />
  );
}

function MarkdownMessage({ text, isUser }: { text: string; isUser: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 whitespace-pre-wrap last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        li: ({ children }) => <li className="pl-1">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote
            className={`my-3 border-l-2 pl-3 ${
              isUser ? "border-white/35 text-mist/85" : "border-azure-300 text-silver-700"
            }`}
          >
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code
            className={`rounded-[4px] px-1.5 py-0.5 text-[0.92em] ${
              isUser ? "bg-white/15 text-white" : "bg-silver-100 text-ink"
            }`}
          >
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre
            className={`my-3 overflow-auto rounded-[6px] p-3 text-sm ${
              isUser ? "bg-white/15 text-white" : "bg-ink text-mist"
            }`}
          >
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className={`border px-3 py-2 text-left font-semibold ${isUser ? "border-white/20" : "border-silver-200 bg-silver-50"}`}>
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className={`border px-3 py-2 ${isUser ? "border-white/20" : "border-silver-200"}`}>{children}</td>
        )
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function closeOpenMarkdown(text: string) {
  let result = text;
  // Close a dangling inline code span so a half-typed `code does not show a raw backtick.
  if ((result.match(/`/g) || []).length % 2 === 1) result += "`";
  // Close a dangling bold span so a half-typed **word renders as bold instead of raw **.
  if ((result.match(/\*\*/g) || []).length % 2 === 1) result += "**";
  return result;
}

function ThinkingBubble() {
  return (
    <div className="reveal flex justify-start gap-3">
      <div className="flex w-full max-w-[88%] gap-3 rounded-[6px] border border-silver-200 bg-white/82 px-3 py-3 text-azure-700">
        <Avatar role="assistant" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-silver-500">
            <span>AI</span>
            <span className="h-1 w-1 rounded-full bg-azure-400" />
            <span>작성 중</span>
          </div>
          <div className="flex items-center gap-3 text-[13px] font-medium tracking-tight">
            <span className="typing-dots inline-flex items-center">
              <span />
              <span />
              <span />
            </span>
            <span>카메라 데이터를 읽고 답변을 작성하는 중</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-white/10 bg-white/10 text-mist">
        <UserRound size={15} />
      </div>
    );
  }
  return (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-silver-200 bg-[#f6f8fb] text-azure-600">
      <Aperture size={15} strokeWidth={1.6} />
    </div>
  );
}

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  disabled: boolean;
  loading: boolean;
  sceneState: "live" | "ready" | "idle";
  needsApiKey: boolean;
};

const Composer = React.forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer(
    {
      value,
      onChange,
      onKeyDown,
      onSubmit,
      disabled,
      loading,
      sceneState,
      needsApiKey
    },
    ref
  ) {
    const [focused, setFocused] = useState(false);

    const statusText = needsApiKey
      ? "API 키 필요"
      : ({
      live: "질문 가능",
      ready: "인식 데이터 준비됨",
      idle: "장치 미연결"
    } as const)[sceneState];
    const statusTone = needsApiKey
      ? "text-[#8a5a18]"
      : ({
      live: "text-azure-600",
      ready: "text-signal-deep",
      idle: "text-silver-500"
    } as const)[sceneState];
    const placeholderText = needsApiKey
      ? "API 키를 입력하면 질문할 수 있습니다"
      : ({
      live: "허스키렌즈가 보는 장면에 대해 물어보세요…",
      ready: "지금 보이는 장면에 대해 물어보세요…",
      idle: "허스키렌즈를 연결하면 질문할 수 있습니다"
    } as const)[sceneState];

    return (
      <div
        className={`relative overflow-hidden rounded-[8px] border bg-white transition ${
          focused ? "border-azure-300 shadow-glow" : "border-silver-200 shadow-crisp"
        }`}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onCompositionEnd={(event) => onChange(event.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholderText}
          className="block min-h-[90px] w-full border-0 bg-transparent px-5 pt-4 text-[15px] leading-[1.6] outline-none placeholder:text-silver-400"
        />

        <div className="flex items-center justify-between gap-3 border-t border-silver-100 bg-pearl/60 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] ${statusTone}`}
            >
              <Eye size={12} />
              {statusText}
            </span>
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            aria-label="전송"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[6px] bg-ink px-3.5 text-[13px] font-medium text-white transition hover:bg-char active:translate-y-px disabled:cursor-not-allowed disabled:bg-silver-300 disabled:text-silver-500 xl:px-4"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <Send size={14} />
            )}
            <span className="hidden font-semibold xl:inline">전송</span>
          </button>
        </div>
      </div>
    );
  }
);

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="reveal mb-3 flex items-start gap-2.5 rounded-[8px] border border-alert/35 bg-alert/8 px-4 py-3 text-[13.5px] text-alert-deep shadow-soft">
      <CircleAlert className="mt-0.5 shrink-0" size={16} />
      <div className="min-w-0 flex-1 leading-[1.55]">
        <p className="mb-0.5 text-[12px] font-semibold text-alert-deep/70">
          요청 실패
        </p>
        <p className="font-medium">{message}</p>
      </div>
    </div>
  );
}

async function apiGet<T>(url: string): Promise<{ data: T | null; error: string }> {
  try {
    const response = await fetch(url);
    const json = await response.json();
    if (!json.ok) return { data: null, error: json.error || "요청에 실패했습니다." };
    return { data: (json.data ?? json) as T, error: "" };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function apiPost<T = unknown>(
  url: string,
  body: unknown
): Promise<{ data: T | null; error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = await response.json();
    if (!json.ok) return { data: null, error: json.error || "요청에 실패했습니다." };
    return { data: json.data as T, error: "" };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function createInitialAssistantMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: initialAssistantMessage.role,
    text: initialAssistantMessage.text,
    at: Date.now()
  };
}

function buildConversationHistory(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.text.trim())
    .slice(-8)
    .map((message) => ({
      role: message.role,
      text: message.text.slice(0, 1400)
    }));
}

function summarizeRecognition(value: unknown) {
  if (!value || typeof value !== "object") return "인식 결과 수신";
  const data = value as {
    algorithm?: unknown;
    detections?: unknown;
    resources?: unknown;
  };
  const detectionCount = Array.isArray(data.detections) ? data.detections.length : 0;
  const resourceCount = Array.isArray(data.resources) ? data.resources.length : 0;
  const algorithm = typeof data.algorithm === "number" ? `알고리즘 ${data.algorithm}` : "현재 알고리즘";
  const parts = [algorithm, `인식 ${detectionCount}개`];
  if (resourceCount > 0) parts.push(`이미지 ${resourceCount}장`);
  return parts.join(" · ");
}

function getRecognitionDetails(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const data = value as {
    algorithm?: unknown;
    detections?: unknown;
    resources?: unknown;
  };
  const detections = Array.isArray(data.detections)
    ? (data.detections as Array<Record<string, unknown>>)
    : [];
  const resources = Array.isArray(data.resources)
    ? (data.resources as Array<Record<string, unknown>>)
    : [];
  const labels = [
    ...new Set(
      detections
        .map((item) => (typeof item.name === "string" && item.name.trim() ? item.name.trim() : "이름 없음"))
        .filter(Boolean)
    )
  ];
  const imageUrl = resources.find((item) => typeof item.uri === "string")?.uri;
  return {
    algorithm: typeof data.algorithm === "number" ? data.algorithm : "-",
    detections,
    resources,
    labels,
    imageUrl: typeof imageUrl === "string" ? imageUrl : ""
  };
}

function getFirstImageUrl(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const urls: string[] = [];
  const visit = (item: unknown) => {
    if (!item || typeof item !== "object" || urls.length > 0) return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.uri === "string") {
      const mime = typeof record.mimeType === "string" ? record.mimeType : "";
      if (!mime || mime.startsWith("image/")) {
        urls.push(record.uri);
        return;
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return urls[0] || "";
}

function getImageUrlWithCacheBust(url: string, tick: number) {
  if (!url || !tick) return url;
  if (/^(data|blob):/i.test(url)) return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol === "data:" || parsed.protocol === "blob:") return url;
    parsed.searchParams.set("_frame", String(tick));
    return parsed.toString();
  } catch {
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}_frame=${tick}`;
  }
}

function getScreenStatus(screenCapture: ApiState<ScreenPayload>) {
  const base = "실시간 화면";
  const durationMs = screenCapture.data?.durationMs;
  const latency =
    typeof durationMs === "number" && Number.isFinite(durationMs)
      ? formatLatency(durationMs)
      : "";
  if (screenCapture.loading && !screenCapture.data) {
    return { label: `${base} 준비 중`, latency, slow: false };
  }
  if (screenCapture.loading) {
    return { label: `${base} 갱신 중`, latency, slow: false };
  }
  return {
    label: latency ? `${base} · ${latency}` : base,
    latency,
    slow: typeof durationMs === "number" && durationMs >= 1300
  };
}

function formatLatency(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}초`;
  return `${Math.round(ms / 1000)}초`;
}

function formatTime(ts: number) {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}.${day} ${formatTime(date.getTime())}`;
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || "";
  }
}

function hostNameFromUrl(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split(/[/:]/)[0] || "";
  }
}

function sameHuskyLensHost(left: string, right: string) {
  const leftHost = hostNameFromUrl(left);
  const rightHost = hostNameFromUrl(right);
  return Boolean(leftHost && rightHost && leftHost === rightHost);
}

function getHuskyLensRtspProxyUrl(mcpUrl: string, tick: number) {
  const url = new URL("/api/huskylens/rtsp.mjpeg", window.location.origin);
  url.searchParams.set("url", mcpUrl);
  if (tick) url.searchParams.set("_stream", String(tick));
  return url.toString();
}

type HuskyLensUrlMode = "chat" | "stream";

function normalizeHuskyLensUrl(value: string, mode: HuskyLensUrlMode = "chat") {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (!url.hostname) return "";
    const protocol = mode === "stream" ? "rtsp" : "http";
    const port = mode === "stream" ? "8554" : "3000";
    const path = mode === "stream" ? "/live" : "/sse";
    return `${protocol}://${formatUrlHost(url.hostname)}:${port}${path}`;
  } catch {
    return trimmed;
  }
}

function formatUrlHost(hostname: string) {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}

declare global {
  interface Window {
    __huskylensRoot?: ReturnType<typeof createRoot>;
  }
}

const rootElement = document.getElementById("root")!;
const root = window.__huskylensRoot ?? createRoot(rootElement);
window.__huskylensRoot = root;

root.render(<App />);
