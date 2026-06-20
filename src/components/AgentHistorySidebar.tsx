import { Plus, Trash2, PanelLeftClose, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoredConversation } from "@/lib/conversation-store";

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}

interface AgentHistorySidebarProps {
  conversations: StoredConversation[];
  activeId: string | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onToggleCollapse: () => void;
}

export function AgentHistorySidebar({
  conversations,
  activeId,
  collapsed,
  onSelect,
  onNew,
  onDelete,
  onToggleCollapse,
}: AgentHistorySidebarProps) {
  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r border-border bg-sidebar py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="展开历史对话"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium">历史对话</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onNew}
            title="新建对话"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            title="收起历史对话"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            暂无历史对话，开始提问吧。
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={cn(
                "group relative flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 transition-colors",
                activeId === c.id
                  ? "bg-primary/10 text-foreground before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:rounded-full before:bg-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <div className="flex min-w-0 flex-col pr-6">
                <span className="line-clamp-1 text-xs font-medium">{c.title}</span>
                <span className="flex items-center gap-2 text-[10px]">
                  {formatRelativeTime(c.updatedAt)}
                  <span className="text-muted-foreground/70">· {c.messages.length} 条</span>
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                title="删除"
                className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
