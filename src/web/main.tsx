import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Aperture,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Cpu,
  Eye,
  Hash,
  ImagePlus,
  KeyRound,
  Loader2,
  Radar,
  Send,
  Settings2,
  Terminal,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
  X,
  Zap
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
  attachments?: string[];
  displayLen?: number;
};

const MAX_ATTACHMENTS = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const HISTORY_STORAGE_KEY = "huskylens:chatHistory";
const HISTORY_LIMIT = 10;
const initialAssistantMessage = {
  role: "assistant" as const,
  text: "허스키렌즈를 연결하고 카메라가 보는 장면에 대해 자유롭게 질문해 주세요. 인식 데이터를 함께 읽고 답변해 드립니다."
};

const defaultMcpUrl =
  localStorage.getItem("huskylens:mcpUrl") || "http://192.168.0.100:3000/sse";
const defaultModel = localStorage.getItem("huskylens:model") || "gpt-5.4-mini";
const defaultReasoning = localStorage.getItem("huskylens:reasoning") || "low";

function App() {
  const [mcpUrl, setMcpUrl] = useState(defaultMcpUrl);
  const [model, setModel] = useState(defaultModel);
  const [reasoningEffort, setReasoningEffort] = useState(defaultReasoning);
  const [openaiApiKey, setOpenaiApiKey] = useState(
    localStorage.getItem("huskylens:openaiApiKey") || ""
  );
  const [question, setQuestion] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(true);
  const [latestVisionContext, setLatestVisionContext] = useState<unknown>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages());
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
  const [answer, setAnswer] = useState<
    ApiState<{ answer: string; visionContext: unknown }>
  >({ loading: false, error: "", data: null });
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadHealth();
  }, []);

  useEffect(() => {
    localStorage.setItem("huskylens:mcpUrl", mcpUrl);
  }, [mcpUrl]);
  useEffect(() => {
    localStorage.setItem("huskylens:model", model);
  }, [model]);
  useEffect(() => {
    localStorage.setItem("huskylens:reasoning", reasoningEffort);
  }, [reasoningEffort]);
  useEffect(() => {
    if (openaiApiKey) localStorage.setItem("huskylens:openaiApiKey", openaiApiKey);
    else localStorage.removeItem("huskylens:openaiApiKey");
  }, [openaiApiKey]);
  useEffect(() => {
    saveStoredMessages(messages);
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, answer.loading]);

  const hasServerApiKey = health.data?.apiKeySource === "server" || Boolean(health.data?.hasServerApiKey);
  const needsApiKey =
    !health.loading && !hasServerApiKey && openaiApiKey.trim().length === 0;
  const canAsk = useMemo(() => {
    const hasKey = hasServerApiKey || openaiApiKey.trim().length > 0;
    const hasInput = question.trim().length > 0 || attachments.length > 0;
    return hasInput && hasKey && Boolean(connection.data);
  }, [attachments.length, connection.data, hasServerApiKey, openaiApiKey, question]);

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

  const sceneState: "live" | "ready" | "idle" = connection.data
    ? latestVisionContext
      ? "ready"
      : "live"
    : "idle";

  async function loadHealth() {
    setHealth({ loading: true, error: "", data: null });
    const result = await apiGet<Record<string, unknown>>("/api/health");
    setHealth({ loading: false, error: result.error, data: result.data });
  }

  async function connect() {
    setConnection({ loading: true, error: "", data: null });
    const result = await apiPost<ConnectionData>("/api/huskylens/connect", {
      url: mcpUrl
    });
    setConnection({ loading: false, error: result.error, data: result.data });
  }

  async function discover() {
    setDiscovery({ loading: true, error: "", data: null });
    const result = await apiGet<string[]>("/api/huskylens/discover");
    if (result.data?.[0]) setMcpUrl(result.data[0]);
    setDiscovery({ loading: false, error: result.error, data: result.data });
  }

  async function readRecognition() {
    setRecognition({ loading: true, error: "", data: null });
    const result = await apiPost("/api/huskylens/recognition", {
      url: connection.data?.url ?? mcpUrl,
      question: "What do you see?"
    });
    setRecognition({ loading: false, error: result.error, data: result.data });
    if (result.data) setLatestVisionContext(result.data);
  }

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed && attachments.length === 0) return;

    const sentAttachments = [...attachments];
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      at: Date.now(),
      attachments: sentAttachments.length > 0 ? sentAttachments : undefined
    };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setAttachments([]);
    setAnswer({ loading: true, error: "", data: null });

    const result = await apiPost<{ answer: string; visionContext: unknown }>(
      "/api/ask",
      {
        huskylensUrl: connection.data?.url ?? mcpUrl,
        openaiApiKey,
        model,
        reasoningEffort,
        question: trimmed || "(첨부 이미지 참고)",
        history: buildConversationHistory(messages),
        attachments: sentAttachments
      }
    );

    if (result.data) {
      const assistantId = crypto.randomUUID();
      setLatestVisionContext(result.data.visionContext);
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

  async function addFilesAsAttachments(files: FileList | File[]) {
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) return;
    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) return;
    const accepted: string[] = [];
    for (const file of incoming.slice(0, remaining)) {
      if (file.size > MAX_FILE_BYTES) continue;
      const dataUrl = await fileToDataUrl(file);
      if (dataUrl) accepted.push(dataUrl);
    }
    if (accepted.length > 0) {
      setAttachments((curr) => [...curr, ...accepted].slice(0, MAX_ATTACHMENTS));
    }
  }

  function removeAttachment(index: number) {
    setAttachments((curr) => curr.filter((_, i) => i !== index));
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canAsk && !answer.loading) void ask();
    }
  }

  function clearConversation() {
    const next = [createInitialAssistantMessage()];
    setMessages(next);
    setLatestVisionContext(null);
    setRecognition({ loading: false, error: "", data: null });
    setAnswer({ loading: false, error: "", data: null });
    setStreamingId(null);
  }

  return (
    <main className="relative z-10 min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-4 py-5 sm:px-7 lg:px-10 lg:py-7">
        <AppHeader
          connection={connection}
          model={model}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings((v) => !v)}
        />

        {needsApiKey ? (
          <ApiKeyStartScreen
            onSave={(value) => setOpenaiApiKey(value)}
            healthError={health.error}
          />
        ) : (
        <div className="mt-6 grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* CHAT PANEL */}
          <section className="reveal flex min-h-[640px] flex-col overflow-hidden rounded-[28px] panel-glass grain lg:h-[calc(100vh-128px)]">
            <SceneStrip
              state={sceneState}
              connectedAt={connection.data?.connectedAt}
              mcpUrl={connection.data?.url}
              model={model}
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

            <div className="border-t border-white/70 bg-white/70 px-4 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5">
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
                attachments={attachments}
                onAddFiles={addFilesAsAttachments}
                onRemoveAttachment={removeAttachment}
              />
            </div>
          </section>

          {/* SIDEBAR */}
          <aside
            className={`${
              showSettings ? "flex" : "hidden lg:flex"
            } reveal min-h-0 flex-col gap-4 overflow-y-auto pb-2 lg:h-[calc(100vh-128px)] scroll-fade`}
            style={{ animationDelay: "80ms" }}
          >
            <ConnectionPanel
              mcpUrl={mcpUrl}
              onChangeUrl={setMcpUrl}
              onDiscover={discover}
              onConnect={connect}
              onReadScene={readRecognition}
              connection={connection}
              discovery={discovery}
              recognition={recognition}
            />
            <ModelPanel
              hasServerApiKey={hasServerApiKey}
              openaiApiKey={openaiApiKey}
              onChangeApiKey={setOpenaiApiKey}
              model={model}
              onChangeModel={setModel}
              reasoningEffort={reasoningEffort}
              onChangeReasoning={setReasoningEffort}
            />
            <VisionDataPanel
              context={latestVisionContext ?? recognition.data}
              live={Boolean(connection.data)}
            />
          </aside>
        </div>
        )}
      </div>
    </main>
  );
}

function ApiKeyStartScreen({
  onSave,
  healthError
}: {
  onSave: (value: string) => void;
  healthError: string;
}) {
  const [draft, setDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const trimmed = draft.trim();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmed) onSave(trimmed);
  }

  return (
    <section className="reveal mt-8 flex flex-1 items-center justify-center pb-8">
      <form
        onSubmit={submit}
        className="panel-glass grain w-full max-w-[560px] rounded-[28px] p-6 shadow-elevated sm:p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-ink text-azure-200 shadow-soft">
            <KeyRound size={21} strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-[12px] font-semibold text-silver-500">
              처음 시작
            </p>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">
              OpenAI API Key 입력
            </h2>
          </div>
        </div>

        <p className="mb-5 text-[15px] leading-[1.7] text-silver-700">
          대회용 키를 입력하면 이 브라우저에 저장됩니다. 허스키렌즈 연결 후 바로 질문할 수 있습니다.
        </p>

        <label className="block">
          <span className="mb-1.5 inline-block text-[12px] font-semibold text-silver-700">
            API Key
          </span>
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              type={showKey ? "text" : "password"}
              placeholder="sk-..."
              autoFocus
              spellCheck={false}
              className="h-12 min-w-0 flex-1 rounded-[14px] border border-silver-200 bg-white px-4 font-mono text-[13px] text-ink shadow-sunk outline-none transition focus:border-azure-300"
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
              className="h-12 rounded-[14px] border border-silver-200 bg-white px-4 text-[13px] font-semibold text-silver-700 shadow-crisp transition hover:bg-frost"
            >
              {showKey ? "숨김" : "보기"}
            </button>
          </div>
        </label>

        {healthError && (
          <div className="mt-3 flex items-start gap-2 rounded-[12px] border border-alert/30 bg-alert/8 px-3 py-2.5 text-[12.5px] font-medium text-alert-deep">
            <CircleAlert className="mt-0.5 shrink-0" size={14} />
            <span className="leading-snug">{healthError}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!trimmed}
          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-ink px-5 text-[14px] font-semibold text-white shadow-elevated transition hover:bg-char active:translate-y-px disabled:cursor-not-allowed disabled:bg-silver-300 disabled:text-silver-500"
        >
          시작하기
          <ChevronRight size={16} />
        </button>

        <p className="mt-4 text-center text-[12px] leading-[1.6] text-silver-500">
          대회가 끝나면 브라우저 저장 데이터를 지우면 됩니다.
        </p>
      </form>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*  HEADER                                                       */
/* ════════════════════════════════════════════════════════════ */

function AppHeader({
  connection,
  model,
  showSettings,
  onToggleSettings
}: {
  connection: ApiState<ConnectionData>;
  model: string;
  showSettings: boolean;
  onToggleSettings: () => void;
}) {
  const connected = Boolean(connection.data);
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3.5">
        <div className="relative">
          <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-ink text-azure-200 shadow-elevated">
            <Aperture size={22} strokeWidth={1.4} />
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full ${
              connected ? "bg-signal" : "bg-silver-400"
            } ring-2 ring-mist`}
            aria-hidden
          />
        </div>
        <div className="leading-tight">
          <p className="text-[11px] font-semibold text-silver-500">
            실시간 비전 연결
          </p>
          <h1 className="font-display text-[24px] font-medium tracking-[-0.022em] text-ink">
            HUSKYLENS AI 비서
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DeviceStatusPill
          connected={connected}
          loading={connection.loading}
          url={connection.data?.url}
        />
        <ModelChip model={model} />
        <button
          type="button"
          onClick={onToggleSettings}
          aria-label="설정 패널"
          className="lift relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-silver-200 bg-white/80 text-ink shadow-crisp transition hover:bg-white"
        >
          {showSettings ? <X size={17} /> : <Settings2 size={17} />}
        </button>
      </div>
    </header>
  );
}

function DeviceStatusPill({
  connected,
  loading,
  url
}: {
  connected: boolean;
  loading: boolean;
  url?: string;
}) {
  const host = url ? hostFromUrl(url) : "";
  if (loading) {
    return (
      <div className="hidden items-center gap-2 rounded-full border border-silver-200 bg-white/70 px-3.5 py-2 text-silver-700 shadow-crisp sm:inline-flex">
        <Loader2 className="animate-spin" size={13} />
        <span className="text-[12px] font-semibold">
          연결 중
        </span>
      </div>
    );
  }
  if (!connected) {
    return (
      <div className="hidden items-center gap-2 rounded-full border border-silver-200 bg-white/70 px-3.5 py-2 text-silver-600 shadow-crisp sm:inline-flex">
        <WifiOff size={13} />
        <span className="text-[12px] font-semibold">
          연결 전
        </span>
      </div>
    );
  }
  return (
    <div className="hidden items-center gap-2.5 rounded-full border border-signal/35 bg-signal/10 px-3.5 py-2 text-signal-deep shadow-crisp sm:inline-flex">
      <span className="relative flex h-2 w-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-signal opacity-70" />
        <span className="relative h-2 w-2 rounded-full bg-signal" />
      </span>
      <span className="text-[12px] font-semibold">
        연결됨
      </span>
      {host && (
        <span className="font-mono text-[10px] text-signal-deep/70">{host}</span>
      )}
      <span className="signal-bars flex items-end gap-[2px] text-signal-deep">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

function ModelChip({ model }: { model: string }) {
  return (
    <div className="hidden items-center gap-2 rounded-full border border-silver-200 bg-white/80 px-3.5 py-2 text-silver-700 shadow-crisp md:inline-flex">
      <Cpu size={13} className="text-azure-500" />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
        {model}
      </span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*  SCENE STRIP — appears above chat, shows live capture state  */
/* ════════════════════════════════════════════════════════════ */

function SceneStrip({
  state,
  connectedAt,
  mcpUrl,
  model,
  onClearConversation
}: {
  state: "live" | "ready" | "idle";
  connectedAt?: string;
  mcpUrl?: string;
  model: string;
  onClearConversation: () => void;
}) {
  const map = {
    live: {
      icon: Activity,
      label: "장면 대기",
      tone: "border-azure-200 bg-azure-50/60 text-azure-700",
      hint: "현재 장면을 읽을 수 있습니다"
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
    <div className="border-b border-white/60 bg-white/40 px-5 py-4 sm:px-7">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 ${cfg.tone}`}
          >
            <Icon size={13} />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-medium">
              {cfg.label}
            </span>
          </span>
          <p className="hidden text-[13px] text-silver-700 sm:block">{cfg.hint}</p>
        </div>
        <div className="hidden items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-silver-500 md:flex">
          {connectedAt && (
            <>
            <span className="text-silver-400">연결</span>
            <span>{formatTime(new Date(connectedAt).getTime())}</span>
            <span className="h-3 w-px bg-silver-300" />
          </>
        )}
          <span className="text-silver-400">모델</span>
          <span className="text-silver-700">{model}</span>
          <button
            type="button"
            onClick={onClearConversation}
            className="inline-flex items-center gap-1.5 rounded-full border border-silver-200 bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-silver-600 shadow-crisp transition hover:border-alert/30 hover:text-alert-deep"
          >
            <Trash2 size={11} />
            대화 초기화
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*  CHAT BUBBLES                                                */
/* ════════════════════════════════════════════════════════════ */

function ChatBubble({ message, index }: { message: ChatMessage; index: number }) {
  const isUser = message.role === "user";
  const streaming = !isUser && typeof message.displayLen === "number";
  const visibleText = streaming
    ? message.text.slice(0, message.displayLen ?? 0)
    : message.text;
  const hasAttachments = message.attachments && message.attachments.length > 0;
  const isEmptyBubble = !visibleText && !hasAttachments;

  return (
    <div
      className={`reveal flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
      style={{ animationDelay: `${Math.min(index * 50, 200)}ms` }}
    >
      {!isUser && <Avatar role="assistant" />}
      <div
        className={`flex max-w-[78%] flex-col ${isUser ? "items-end" : "items-start"}`}
      >
        <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-silver-500">
          <span>{isUser ? "나" : "AI"}</span>
          <span className="h-1 w-1 rounded-full bg-silver-400" />
          <span>{formatTime(message.at)}</span>
          {streaming && (
            <span className="ml-1 inline-flex items-center gap-1 text-azure-600">
              <span className="h-1 w-1 animate-pulse rounded-full bg-azure-500" />
              작성 중
            </span>
          )}
        </div>

        {hasAttachments && (
          <AttachmentGallery
            attachments={message.attachments!}
            align={isUser ? "right" : "left"}
          />
        )}

        {(visibleText || streaming || !hasAttachments) && (
          <div
            className={`rounded-[22px] text-[15px] leading-[1.65] shadow-soft ${
              isEmptyBubble ? "px-3 py-2" : "px-4 py-3"
            } ${
              isUser
                ? "bg-ink text-mist"
                : "border border-white/80 bg-white/85 text-ink"
            }`}
            style={
              isUser
                ? {
                    boxShadow:
                      "0 1px 0 rgba(255,255,255,0.06) inset, 0 12px 28px -8px rgba(12,20,36,0.35)"
                  }
                : undefined
            }
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{visibleText}</p>
            ) : (
              <div className="markdown-body">
                <MarkdownMessage text={visibleText} isUser={false} />
                {streaming && <TypingCursor />}
              </div>
            )}
          </div>
        )}
      </div>
      {isUser && <Avatar role="user" />}
    </div>
  );
}

function AttachmentGallery({
  attachments,
  align
}: {
  attachments: string[];
  align: "left" | "right";
}) {
  const cols = attachments.length === 1 ? "grid-cols-1" : "grid-cols-2";
  return (
    <div
      className={`mb-2 grid w-full gap-1.5 ${cols} ${
        align === "right" ? "justify-items-end" : "justify-items-start"
      }`}
    >
      {attachments.map((src, i) => (
        <a
          key={i}
          href={src}
          target="_blank"
          rel="noreferrer"
          className="group relative block overflow-hidden rounded-[14px] border border-white/70 bg-white/40 shadow-soft transition hover:shadow-elevated"
          style={{
            maxWidth: attachments.length === 1 ? 320 : 180
          }}
        >
          <img
            src={src}
            alt=""
            className="block max-h-[220px] w-full object-cover transition group-hover:scale-[1.02]"
          />
        </a>
      ))}
    </div>
  );
}

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
            className={`rounded-md px-1.5 py-0.5 text-[0.92em] ${
              isUser ? "bg-white/15 text-white" : "bg-silver-100 text-ink"
            }`}
          >
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre
            className={`my-3 overflow-auto rounded-2xl p-3 text-sm ${
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

function ThinkingBubble() {
  return (
    <div className="reveal flex justify-start gap-3">
      <Avatar role="assistant" />
      <div className="flex flex-col items-start">
        <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-silver-500">
          <span>AI</span>
          <span className="h-1 w-1 rounded-full bg-azure-400" />
          <span>작성 중</span>
        </div>
        <div className="flex items-center gap-3 rounded-[22px] border border-white/80 bg-white/85 px-4 py-3 text-azure-700 shadow-soft">
          <span className="typing-dots inline-flex items-center">
            <span />
            <span />
            <span />
          </span>
          <span className="text-[13px] font-medium tracking-tight">
            카메라 데이터를 읽고 답변을 작성하는 중
          </span>
        </div>
      </div>
    </div>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="mt-7 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-azure-200 shadow-soft">
        <UserRound size={16} />
      </div>
    );
  }
  return (
    <div className="relative mt-7 h-9 w-9 shrink-0">
      <div className="absolute inset-0 rounded-full bg-azure-200 opacity-30 blur-md" />
      <div className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white bg-white text-azure-600 shadow-soft">
        <Aperture size={16} strokeWidth={1.6} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*  COMPOSER                                                    */
/* ════════════════════════════════════════════════════════════ */

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  disabled: boolean;
  loading: boolean;
  sceneState: "live" | "ready" | "idle";
  attachments: string[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (index: number) => void;
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
      attachments,
      onAddFiles,
      onRemoveAttachment
    },
    ref
  ) {
    const [focused, setFocused] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const attachLimitReached = attachments.length >= MAX_ATTACHMENTS;

    const sceneText: Record<typeof sceneState, string> = {
      live: "카메라 인식 대기",
      ready: "인식 데이터 준비됨",
      idle: "장치 미연결"
    };
    const sceneTone: Record<typeof sceneState, string> = {
      live: "text-azure-600",
      ready: "text-signal-deep",
      idle: "text-silver-500"
    };

    function openFilePicker() {
      fileInputRef.current?.click();
    }

    function handleFiles(files: FileList | null) {
      if (files && files.length > 0) onAddFiles(files);
    }

    function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file && file.type.startsWith("image/")) files.push(file);
        }
      }
      if (files.length > 0) {
        event.preventDefault();
        onAddFiles(files);
      }
    }

    function handleDrop(event: React.DragEvent<HTMLDivElement>) {
      event.preventDefault();
      setDragOver(false);
      if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        onAddFiles(event.dataTransfer.files);
      }
    }

    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative overflow-hidden rounded-[22px] border bg-white transition ${
          dragOver
            ? "border-azure-400 shadow-glow"
            : focused
              ? "border-azure-300 shadow-glow"
              : "border-silver-200 shadow-crisp"
        }`}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[22px] border-2 border-dashed border-azure-400 bg-azure-50/90 font-mono text-[11px] uppercase tracking-[0.2em] text-azure-700">
            <ImagePlus size={16} className="mr-2" />
            이미지를 드롭해서 첨부
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-silver-100 bg-silver-50/40 px-3.5 py-3">
            {attachments.map((src, i) => (
              <div
                key={i}
                className="group relative h-[68px] w-[68px] overflow-hidden rounded-[12px] border border-silver-200 bg-white shadow-soft"
              >
                <img src={src} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(i)}
                  aria-label="첨부 제거"
                  className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink/80 text-white opacity-0 backdrop-blur transition group-hover:opacity-100"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            {!attachLimitReached && (
              <button
                type="button"
                onClick={openFilePicker}
                className="lift inline-flex h-[68px] w-[68px] flex-col items-center justify-center gap-0.5 rounded-[12px] border border-dashed border-silver-300 bg-white text-silver-500 transition hover:border-azure-300 hover:text-azure-600"
              >
                <ImagePlus size={16} />
                <span className="font-mono text-[9px] uppercase tracking-[0.18em]">
                  추가
                </span>
              </button>
            )}
          </div>
        )}

        <textarea
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="허스키렌즈가 보고 있는 장면에 대해 물어보세요…"
          className="block min-h-[90px] w-full border-0 bg-transparent px-5 pt-4 text-[15px] leading-[1.6] outline-none placeholder:text-silver-400"
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <div className="flex items-center justify-between gap-3 border-t border-silver-100 bg-pearl/60 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openFilePicker}
              disabled={attachLimitReached}
              aria-label="이미지 첨부"
              className="lift inline-flex h-9 w-9 items-center justify-center rounded-full border border-silver-200 bg-white text-silver-700 transition hover:border-azure-300 hover:text-azure-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImagePlus size={15} />
            </button>
            <span className="h-4 w-px bg-silver-200" />
            <span
              className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] ${sceneTone[sceneState]}`}
            >
              <Eye size={12} />
              {sceneText[sceneState]}
            </span>
            {attachments.length > 0 && (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-azure-600">
                · {attachments.length}/{MAX_ATTACHMENTS} 첨부됨
              </span>
            )}
            <span className="hidden text-[11px] font-medium text-silver-400 lg:inline-flex">
              · Enter 전송 · Shift+Enter 줄바꿈
            </span>
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium text-white transition hover:bg-char active:translate-y-px disabled:cursor-not-allowed disabled:bg-silver-300 disabled:text-silver-500"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <Send size={14} />
            )}
            <span className="font-semibold">전송</span>
          </button>
        </div>
      </div>
    );
  }
);

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="reveal mb-3 flex items-start gap-2.5 rounded-2xl border border-alert/35 bg-alert/8 px-4 py-3 text-[13.5px] text-alert-deep shadow-soft">
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

/* ════════════════════════════════════════════════════════════ */
/*  SIDEBAR PANELS                                               */
/* ════════════════════════════════════════════════════════════ */

function Panel({
  number,
  title,
  subtitle,
  icon: Icon,
  children
}: {
  number: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] panel-glass grain p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-ink text-azure-200 shadow-soft">
            <Icon size={15} strokeWidth={1.6} />
          </div>
          <div className="leading-tight">
            <p className="text-[11px] font-semibold text-silver-500">
              {number} · {subtitle}
            </p>
            <h2 className="text-[15px] font-semibold tracking-[-0.012em] text-ink">
              {title}
            </h2>
          </div>
        </div>
      </div>
      <div className="hairline mb-4" />
      {children}
    </section>
  );
}

type FlowStatus = "idle" | "loading" | "success" | "error";

function FlowStep({
  index,
  title,
  detail,
  status
}: {
  index: string;
  title: string;
  detail: string;
  status: FlowStatus;
}) {
  const tone: Record<FlowStatus, string> = {
    idle: "border-silver-200 bg-white text-silver-500",
    loading: "border-azure-200 bg-azure-50 text-azure-700",
    success: "border-signal/30 bg-signal/8 text-signal-deep",
    error: "border-alert/30 bg-alert/8 text-alert-deep"
  };
  const dot: Record<FlowStatus, string> = {
    idle: "bg-silver-300",
    loading: "bg-azure-500 animate-pulse",
    success: "bg-signal",
    error: "bg-alert"
  };
  const label: Record<FlowStatus, string> = {
    idle: "대기",
    loading: "진행 중",
    success: "완료",
    error: "확인 필요"
  };

  return (
    <div className={`rounded-[12px] border px-3 py-2.5 ${tone[status]}`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/80 text-[11px] font-semibold shadow-crisp">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink">{title}</p>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
              <span className={`h-1.5 w-1.5 rounded-full ${dot[status]}`} />
              {label[status]}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] leading-snug text-silver-600">
            {detail}
          </p>
        </div>
      </div>
    </div>
  );
}

function ConnectionPanel({
  mcpUrl,
  onChangeUrl,
  onDiscover,
  onConnect,
  onReadScene,
  connection,
  discovery,
  recognition
}: {
  mcpUrl: string;
  onChangeUrl: (value: string) => void;
  onDiscover: () => void;
  onConnect: () => void;
  onReadScene: () => void;
  connection: ApiState<ConnectionData>;
  discovery: ApiState<string[]>;
  recognition: ApiState;
}) {
  const error = connection.error || discovery.error || recognition.error;
  const empty = discovery.data?.length === 0 ? "같은 Wi-Fi에서 MCP 장치를 찾지 못했습니다." : "";
  const foundCount = discovery.data?.length ?? 0;
  const connected = Boolean(connection.data);
  const recognitionSummary = summarizeRecognition(recognition.data);
  const selectedFoundUrl = Boolean(discovery.data?.includes(mcpUrl));
  const discoveryStatus = discovery.loading
    ? "loading"
    : discovery.error || empty
      ? "error"
      : foundCount > 0
        ? "success"
        : "idle";
  const connectionStatus = connection.loading
    ? "loading"
    : connection.error
      ? "error"
      : connected
        ? "success"
        : "idle";
  const recognitionStatus = recognition.loading
    ? "loading"
    : recognition.error
      ? "error"
      : recognition.data
        ? "success"
        : "idle";

  return (
    <Panel number="01" title="허스키렌즈 연결" subtitle="장치 상태" icon={Wifi}>
      <label className="block">
        <span className="mb-1.5 inline-block text-[12px] font-semibold text-silver-700">
          MCP 주소
        </span>
        <input
          value={mcpUrl}
          onChange={(event) => onChangeUrl(event.target.value)}
          spellCheck={false}
          className="h-11 w-full rounded-[12px] border border-silver-200 bg-white px-3.5 font-mono text-[13px] text-ink shadow-sunk outline-none transition focus:border-azure-300"
        />
      </label>

      <div className="mt-3 space-y-2 rounded-[16px] border border-silver-200 bg-white/70 p-2.5 shadow-crisp">
        <FlowStep
          index="1"
          title="자동 찾기"
          status={discoveryStatus}
          detail={
            discovery.loading
              ? "같은 Wi-Fi에서 허스키렌즈를 찾는 중"
              : foundCount > 0
                ? `${foundCount}개 발견${selectedFoundUrl ? " · 현재 주소 선택됨" : ""}`
                : empty || "아직 실행하지 않음"
          }
        />
        <FlowStep
          index="2"
          title="연결"
          status={connectionStatus}
          detail={
            connection.loading
              ? "MCP 도구 목록을 확인하는 중"
              : connection.data
                ? `${hostFromUrl(connection.data.url)} · ${connection.data.tools.length}개 도구`
                : connection.error || "주소 확인 후 연결 필요"
          }
        />
        <FlowStep
          index="3"
          title="현재 장면"
          status={recognitionStatus}
          detail={
            recognition.loading
              ? "카메라 인식 결과를 읽는 중"
              : recognition.data
                ? recognitionSummary
                : recognition.error || "연결 후 장면 읽기 가능"
          }
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onDiscover}
          disabled={discovery.loading}
          className="lift inline-flex h-10 items-center justify-center gap-2 rounded-[12px] border border-silver-200 bg-white text-[13px] font-medium text-ink shadow-crisp transition hover:bg-frost disabled:opacity-60"
        >
          {discovery.loading ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Radar size={14} className="text-azure-500" />
          )}
          {discovery.loading ? "찾는 중" : foundCount > 0 ? "다시 찾기" : "자동 찾기"}
        </button>
        <button
          type="button"
          onClick={onConnect}
          disabled={connection.loading}
          className="lift inline-flex h-10 items-center justify-center gap-2 rounded-[12px] bg-ink text-[13px] font-medium text-white shadow-elevated transition hover:bg-char disabled:opacity-60"
        >
          {connection.loading ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Zap size={14} className="text-azure-300" />
          )}
          {connection.loading ? "연결 중" : connected ? "재연결" : "연결"}
        </button>
      </div>

      <button
        type="button"
        onClick={onReadScene}
        disabled={recognition.loading || !connection.data}
        className="lift mt-2.5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[12px] border border-azure-200 bg-azure-50 text-[13px] font-medium text-azure-700 transition hover:bg-azure-100 disabled:cursor-not-allowed disabled:border-silver-200 disabled:bg-silver-50 disabled:text-silver-400"
      >
        {recognition.loading ? (
          <Loader2 className="animate-spin" size={14} />
        ) : (
          <Eye size={14} />
        )}
        {recognition.loading ? "읽는 중" : recognition.data ? "현재 장면 다시 읽기" : "현재 장면 읽기"}
      </button>

      {(error || empty) && <ErrorChip message={error || empty} />}

      {discovery.data && discovery.data.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[12px] font-semibold text-silver-700">
            발견된 주소
          </p>
          {discovery.data.map((url) => (
            <button
              type="button"
              key={url}
              onClick={() => onChangeUrl(url)}
              className={`group flex w-full items-center justify-between gap-2 rounded-[12px] border px-3 py-2 text-left transition hover:border-azure-300 hover:bg-azure-50 ${
                url === mcpUrl
                  ? "border-azure-300 bg-azure-50"
                  : "border-silver-200 bg-white"
              }`}
            >
              <span className="font-mono text-[12px] text-silver-700 group-hover:text-azure-700">
                {url}
              </span>
              {url === mcpUrl ? (
                <Check size={14} className="text-azure-600" />
              ) : (
                <ChevronRight size={14} className="text-silver-400 group-hover:text-azure-500" />
              )}
            </button>
          ))}
        </div>
      )}

      {connection.data && (
        <div className="mt-4 space-y-2.5">
          <div className="flex items-center gap-2 rounded-[12px] border border-signal/30 bg-signal/8 px-3 py-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-signal opacity-70" />
              <span className="relative h-2 w-2 rounded-full bg-signal" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-deep">
                연결됨 · {formatRelative(connection.data.connectedAt)}
              </p>
              <p className="truncate font-mono text-[11px] text-silver-700">
                {connection.data.url}
              </p>
            </div>
          </div>

          {connection.data.tools.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[12px] font-semibold text-silver-700">
                사용 가능한 기능 · {connection.data.tools.length}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {connection.data.tools.map((tool) => (
                  <span
                    key={tool.name}
                    className="inline-flex items-center gap-1 rounded-md border border-silver-200 bg-white px-2 py-1 font-mono text-[10.5px] text-silver-700 shadow-crisp"
                  >
                    <Hash size={9} className="text-azure-500" />
                    {tool.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ModelPanel({
  hasServerApiKey,
  openaiApiKey,
  onChangeApiKey,
  model,
  onChangeModel,
  reasoningEffort,
  onChangeReasoning
}: {
  hasServerApiKey: boolean;
  openaiApiKey: string;
  onChangeApiKey: (v: string) => void;
  model: string;
  onChangeModel: (v: string) => void;
  reasoningEffort: string;
  onChangeReasoning: (v: string) => void;
}) {
  return (
    <Panel number="02" title="언어 모델" subtitle="답변 설정" icon={Cpu}>
      {hasServerApiKey ? (
        <div className="flex items-center gap-2 rounded-[12px] border border-signal/30 bg-signal/8 px-3 py-2.5 text-signal-deep">
          <Check size={14} />
          <span className="text-[13px] font-medium">서버 API 키 사용 중</span>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 rounded-[12px] border border-warn/35 bg-warn/8 px-3 py-2.5 text-[#8a5a18]">
            <CircleAlert size={14} />
            <span className="text-[13px] font-medium">API 키 입력 필요</span>
          </div>
          <label className="block">
            <span className="mb-1.5 inline-block font-mono text-[10px] uppercase tracking-[0.22em] text-silver-500">
              OpenAI API 키
            </span>
            <input
              value={openaiApiKey}
              onChange={(event) => onChangeApiKey(event.target.value)}
              placeholder="sk-..."
              type="password"
              className="h-11 w-full rounded-[12px] border border-silver-200 bg-white px-3.5 font-mono text-[13px] text-ink shadow-sunk outline-none transition focus:border-azure-300"
            />
          </label>
        </div>
      )}

      <div className="mt-3 grid grid-cols-[1fr_120px] gap-2.5">
        <label className="block">
          <span className="mb-1.5 inline-block font-mono text-[10px] uppercase tracking-[0.22em] text-silver-500">
            모델
          </span>
          <input
            value={model}
            onChange={(event) => onChangeModel(event.target.value)}
            spellCheck={false}
            className="h-11 w-full rounded-[12px] border border-silver-200 bg-white px-3.5 font-mono text-[13px] text-ink shadow-sunk outline-none transition focus:border-azure-300"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 inline-block font-mono text-[10px] uppercase tracking-[0.22em] text-silver-500">
            추론
          </span>
          <div className="relative">
            <select
              value={reasoningEffort}
              onChange={(event) => onChangeReasoning(event.target.value)}
              className="h-11 w-full appearance-none rounded-[12px] border border-silver-200 bg-white pl-3.5 pr-8 font-mono text-[12px] text-ink shadow-sunk outline-none transition focus:border-azure-300"
            >
              <option value="minimal">minimal</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <ChevronRight
              size={13}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 text-silver-400"
            />
          </div>
        </label>
      </div>

    </Panel>
  );
}

function VisionDataPanel({
  context,
  live
}: {
  context: unknown;
  live: boolean;
}) {
  const text = formatData(context);
  const empty = !context;
  const details = getRecognitionDetails(context);

  return (
    <Panel number="03" title="비전 데이터" subtitle="현재 장면" icon={Terminal}>
      {details && (
        <div className="mb-3 space-y-2 rounded-[14px] border border-silver-200 bg-white/75 p-3 shadow-crisp">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-silver-700">
            <span className="rounded-full bg-azure-50 px-2.5 py-1 text-azure-700">
              알고리즘 {details.algorithm}
            </span>
            <span className="rounded-full bg-signal/10 px-2.5 py-1 text-signal-deep">
              인식 {details.detections.length}개
            </span>
            <span className="rounded-full bg-silver-100 px-2.5 py-1 text-silver-700">
              이미지 {details.resources.length}장
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {details.labels.length > 0 ? (
              details.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-md border border-silver-200 bg-white px-2 py-1 text-[12px] font-medium text-ink"
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="text-[12px] font-medium text-silver-500">
                인식된 객체 없음
              </span>
            )}
          </div>
          {details.imageUrl && (
            <a
              href={details.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-azure-700 hover:text-azure-600"
            >
              결과 이미지 열기
              <ChevronRight size={13} />
            </a>
          )}
        </div>
      )}
      <div className="relative overflow-hidden rounded-[14px] panel-deep">
        <div className="flex items-center justify-between border-b border-azure-200/10 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-alert/80" />
            <span className="h-2 w-2 rounded-full bg-warn/80" />
            <span className="h-2 w-2 rounded-full bg-signal/80" />
          </div>
          <div className="flex items-center gap-1.5">
            {live && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-signal opacity-70" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-signal" />
              </span>
            )}
            <span className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-azure-200/70">
              {live ? "연결됨" : "대기"}
            </span>
          </div>
        </div>
        <div className="grid-fine relative max-h-[260px] overflow-auto scroll-fade">
          <pre className="relative whitespace-pre-wrap break-words p-4 font-mono text-[11.5px] leading-[1.65] text-azure-100/95">
            {empty ? (
              <span className="text-azure-200/40">
                {"현재 장면을 읽으면 인식 결과가 여기에 표시됩니다."}
              </span>
            ) : (
              text
            )}
          </pre>
          {live && <div className="scan-line" />}
        </div>
      </div>
    </Panel>
  );
}

function ErrorChip({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-[12px] border border-alert/30 bg-alert/8 px-3 py-2.5 text-[12.5px] font-medium text-alert-deep">
      <CircleAlert className="mt-0.5 shrink-0" size={14} />
      <span className="leading-snug">{message}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*  UTILS                                                       */
/* ════════════════════════════════════════════════════════════ */

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

function formatData(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function createInitialAssistantMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: initialAssistantMessage.role,
    text: initialAssistantMessage.text,
    at: Date.now()
  };
}

function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [createInitialAssistantMessage()];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [createInitialAssistantMessage()];
    const messages = parsed
      .filter((item) => item && (item.role === "assistant" || item.role === "user") && typeof item.text === "string")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
        role: item.role,
        text: item.text,
        at: typeof item.at === "number" ? item.at : Date.now(),
        attachments: Array.isArray(item.attachments) ? item.attachments : undefined
      }))
      .slice(-HISTORY_LIMIT);
    return messages.length > 0 ? messages : [createInitialAssistantMessage()];
  } catch {
    return [createInitialAssistantMessage()];
  }
}

function saveStoredMessages(messages: ChatMessage[]) {
  const serializable = messages
    .filter((message) => message.text.trim() || message.attachments?.length)
    .map(({ id, role, text, at, attachments }) => ({
      id,
      role,
      text,
      at,
      attachments
    }))
    .slice(-HISTORY_LIMIT);
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(serializable));
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

function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function formatTime(ts: number) {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatRelative(iso: string) {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  return `${Math.floor(diff / 3_600_000)}시간 전`;
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || "";
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
