import type { UIMessage } from "ai";

const CONVERSATIONS_KEY = "csspeak.agent.conversations";
const ACTIVE_CONVERSATION_KEY = "csspeak.agent.activeConversation";
const MAX_MESSAGES_PER_CONVERSATION = 200;

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
}

function readConversations(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as StoredConversation[];
    }
  } catch {
    // ignore corrupt storage
  }
  return [];
}

function writeConversations(list: StoredConversation[]) {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(list));
}

export function listConversations(): StoredConversation[] {
  return readConversations().sort((a, b) => b.createdAt - a.createdAt);
}

export function loadConversation(id: string): StoredConversation | null {
  return readConversations().find((c) => c.id === id) ?? null;
}

export function saveConversation(id: string, messages: UIMessage[]) {
  const list = readConversations();
  const trimmed = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
  const title = deriveTitle(trimmed);
  const now = Date.now();

  const existing = list.find((c) => c.id === id);
  if (existing) {
    existing.title = title;
    existing.updatedAt = now;
    existing.messages = trimmed;
  } else {
    list.push({
      id,
      title,
      createdAt: now,
      updatedAt: now,
      messages: trimmed,
    });
  }

  // Keep only the most recent 50 conversations to avoid unbounded growth.
  list.sort((a, b) => b.createdAt - a.createdAt);
  writeConversations(list.slice(0, 50));
}

export function deleteConversation(id: string) {
  const list = readConversations().filter((c) => c.id !== id);
  writeConversations(list);
}

export function createConversation(): string {
  const id = crypto.randomUUID();
  const list = readConversations();
  list.push({
    id,
    title: "新对话",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  });
  list.sort((a, b) => b.createdAt - a.createdAt);
  writeConversations(list.slice(0, 50));
  return id;
}

export function getActiveConversationId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

export function setActiveConversationId(id: string | null) {
  if (id) {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  }
}

export function toUIMessages(conversation: StoredConversation): UIMessage[] {
  return conversation.messages;
}

function deriveTitle(messages: UIMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "新对话";
  const textPart = firstUser.parts.find(
    (p): p is { type: "text"; text: string } => p.type === "text",
  );
  const text = textPart?.text?.trim() ?? "";
  if (!text) return "新对话";
  return text.length > 24 ? text.slice(0, 24) + "…" : text;
}
