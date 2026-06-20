import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { Bot, Send, Sparkles, Square, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { type ServerSnapshot } from "@/lib/ipc";
import {
  createAgentTransport,
  executeClientTool,
  type AgentToolContext,
} from "@/lib/agent";
import type { ToolPart } from "@/lib/agent-types";
import { MarkdownContent } from "@/components/MarkdownContent";
import { AgentToolBadge } from "@/components/AgentToolBadge";
import { AgentHistorySidebar } from "@/components/AgentHistorySidebar";
import {
  createConversation,
  deleteConversation,
  getActiveConversationId,
  listConversations,
  loadConversation,
  saveConversation,
  setActiveConversationId,
  toUIMessages,
  type StoredConversation,
} from "@/lib/conversation-store";

const SIDEBAR_COLLAPSED_KEY = "csspeak.agent.sidebarCollapsed";

interface CsAgentPanelProps {
  endpoint: string;
  accessToken?: string;
  connected: boolean;
  snapshot: ServerSnapshot | null;
}

function isToolPart(part: unknown): part is ToolPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    typeof (part as { type: unknown }).type === "string" &&
    (part as { type: string }).type.startsWith("tool-")
  );
}

/// Translate a raw Error/JSON from useChat into a user-friendly message.
function describeError(err: unknown): { message: string; hint?: string } {
  if (!err) return { message: "未知错误" };

  const raw = err instanceof Error ? err.message : String(err);

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const code = parsed.code as string | undefined;
      const msg = parsed.error as string | undefined;
      if (code === "UNAUTHORIZED" || msg?.includes("unauthorized") || msg?.includes("令牌")) {
        return {
          message: msg ?? "访问令牌无效或未填写",
          hint: "请打开「设置 → CS Agent → 访问令牌」，填写与后端 AGENT_ACCESS_TOKEN 一致的值。",
        };
      }
      if (code === "MISSING_API_KEY") {
        return { message: msg ?? "服务端未配置 API 密钥", hint: "请联系后端管理员配置 EVOMAP_API_KEY。" };
      }
      if (msg) return { message: msg };
    }
  } catch {
    // not JSON
  }

  if (
    raw.includes("401") ||
    raw.includes("UNAUTHORIZED") ||
    raw.includes("unauthorized") ||
    raw.includes("令牌")
  ) {
    return {
      message: "访问令牌无效或未填写",
      hint: "请打开「设置 → CS Agent → 访问令牌」，填写与后端 AGENT_ACCESS_TOKEN 一致的值。",
    };
  }

  const m = raw.match(/^\[(\w+)\]\s*(.*)/);
  if (m) {
    const [, code, detail] = m;
    switch (code) {
      case "AUTH":
        return { message: detail, hint: "EvoMap API 密钥可能已失效，请联系后端管理员更新。" };
      case "RATE_LIMIT":
        return { message: detail, hint: "请等待几秒后再试。" };
      case "UPSTREAM":
        return { message: detail, hint: "EvoMap 服务暂时不可用，稍后重试。" };
      case "NETWORK":
        return { message: detail };
      case "MISSING_API_KEY":
        return { message: detail, hint: "后端 Worker 尚未配置 EvoMap API 密钥，请联系管理员。" };
      case "BAD_REQUEST":
        return { message: detail, hint: "请求格式有误，请重试或更换提问方式。" };
      case "MODEL_INIT_FAILED":
        return { message: detail, hint: "模型配置有误，请检查后端 AGENT_MODEL 设置。" };
      default:
        return { message: detail || raw };
    }
  }

  if (raw === "Load failed" || raw === "Failed to fetch" || raw.includes("NetworkError")) {
    return {
      message: "无法连接到 Agent 服务",
      hint: "请检查网络连接，或确认后端地址是否正确。若刚修改了后端配置，请重新部署 Worker。",
    };
  }

  return {
    message: raw.length > 120 ? raw.slice(0, 120) + "…" : raw,
  };
}

const QUICK_PROMPTS = [
  "分析一下今天的大盘走势",
  "看看热门饰品有哪些搬砖价差",
  "查一下 AK-47 | 红线（久经沙场）的价格",
  "帮我算一下这个库存值多少钱",
  "查一下我的 Steam 库存",
  "在频道发个整活消息活跃一下气氛",
];

export function CsAgentPanel({
  endpoint,
  accessToken,
  connected,
  snapshot,
}: CsAgentPanelProps) {
  const [conversations, setConversations] = useState<StoredConversation[]>(() =>
    listConversations(),
  );
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = getActiveConversationId();
    return saved && loadConversation(saved) ? saved : createConversation();
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch {
      // ignore
    }
  };

  const refreshConversations = () => setConversations(listConversations());

  const handleNew = () => {
    const id = createConversation();
    setActiveConversationId(id);
    setActiveId(id);
    refreshConversations();
  };

  const handleSelect = (id: string) => {
    setActiveConversationId(id);
    setActiveId(id);
    refreshConversations();
  };

  const handleDelete = (id: string) => {
    deleteConversation(id);
    refreshConversations();
    if (activeId === id) {
      const remaining = listConversations();
      const next = remaining[0]?.id ?? createConversation();
      setActiveId(next);
      setActiveConversationId(next);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <AgentHistorySidebar
        conversations={conversations}
        activeId={activeId}
        collapsed={sidebarCollapsed}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onToggleCollapse={toggleSidebar}
      />
      <AgentChat
        key={activeId}
        conversationId={activeId}
        endpoint={endpoint}
        accessToken={accessToken}
        connected={connected}
        snapshot={snapshot}
        onConversationsChange={refreshConversations}
      />
    </div>
  );
}

interface AgentChatProps {
  conversationId: string;
  endpoint: string;
  accessToken?: string;
  connected: boolean;
  snapshot: ServerSnapshot | null;
  onConversationsChange: () => void;
}

function AgentChat({
  conversationId,
  endpoint,
  accessToken,
  connected,
  snapshot,
  onConversationsChange,
}: AgentChatProps) {
  const transport = useMemo(
    () => createAgentTransport(endpoint, accessToken),
    [endpoint, accessToken],
  );

  const initialMessages = useMemo(() => {
    const conv = loadConversation(conversationId);
    return conv ? toUIMessages(conv) : [];
  }, [conversationId]);

  const autoSentToolCallsRef = useRef<string | null>(null);
  const sendAutomaticallyWhen = useMemo(() => {
    return ({ messages }: { messages: UIMessage[] }): boolean => {
      if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) {
        return false;
      }
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role !== "assistant") return false;
      const completedToolKey = lastMessage.parts
        .filter(
          (p) =>
            isToolUIPart(p) &&
            !p.providerExecuted &&
            (p.state === "output-available" || p.state === "output-error"),
        )
        .map((p) => (p as { toolCallId: string }).toolCallId)
        .sort()
        .join(",");
      if (autoSentToolCallsRef.current === completedToolKey) {
        return false;
      }
      autoSentToolCallsRef.current = completedToolKey;
      return true;
    };
  }, []);

  const ctxRef = useRef<AgentToolContext>({ connected, snapshot, accessToken });
  ctxRef.current = { connected, snapshot, accessToken };
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, stop, error, addToolOutput } = useChat({
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen,
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;
      const { toolName, toolCallId, input } = toolCall;
      try {
        const output = await executeClientTool(toolName, input, ctxRef.current);
        addToolOutput({ tool: toolName, toolCallId, output });
      } catch (e) {
        addToolOutput({
          tool: toolName,
          toolCallId,
          state: "output-error",
          errorText: e instanceof Error ? e.message : String(e),
        });
      }
    },
    onFinish: () => {
      saveConversation(conversationId, messages);
      onConversationsChange();
    },
  });

  // Persist messages as the conversation evolves.
  useEffect(() => {
    if (messages.length === 0) return;
    const timeout = setTimeout(() => {
      saveConversation(conversationId, messages);
      onConversationsChange();
    }, 500);
    return () => clearTimeout(timeout);
  }, [messages, conversationId, onConversationsChange]);

  // Auto-scroll to the bottom (visual bottom) of the conversation.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="font-semibold">CS Agent</span>
          <span className="text-xs text-muted-foreground">市场分析 · 频道互动</span>
        </div>
        <EndpointStatus endpoint={endpoint} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/15">
              <Sparkles className="size-7 text-primary" />
            </div>
            <div>
              <div className="font-semibold">CS Agent</div>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                你的 CS2 饰品市场分析师 & 频道整活助手。
              </p>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex flex-col gap-1",
                m.role === "user" ? "items-end" : "items-start",
              )}
            >
              {m.parts.map((part, i) => {
                if (part.type === "text" && part.text) {
                  return (
                    <div
                      key={i}
                      className={cn(
                        "min-w-0 max-w-[80%] rounded-lg px-3 py-2 text-sm break-words",
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-card border border-border",
                      )}
                    >
                      <MarkdownContent>{part.text}</MarkdownContent>
                    </div>
                  );
                }
                if (isToolPart(part)) {
                  return (
                    <div key={i} className="min-w-0 max-w-[min(90%,32rem)]">
                      <AgentToolBadge part={part} />
                    </div>
                  );
                }
                return null;
              })}
            </motion.div>
          ))}
        </AnimatePresence>

        {busy && (
          <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <span className="inline-flex gap-0.5">
              <Dot delay="0ms" />
              <Dot delay="150ms" />
              <Dot delay="300ms" />
            </span>
            {status === "submitted" ? "思考中…" : "回复中…"}
          </div>
        )}

        {error && <ErrorBanner error={error} noToken={!accessToken} />}
        <div ref={messagesEndRef} className="shrink-0" />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy}
              onClick={() => sendMessage({ text: p })}
              className="shrink-0 rounded-full border border-border bg-accent/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("msg") as HTMLInputElement;
            const text = input.value.trim();
            if (!text || busy) return;
            sendMessage({ text });
            input.value = "";
          }}
        >
          <input
            name="msg"
            placeholder="问问 CS Agent…"
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-ring"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              className="flex shrink-0 h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-accent"
            >
              <Square className="size-3.5" />
              停止
            </button>
          ) : (
            <button
              type="submit"
              className="flex shrink-0 h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Send className="size-3.5" />
              发送
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function EndpointStatus({ endpoint }: { endpoint: string }) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOk(null);
    fetch(endpoint, { method: "HEAD", mode: "no-cors" })
      .then(() => {
        if (!cancelled) setOk(true);
      })
      .catch(() => {
        if (!cancelled) setOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title={endpoint}>
      <span
        className={cn(
          "size-2 rounded-full",
          ok === true ? "bg-green-500" : ok === false ? "bg-destructive" : "bg-muted-foreground/50 animate-pulse",
        )}
      />
      <span className="max-w-[160px] truncate">{endpoint.replace(/^https?:\/\//, "")}</span>
    </div>
  );
}

function ErrorBanner({ error, noToken }: { error: unknown; noToken?: boolean }) {
  let { message, hint } = describeError(error);
  if (noToken && (message.includes("无法连接") || message.includes("Load failed"))) {
    message = "可能缺少访问令牌";
    hint = "后端已启用访问控制。请打开「设置 → CS Agent → 访问令牌」填写正确的令牌。";
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <div className="flex items-center gap-1.5">
        <X className="size-3.5 shrink-0" />
        <span className="font-medium">{message}</span>
      </div>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1.5 animate-bounce rounded-full bg-current"
      style={{ animationDelay: delay }}
    />
  );
}
