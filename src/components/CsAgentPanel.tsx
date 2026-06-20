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

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            出错了：{error.message}
          </div>
        )}
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

function ToolBadge({ part }: { part: ToolPart }) {
  const label = TOOL_LABELS[part.toolName] ?? part.toolName;
  const done = part.state === "output-available";
  const failed = part.state === "output-error";
  const loading =
    part.state === "input-streaming" || part.state === "input-available";

  // If a messaging tool succeeded, show a compact confirmation.
  let detail: string | null = null;
  if (done && part.output && typeof part.output === "object") {
    const out = part.output as Record<string, unknown>;
    if (out.error) detail = String(out.error);
    else if (out.success) detail = "✓ 已执行";
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        failed
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : done
            ? "border-border bg-accent/50 text-muted-foreground"
            : "border-border bg-card text-muted-foreground",
      )}
    >
      <span>{loading ? "⏳" : failed ? "✕" : "🔧"}</span>
      <span>
        {label}
        {loading && "…"}
      </span>
      {detail && <span className="text-muted-foreground">· {detail}</span>}
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
