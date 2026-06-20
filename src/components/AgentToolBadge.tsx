import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Check, Wrench, X } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import { TOOL_LABELS } from "@/lib/agent-executor";
import type { ToolPart } from "@/lib/agent-types";
import { useTheme } from "@/hooks/use-theme";

export function AgentToolBadge({ part }: { part: ToolPart }) {
  const { resolved } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const label = TOOL_LABELS[part.toolName] ?? part.toolName;
  const done = part.state === "output-available";
  const failed = part.state === "output-error";
  const loading =
    part.state === "input-streaming" || part.state === "input-available";

  let detail: string | null = null;
  if (done && part.output && typeof part.output === "object") {
    const out = part.output as Record<string, unknown>;
    if (out.error) detail = String(out.error);
    else if (out.success) detail = "已执行";
  }
  if (failed && part.errorText) {
    detail = part.errorText;
  }

  const copyOutput = async () => {
    if (part.output == null && part.errorText == null) return;
    const text = part.errorText ?? JSON.stringify(part.output, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const highlighterTheme = resolved === "dark" ? oneDark : oneLight;

  return (
    <div
      className={cn(
        "flex max-w-full flex-col gap-1 rounded-lg border text-xs",
        failed
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : done
            ? "border-border bg-accent/50 text-muted-foreground"
            : "border-border bg-card text-muted-foreground",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {loading ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : failed ? (
          <X className="size-3.5" />
        ) : (
          <Wrench className="size-3.5" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">
          {label}
          {loading && "…"}
        </span>
        {detail && !failed && (
          <span className="ml-2 shrink-0 text-muted-foreground">{detail}</span>
        )}
        {expanded ? (
          <ChevronUp className="ml-2 size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="ml-2 size-3.5 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto overflow-x-hidden border-t border-border/50 px-2 pb-2 pt-1.5">
          {part.input != null && (
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  输入
                </span>
              </div>
              <SyntaxHighlighter
                language="json"
                style={highlighterTheme}
                wrapLongLines
                customStyle={{ margin: 0, borderRadius: 6, fontSize: 11, padding: 8, maxWidth: '100%' }}
              >
                {JSON.stringify(part.input, null, 2)}
              </SyntaxHighlighter>
            </div>
          )}
          {(part.output != null || part.errorText != null) && (
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {failed ? "错误" : "输出"}
                </span>
                <button
                  type="button"
                  onClick={copyOutput}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {copied ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <SyntaxHighlighter
                language="json"
                style={highlighterTheme}
                wrapLongLines
                customStyle={{ margin: 0, borderRadius: 6, fontSize: 11, padding: 8, maxWidth: '100%' }}
              >
                {part.errorText ?? JSON.stringify(part.output, null, 2)}
              </SyntaxHighlighter>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
