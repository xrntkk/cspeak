import type { ServerSnapshot } from "@/lib/ipc";

export interface AgentToolContext {
  /// Whether the TS client is currently connected to a server.
  connected: boolean;
  /// Latest server snapshot (channels + clients), needed by messaging tools.
  snapshot: ServerSnapshot | null;
  /// Optional bearer token for Worker access control (AGENT_ACCESS_TOKEN).
  accessToken?: string;
}

export interface ToolPart {
  type: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}
