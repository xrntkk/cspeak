import { useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Bot, Send, Sparkles, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ServerSnapshot } from "@/lib/ipc";
import {
  createAgentTransport,
  executeClientTool,
  TOOL_LABELS,
  type AgentToolContext,
} from "@/lib/agent";

interface ToolPart {
  type: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
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

const QUICK_PROMPTS = [
  "分析一下今天的大盘走势",
  "看看热门饰品有哪些搬砖价差",
  "查一下 AK-47 | 红线（久经沙场）的价格",
  "在频道发个整活消息活跃一下气氛",
];

/// Translate a raw Error/JSON from useChat into a user-friendly message with
/// an actionable hint. Covers WebKit network failures, 401 auth rejections,
/// and upstream LLM errors forwarded by the Worker.
function describeError(err: unknown): { message: string; hint?: string } {
  if (!err) return { message: "未知错误" };

  const raw = err instanceof Error ? err.message : String(err);

  // The AI SDK transport reads response.text() on non-2xx and throws it as
  // the error message. Try to parse it as a Worker JSON error first.
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
    // not JSON, continue with string matching below
  }

  // Auth errors (Worker returns 401; body may or may not be readable in WebKit)
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

  // Worker-side forwarded errors prefixed with [CODE]
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

  // WebKit/Safari generic network failures — CORS rejection, DNS, Worker down.
  if (raw === "Load failed" || raw === "Failed to fetch" || raw.includes("NetworkError")) {
    return {
      message: "无法连接到 Agent 服务",
      hint: "请检查网络连接，或确认后端地址是否正确。若刚修改了后端配置，请重新部署 Worker。",
    };
  }

  // Fallback: show the raw message, truncated if very long.
  return {
    message: raw.length > 120 ? raw.slice(0, 120) + "…" : raw,
  };
}

export function CsAgentPanel({
  endpoint,
  accessToken,
  connected,
  snapshot,
}: {
  endpoint: string;
  accessToken?: string;
  connected: boolean;
  snapshot: ServerSnapshot | null;
}) {
  const transport = useMemo(
    () => createAgentTransport(endpoint, accessToken),
    [endpoint, accessToken],
  );

  // Keep the latest TS context in a ref so the stable onToolCall closure can
  // always read the current connection/snapshot state.
  const ctxRef = useRef<AgentToolContext>({ connected, snapshot, accessToken });
  ctxRef.current = { connected, snapshot, accessToken };

  const { messages, sendMessage, status, stop, error, addToolOutput } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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
  });

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Connection hint */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
        <Bot className="size-3.5 text-primary" />
        <span className="text-xs text-muted-foreground">
          {connected
            ? "已连接 TS 服务器，可发送频道消息/戳人"
            : "未连接 TS 服务器，仅可使用市场分析功能"}
        </span>
      </div>

      {/* Messages */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/15">
              <Sparkles className="size-7 text-primary" />
            </div>
            <div>
              <div className="font-semibold">CS Agent</div>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                你的 CS2 饰品市场分析师 & 频道整活助手。试试：
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => sendMessage({ text: p })}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-left text-sm transition-colors hover:border-ring"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
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
                      "max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border border-border",
                    )}
                  >
                    {part.text}
                  </div>
                );
              }
              if (isToolPart(part)) {
                return <ToolBadge key={i} part={part} />;
              }
              return null;
            })}
          </div>
        ))}

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
      </div>

      {/* Input */}
      <form
        className="flex items-center gap-2 border-t border-border p-3"
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
            className="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-accent"
          >
            <Square className="size-3.5" />
            停止
          </button>
        ) : (
          <button
            type="submit"
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Send className="size-3.5" />
            发送
          </button>
        )}
      </form>
    </div>
  );
}

function ErrorBanner({ error, noToken }: { error: unknown; noToken?: boolean }) {
  let { message, hint } = describeError(error);

  // If the token is empty and we got a network-level error, the most likely
  // cause is a 401 that WebKit couldn't surface (it masks the response body
  // behind "Load failed"). Override the hint to guide the user to fill the token.
  if (noToken && (message.includes("无法连接") || message.includes("Load failed"))) {
    message = "可能缺少访问令牌";
    hint = "后端已启用访问控制。请打开「设置 → CS Agent → 访问令牌」填写正确的令牌。";
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <div className="flex items-center gap-1.5">
        <span>✕</span>
        <span className="font-medium">{message}</span>
      </div>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}

function ToolBadge({ part }: { part: ToolPart }) {
  const label = TOOL_LABELS[part.toolName] ?? part.toolName;
  const done = part.state === "output-available";
  const failed = part.state === "output-error";
  const loading =
    part.state === "input-streaming" || part.state === "input-available";

  // Extract a human-readable detail line from the tool result or error.
  let detail: string | null = null;
  if (done && part.output && typeof part.output === "object") {
    const out = part.output as Record<string, unknown>;
    if (out.error) detail = String(out.error);
    else if (out.success) detail = "✓ 已执行";
  }
  if (failed && part.errorText) {
    detail = part.errorText;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-md border px-2 py-1 text-xs",
        failed
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : done
            ? "border-border bg-accent/50 text-muted-foreground"
            : "border-border bg-card text-muted-foreground",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span>{loading ? "⏳" : failed ? "✕" : "🔧"}</span>
        <span>
          {label}
          {loading && "…"}
        </span>
        {detail && !failed && (
          <span className="text-muted-foreground">· {detail}</span>
        )}
      </div>
      {failed && detail && (
        <span className="pl-5 text-destructive/80">{detail}</span>
      )}
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
