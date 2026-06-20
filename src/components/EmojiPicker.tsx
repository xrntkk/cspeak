import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

type Category = "表情" | "手势" | "游戏" | "符号" | "动物" | "自定义";

const GROUPS: Record<Exclude<Category, "自定义">, string[]> = {
  表情: [
    "😀", "😂", "🤣", "😅", "😊", "😍", "🤩", "😎", "🤔", "😏",
    "😭", "😤", "😡", "🥶", "🥵", "😱", "🤯", "😴", "🥱", "🤮",
    "💀", "👻", "🤡", "👽", "🤖", "🗿", "🙈", "🙉", "🙊", "😈",
  ],
  手势: [
    "👍", "👎", "👏", "🙌", "🤝", "✌️", "🤞", "🤟", "👊", "💪",
    "🫡", "🙏", "💅", "🤘", "👌", "☝️", "👇", "👆", "👉", "👈",
  ],
  游戏: [
    "🎮", "🎯", "🏆", "🎉", "🎊", "🔥", "💯", "⚡", "💣", "🔫",
    "🛡️", "⚔️", "🏹", "🎖️", "🏅", "🥇", "🥈", "🥉", "🎲", "♟️",
  ],
  符号: [
    "❤️", "💔", "💕", "💖", "💘", "💝", "🫶", "✨", "🌟", "💫",
    "✅", "❌", "⚠️", "🚫", "💤", "💢", "💦", "💨", "🫧", "💩",
    "🫠", "🤌", "🫰", "🤏", "✍️", "🧠", "🫁", "🦴", "👀", "👅",
  ],
  动物: [
    "🐐", "🐒", "🐕", "🐈", "🦊", "🐇", "🐀", "🐉", "🐓", "🦆",
    "🐟", "🐬", "🐋", "🦈", "🐙", "🦀", "🐝", "🐞", "🦋", "🐌",
  ],
};

const CATS: Category[] = [...Object.keys(GROUPS), "自定义"] as Category[];

interface CustomEmoji { url: string; label: string; }

function loadCustom(): CustomEmoji[] {
  try { return JSON.parse(localStorage.getItem("csspeak.custom-emojis") || "[]"); }
  catch { return []; }
}

function saveCustom(items: CustomEmoji[]) {
  localStorage.setItem("csspeak.custom-emojis", JSON.stringify(items));
}

interface Props {
  onSelect: (text: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: Props) {
  const [activeCat, setActiveCat] = useState<Category>("表情");
  const [filter, setFilter] = useState("");
  const [custom, setCustom] = useState<CustomEmoji[]>(loadCustom);
  const [adding, setAdding] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addLabel, setAddLabel] = useState("");

  const list = useMemo(() => {
    if (activeCat === "自定义") {
      return custom.filter(
        (c) =>
          !filter.trim() ||
          c.label.toLowerCase().includes(filter.toLowerCase()),
      );
    }
    const emojis = GROUPS[activeCat];
    if (!filter.trim()) return emojis;
    return emojis.filter((e) => e.includes(filter));
  }, [activeCat, filter, custom]);

  const doAdd = () => {
    if (!addUrl.trim() || !addLabel.trim()) return;
    const next = [...custom, { url: addUrl.trim(), label: addLabel.trim() }];
    setCustom(next);
    saveCustom(next);
    setAddUrl("");
    setAddLabel("");
    setAdding(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-50 mb-1 w-80 rounded-md border border-border bg-popover p-2 shadow-xl">
        {/* Category tabs */}
        <div className="mb-2 flex flex-wrap gap-0.5 border-b border-border pb-1.5">
          {CATS.map((c) => (
            <button
              key={c}
              onClick={() => { setActiveCat(c); setFilter(""); setAdding(false); }}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                activeCat === c
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Quick filter (not for custom tab) */}
        {activeCat !== "自定义" && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索…"
            className="mb-2 h-7 w-full rounded border border-border bg-background px-2 text-xs outline-none"
          />
        )}

        {/* Unicode emoji grid */}
        {activeCat !== "自定义" && (
          <div className="grid max-h-52 grid-cols-8 gap-1 overflow-y-auto">
            {list.map((e) => (
              <button
                key={e as string}
                onClick={() => onSelect(e as string)}
                className="flex size-9 items-center justify-center rounded text-xl leading-none transition-colors hover:bg-accent"
              >
                {e as string}
              </button>
            ))}
          </div>
        )}

        {/* Custom emoji grid */}
        {activeCat === "自定义" && (
          <div className="grid max-h-52 grid-cols-5 gap-1.5 overflow-y-auto">
            {list.map((e, i) => {
              const item = e as CustomEmoji;
              return (
                <button
                  key={i}
                  onClick={() => onSelect(item.label)}
                  title={item.label}
                  className="flex size-14 items-center justify-center rounded transition-colors hover:bg-accent"
                >
                  <img src={item.url} alt={item.label} className="max-h-full max-w-full object-contain" />
                </button>
              );
            })}
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="flex size-14 items-center justify-center rounded border border-dashed border-border text-muted-foreground transition-colors hover:bg-accent"
              >
                <Plus className="size-5" />
              </button>
            )}
          </div>
        )}

        {/* Add custom emoji form */}
        {adding && (
          <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
            <input
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="图片 URL（如 https://i.imgur.com/xxx.png）"
              className="h-8 w-full rounded border border-border bg-background px-2 text-xs outline-none"
            />
            <div className="flex gap-1">
              <input
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="发送的文字（如 [meme]）"
                className="h-8 flex-1 rounded border border-border bg-background px-2 text-xs outline-none"
              />
              <button
                onClick={doAdd}
                disabled={!addUrl.trim() || !addLabel.trim()}
                className="h-8 rounded bg-primary px-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                添加
              </button>
              <button
                onClick={() => setAdding(false)}
                className="h-8 rounded border border-border px-2 text-xs"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
