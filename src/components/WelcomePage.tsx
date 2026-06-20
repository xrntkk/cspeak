import { Star, Clock, ArrowRight, Rocket, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Bookmark, RecentConnection } from "@/lib/storage";

interface WelcomePageProps {
  address: string;
  nickname: string;
  busy: boolean;
  bookmarks: Bookmark[];
  recent: RecentConnection[];
  latestVersion: string | null;
  onAddress: (v: string) => void;
  onNickname: (v: string) => void;
  onConnect: () => void;
  onSelectBookmark: (b: Bookmark) => void;
  onAddBookmark: () => void;
  onRemoveBookmark: (address: string) => void;
  onSelectRecent: (r: RecentConnection) => void;
  onDismissUpdate: () => void;
}

export function WelcomePage({
  address,
  nickname,
  busy,
  bookmarks,
  recent,
  latestVersion,
  onAddress,
  onNickname,
  onConnect,
  onSelectBookmark,
  onAddBookmark,
  onRemoveBookmark,
  onSelectRecent,
  onDismissUpdate,
}: WelcomePageProps) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
      <div className="absolute inset-0 opacity-[0.12] dark:opacity-[0.08]">
        <TilesBackground />
      </div>

      <div className="relative z-10 grid w-full max-w-4xl grid-cols-1 gap-6 md:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <ConnectCard
            address={address}
            nickname={nickname}
            busy={busy}
            onAddress={onAddress}
            onNickname={onNickname}
            onConnect={onConnect}
            onAddBookmark={onAddBookmark}
          />

          {recent.length > 0 && (
            <RecentCard recent={recent} onSelect={onSelectRecent} />
          )}
        </div>

        <div className="flex flex-col gap-6">
          <BookmarksCard
            bookmarks={bookmarks}
            onSelect={onSelectBookmark}
            onRemove={onRemoveBookmark}
          />

          {latestVersion && (
            <UpdateCard version={latestVersion} onDismiss={onDismissUpdate} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectCard({
  address,
  nickname,
  busy,
  onAddress,
  onNickname,
  onConnect,
  onAddBookmark,
}: Pick<
  WelcomePageProps,
  | "address"
  | "nickname"
  | "busy"
  | "onAddress"
  | "onNickname"
  | "onConnect"
  | "onAddBookmark"
>) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-sm backdrop-blur">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
          <Rocket className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="font-semibold">连接到服务器</h1>
          <p className="text-xs text-muted-foreground">输入 TeamSpeak 3 服务器地址开始语音</p>
        </div>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onConnect();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">服务器地址</label>
            <Input
              placeholder="ts.example.com"
              value={address}
              onChange={(e) => onAddress(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">昵称</label>
            <Input value={nickname} onChange={(e) => onNickname(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !address} className="flex-1">
            {busy ? "连接中…" : "连接"}
            {!busy && <ArrowRight className="ml-1 size-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!address}
            onClick={onAddBookmark}
            title="收藏当前地址"
          >
            <Star className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}

function RecentCard({
  recent,
  onSelect,
}: {
  recent: RecentConnection[];
  onSelect: (r: RecentConnection) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Clock className="size-3.5" />
        最近连接
      </div>
      <div className="flex flex-col gap-1">
        {recent.map((r) => (
          <button
            key={r.address}
            type="button"
            onClick={() => onSelect(r)}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{r.address}</span>
              <span className="text-xs text-muted-foreground">{r.nickname}</span>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}

function BookmarksCard({
  bookmarks,
  onSelect,
  onRemove,
}: {
  bookmarks: Bookmark[];
  onSelect: (b: Bookmark) => void;
  onRemove: (address: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Star className="size-3.5" />
        收藏的服务器
      </div>

      {bookmarks.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无收藏，连接时点击星号添加。</p>
      ) : (
        <div className="flex flex-col gap-1">
          {bookmarks.map((b) => (
            <div
              key={b.address}
              className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-accent"
            >
              <button
                type="button"
                onClick={() => onSelect(b)}
                className="flex min-w-0 flex-1 flex-col text-left"
              >
                <span className="truncate font-medium">{b.label}</span>
                <span className="text-xs text-muted-foreground">
                  {b.address} · {b.nickname}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(b.address)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Tag className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpdateCard({
  version,
  onDismiss,
}: {
  version: string;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
        <Rocket className="size-4" />
        发现新版本 v{version}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        新版本已发布，建议前往设置页面下载更新以获得最新功能与修复。
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        知道了
      </button>
    </div>
  );
}

function TilesBackground() {
  // Minimal grid background to avoid importing the heavy Tiles component here.
  return (
    <div
      className="h-full w-full"
      style={{
        backgroundImage:
          "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        maskImage: "radial-gradient(circle at center, black 30%, transparent 80%)",
        WebkitMaskImage: "radial-gradient(circle at center, black 30%, transparent 80%)",
      }}
    />
  );
}
