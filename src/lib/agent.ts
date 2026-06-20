import {
  DefaultChatTransport,
  convertToModelMessages,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { AGENT_TOOLS, OPENAI_TOOLS } from "@/lib/agent-tools";

/// Default CS Agent endpoint (same Cloudflare Worker that serves the catalogue).
export const AGENT_ENDPOINT_DEFAULT =
  "https://csspeak-market.xrntkk.top/agent";

export { AGENT_TOOLS, OPENAI_TOOLS };
export { executeClientTool, TOOL_LABELS } from "@/lib/agent-executor";
export type { AgentToolContext } from "@/lib/agent-types";

/// Convert an AI SDK ToolResultOutput into the string content expected by
/// OpenAI-compatible chat completions. The SDK wraps results as
/// `{ type, value }`; providers expect just the value (or its JSON string).
function toolResultToString(output: unknown): string {
  if (
    output != null &&
    typeof output === "object" &&
    "type" in output &&
    "value" in output
  ) {
    const typed = output as { type: string; value: unknown; reason?: string };
    switch (typed.type) {
      case "text":
      case "error-text":
        return String(typed.value);
      case "execution-denied":
        return typed.reason ?? "Tool execution denied.";
      case "json":
      case "error-json":
      case "content":
        return JSON.stringify(typed.value);
    }
  }
  return JSON.stringify(output);
}

/// Convert AI SDK ModelMessages into OpenAI chat-completion messages.
function modelMessagesToOpenAI(messages: ModelMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    switch (m.role) {
      case "system": {
        out.push({ role: "system", content: m.content });
        break;
      }
      case "user": {
        const text =
          typeof m.content === "string"
            ? m.content
            : m.content
                .filter((p) => p.type === "text")
                .map((p) => (p as { text: string }).text)
                .join("");
        out.push({ role: "user", content: text });
        break;
      }
      case "assistant": {
        const parts = typeof m.content === "string" ? [] : m.content;
        const text = parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join("");
        const toolCalls = parts
          .filter((p) => p.type === "tool-call")
          .map((p) => ({
            id: (p as { toolCallId: string }).toolCallId,
            type: "function" as const,
            function: {
              name: (p as { toolName: string }).toolName,
              arguments: JSON.stringify((p as { input: unknown }).input),
            },
          }));
        const msg: Record<string, unknown> = { role: "assistant" };
        if (text) msg.content = text;
        if (toolCalls.length) msg.tool_calls = toolCalls;
        out.push(msg);
        const results = parts.filter((p) => p.type === "tool-result");
        for (const r of results) {
          out.push({
            role: "tool",
            tool_call_id: (r as { toolCallId: string }).toolCallId,
            content: toolResultToString((r as { output: unknown }).output),
          });
        }
        break;
      }
      case "tool": {
        for (const part of m.content) {
          if (part.type === "tool-result") {
            out.push({
              role: "tool",
              tool_call_id: (part as { toolCallId: string }).toolCallId,
              content: toolResultToString((part as { output: unknown }).output),
            });
          }
        }
        break;
      }
    }
  }
  return out;
}

/// Build a stable chat transport for the CS Agent worker endpoint.
export function createAgentTransport(endpoint: string, accessToken?: string) {
  return new DefaultChatTransport({
    api: endpoint,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    prepareSendMessagesRequest: async ({ messages }) => {
      const modelMessages = await convertToModelMessages(messages as UIMessage[], {
        tools: AGENT_TOOLS,
      });
      return {
        api: endpoint,
        body: {
          messages: modelMessagesToOpenAI(modelMessages),
          tools: OPENAI_TOOLS,
        },
      };
    },
  });
}
