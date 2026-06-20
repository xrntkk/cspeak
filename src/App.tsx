import { useEffect, useMemo, useRef, useState } from "react";
import {
  File,
  Folder,
  FolderOpen,
  Hash,
  Headphones,
  LayoutGrid,
  Mic,
  MicOff,
  Moon,
  PhoneOff,
  RefreshCw,
  Bot,
  Settings,
  Smile,
  Star,
  Sun,
  Upload,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  checkUpdate,
  connect,
  disconnect,
  joinChannel,
  joinChannelPw,
  kickClient,
  listChannelFiles,
  setClientVolume,
  muteClient,
  onChat,
  onConnInfo,
  onFileList,
  onFtStatus,
  onSnapshot,
  onStatus,
  onTalking,
  poke,
  requestConnectionInfo,
  sendChat,
  setDeafened,
  setInputDevice,
  setMicGain,
  setApmEnabled,
  setDenoiseMode,
  setMuted,
  setOutputDevice,
  setPttActive,
  setPttEnabled,
  setSensitivity,
  setSpkGain,
  uploadFile,
  type ChatMessage,
  type ConnStatus,
  type FileEntry,
  type ServerSnapshot,
} from "@/lib/ipc";
import { SettingsPanel, type AudioSettings } from "@/components/SettingsPanel";
import { MarketPanel } from "@/components/MarketPanel";
import { CsAgentPanel } from "@/components/CsAgentPanel";
import { EmojiPicker } from "@/components/EmojiPicker";
import { AGENT_ENDPOINT_DEFAULT } from "@/lib/agent";
import { open } from "@tauri-apps/plugin-dialog";
import {
  loadBookmarks,
  loadSettings,
  saveBookmarks,
  saveSettings,
  type Bookmark,
} from "@/lib/storage";
import { playJoin, playLeave } from "@/lib/sfx";
import {
  Announcement,
  AnnouncementTag,
  AnnouncementTitle,
} from "@/components/ui/announcement";
import { Tiles } from "@/components/ui/tiles";

const DEFAULT_SETTINGS: AudioSettings = {
  inputDevice: null,
  outputDevice: null,
  micGain: 1,
  spkGain: 1,
  sensitivity: 0,
  pttEnabled: false,
  pttKey: "",
  sfxEnabled: true,
  micTest: false,
  updateCheckEnabled: true,
  adminMode: false,
  apmEnabled: true,
  denoiseMode: "deepfilter",
  agentEndpoint: AGENT_ENDPOINT_DEFAULT,
  agentAccessToken: "",
};

function App() {
  const [status, setStatus] = useState<ConnStatus>({ kind: "disconnected", reason: null });
  const [snapshot, setSnapshot] = useState<ServerSnapshot | null>(null);
  const [talking, setTalking] = useState<number[]>([]);
  const [address, setAddress] = useState("");
  const [nickname, setNickname] = useState("csspeak");
  const [showSettings, setShowSettings] = useState(false);
  const [activeNav, setActiveNav] = useState<"voice" | "soon" | "agent">("voice");
  const [dark, setDark] = useState(
    () => localStorage.getItem("csspeak.theme") === "dark",
  );

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("csspeak.theme", next ? "dark" : "light");
  };
  const [settings, setSettings] = useState<AudioSettings>(() =>
    loadSettings(DEFAULT_SETTINGS),
  );
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks());
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [ping, setPing] = useState<number | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  // Persist settings whenever they change.
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Auto-check for updates on launch.
  useEffect(() => {
    if (settings.updateCheckEnabled) {
      checkUpdate()
        .then((info) => {
          if (
            info.latestVersion &&
            info.latestVersion !== info.currentVersion
          ) {
            setLatestVersion(info.latestVersion);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateBookmarks = (next: Bookmark[]) => {
    setBookmarks(next);
    saveBookmarks(next);
  };

  const connected = status.kind === "connected";

  // The audio engine resets to defaults on each connect; re-push saved settings.
  useEffect(() => {
    if (!connected) return;
    if (settings.inputDevice) setInputDevice(settings.inputDevice);
    if (settings.outputDevice) setOutputDevice(settings.outputDevice);
    setMicGain(settings.micGain);
    setSpkGain(settings.spkGain);
    setSensitivity(settings.sensitivity);
    setPttEnabled(settings.pttEnabled);
    setApmEnabled(settings.apmEnabled);
    setDenoiseMode(settings.denoiseMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => {
    const unStatus = onStatus(setStatus);
    const unSnap = onSnapshot(setSnapshot);
    const unTalk = onTalking(setTalking);
    const unChat = onChat((m) => setChat((prev) => [...prev, m]));
    const unInfo = onConnInfo((i) => {
      if (i.pingMs != null) setPing(i.pingMs);
    });
    return () => {
      unStatus.then((f) => f());
      unSnap.then((f) => f());
      unTalk.then((f) => f());
      unChat.then((f) => f());
      unInfo.then((f) => f());
    };
  }, []);

  // Poll our own connection info (ping) once connected.
  useEffect(() => {
    if (!connected || !snapshot) return;
    const own = snapshot.ownClient;
    const tick = () => requestConnectionInfo(own);
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [connected, snapshot?.ownClient]);

  // Push-to-talk: gate the mic on the configured key while the window is focused.
  useEffect(() => {
    if (!settings.pttEnabled || !settings.pttKey) return;
    const down = (e: KeyboardEvent) => {
      if (e.code === settings.pttKey) setPttActive(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === settings.pttKey) setPttActive(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [settings.pttEnabled, settings.pttKey]);

  // Sound effects: chime when someone enters/leaves your own channel.
  const prevPeersRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!snapshot) {
      prevPeersRef.current = null;
      return;
    }
    const myChannel = snapshot.clients.find(
      (c) => c.id === snapshot.ownClient,
    )?.channel;
    const peers = new Set(
      snapshot.clients
        .filter((c) => c.channel === myChannel && c.id !== snapshot.ownClient)
        .map((c) => c.id),
    );
    const prev = prevPeersRef.current;
    if (prev && settings.sfxEnabled) {
      for (const id of peers) if (!prev.has(id)) playJoin();
      for (const id of prev) if (!peers.has(id)) playLeave();
    }
    prevPeersRef.current = peers;
  }, [snapshot, settings.sfxEnabled]);

  const busy = status.kind === "connecting";

  const statusLabel = useMemo(() => {
    switch (status.kind) {
      case "connecting":
        return "连接中…";
      case "connected":
        return snapshot?.name ?? "已连接";
      case "error":
        return `错误：${status.message}`;
      default:
        return "未连接";
    }
  }, [status, snapshot]);

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      {/* Left navigation rail */}
      <nav className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar py-3">
        <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/15">
          <Headphones className="size-5 text-primary" />
        </div>
        <NavButton
          icon={<Mic className="size-5" />}
          label="语音"
          active={activeNav === "voice"}
          onClick={() => setActiveNav("voice")}
        />
        <NavButton
          icon={<LayoutGrid className="size-5" />}
          label="行情"
          active={activeNav === "soon"}
          onClick={() => setActiveNav("soon")}
        />
        <NavButton
          icon={<Bot className="size-5" />}
          label="Agent"
          active={activeNav === "agent"}
          onClick={() => setActiveNav("agent")}
        />
        <div className="flex-1" />
        <NavButton
          icon={dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
          label={dark ? "亮色" : "暗色"}
          active={false}
          onClick={toggleTheme}
        />
        <NavButton
          icon={<Settings className="size-5" />}
          label="设置"
          active={false}
          onClick={() => setShowSettings(true)}
        />
      </nav>

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {latestVersion && !updateDismissed && (
          <div className="flex h-12 shrink-0 items-center justify-center gap-2 border-b border-primary/20 bg-primary/5 px-4">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="focus:outline-none"
              title="点击前往更新"
            >
              <Announcement className="cursor-pointer">
                <AnnouncementTag>新版本</AnnouncementTag>
                <AnnouncementTitle>
                  发现新版本 v{latestVersion}，点击更新
                  <RefreshCw size={14} className="shrink-0 text-muted-foreground" />
                </AnnouncementTitle>
              </Announcement>
            </button>
            <button
              type="button"
              onClick={() => setUpdateDismissed(true)}
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="关闭"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {activeNav === "voice" ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
              <span className="font-semibold">语音</span>
              <span
                className={cn(
                  "ml-2 text-xs",
                  connected ? "text-primary" : "text-muted-foreground",
                )}
              >
                {statusLabel}
              </span>
              {connected && ping != null && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {Math.round(ping)} ms
                </span>
              )}
            </header>

            {!connected ? (
              <ConnectForm
                address={address}
                nickname={nickname}
                busy={busy}
                bookmarks={bookmarks}
                onAddress={setAddress}
                onNickname={setNickname}
                onConnect={() => connect(address, nickname)}
                onSelectBookmark={(b) => {
                  setAddress(b.address);
                  setNickname(b.nickname);
                }}
                onAddBookmark={() => {
                  if (!address) return;
                  updateBookmarks([
                    ...bookmarks.filter((b) => b.address !== address),
                    { label: address, address, nickname },
                  ]);
                }}
                onRemoveBookmark={(addr) =>
                  updateBookmarks(bookmarks.filter((b) => b.address !== addr))
                }
              />
            ) : (
              <ServerView
                snapshot={snapshot}
                talking={talking}
                chat={chat}
                adminMode={settings.adminMode}
                onDisconnect={() => disconnect()}
              />
            )}
          </>
        ) : activeNav === "agent" ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
              <span className="font-semibold">CS Agent</span>
              <span className="ml-2 text-xs text-muted-foreground">
                市场分析 · 频道互动
              </span>
            </header>
            <CsAgentPanel
              endpoint={settings.agentEndpoint}
              accessToken={settings.agentAccessToken}
              connected={connected}
              snapshot={snapshot}
            />
          </>
        ) : (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
              <span className="font-semibold">市场行情</span>
              <span className="ml-2 text-xs text-muted-foreground">
                CS2 饰品 · SteamDT
              </span>
            </header>
            <MarketPanel dark={dark} accessToken={settings.agentAccessToken} />
          </>
        )}
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-center gap-1 py-2 text-[10px] transition-colors",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-lg transition-colors",
          active ? "bg-primary/15" : "hover:bg-accent",
        )}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

function ConnectForm({
  address,
  nickname,
  busy,
  bookmarks,
  onAddress,
  onNickname,
  onConnect,
  onSelectBookmark,
  onAddBookmark,
  onRemoveBookmark,
}: {
  address: string;
  nickname: string;
  busy: boolean;
  bookmarks: Bookmark[];
  onAddress: (v: string) => void;
  onNickname: (v: string) => void;
  onConnect: () => void;
  onSelectBookmark: (b: Bookmark) => void;
  onAddBookmark: () => void;
  onRemoveBookmark: (address: string) => void;
}) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      <div className="absolute inset-0 opacity-[0.18] dark:opacity-[0.12]">
        <Tiles rows={60} cols={10} tileSize="md" />
      </div>
      <form
        className="relative z-10 flex w-80 flex-col gap-3 rounded-lg border border-border bg-card p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onConnect();
        }}
      >
        <h2 className="text-sm font-semibold">连接到服务器</h2>
        <Field label="服务器地址">
          <input
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
            placeholder="ts.example.com"
            value={address}
            onChange={(e) => onAddress(e.target.value)}
          />
        </Field>
        <Field label="昵称">
          <input
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
            value={nickname}
            onChange={(e) => onNickname(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || !address}
            className="mt-1 h-9 flex-1 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "连接中…" : "连接"}
          </button>
          <button
            type="button"
            onClick={onAddBookmark}
            disabled={!address}
            title="收藏当前地址"
            className="mt-1 flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <Star className="size-4" />
          </button>
        </div>

        {bookmarks.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">收藏的服务器</span>
            {bookmarks.map((b) => (
              <div
                key={b.address}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => onSelectBookmark(b)}
                  className="flex-1 text-left"
                >
                  {b.label}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {b.nickname}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveBookmark(b.address)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ServerView({
  snapshot,
  talking,
  chat,
  adminMode,
  onDisconnect,
}: {
  snapshot: ServerSnapshot | null;
  talking: number[];
  chat: ChatMessage[];
  adminMode: boolean;
  onDisconnect: () => void;
}) {
  const [muted, setMutedState] = useState(false);
  const [deafened, setDeafenedState] = useState(false);
  const [draft, setDraft] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [mutedClients, setMutedClients] = useState<Set<number>>(new Set());
  const [clientVolumes, setClientVolumes] = useState<Map<number, number>>(new Map());
  const [menu, setMenu] = useState<{ id: number; name: string; x: number; y: number } | null>(
    null,
  );
  // In-app input dialog (Tauri WebView has no window.prompt).
  const [dialog, setDialog] = useState<{
    title: string;
    placeholder: string;
    onSubmit: (value: string) => void;
  } | null>(null);

  const refreshFiles = () => {
    if (snapshot) {
      const me = snapshot.clients.find((c) => c.id === snapshot.ownClient);
      if (me) listChannelFiles(me.channel);
    }
  };

  // Subscribe to file list events and refresh on connect.
  useEffect(() => {
    const unList = onFileList(setFiles);
    const unFt = onFtStatus(() => refreshFiles());
    return () => {
      unList.then((f) => f());
      unFt.then((f) => f());
    };
  }, []);
  const [dialogValue, setDialogValue] = useState("");
  const askInput = (
    title: string,
    placeholder: string,
    onSubmit: (value: string) => void,
  ) => {
    setDialogValue("");
    setDialog({ title, placeholder, onSubmit });
  };
  const talkingSet = useMemo(() => new Set(talking), [talking]);

  // Double-click a channel to join; right-click prompts for a password.
  const doJoin = (ch: { id: number; name: string }) => {
    joinChannel(ch.id);
  };
  const promptPassword = (ch: { id: number; name: string }) => {
    askInput(`频道「${ch.name}」密码`, "输入频道密码", (pw) =>
      joinChannelPw(ch.id, pw),
    );
  };

  if (!snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        加载频道…
      </div>
    );
  }

  const ordered = [...snapshot.channels].sort((a, b) => a.order - b.order);
  const clientsByChannel = new Map<number, typeof snapshot.clients>();
  for (const c of snapshot.clients) {
    const arr = clientsByChannel.get(c.channel) ?? [];
    arr.push(c);
    clientsByChannel.set(c.channel, arr);
  }

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border py-2">
          {ordered.map((ch) => (
            <div key={ch.id}>
              <button
                onDoubleClick={() => doJoin(ch)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  promptPassword(ch);
                }}
                title="双击加入频道，右键用密码加入"
                className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-sm transition-colors hover:bg-accent"
              >
                <Hash className="size-3.5 text-muted-foreground" />
                <span>{ch.name}</span>
              </button>
              {(clientsByChannel.get(ch.id) ?? []).map((cl) => {
                const isTalking = talkingSet.has(cl.id);
                return (
                  <div
                    key={cl.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (cl.id === snapshot.ownClient) return;
                      setMenu({ id: cl.id, name: cl.name, x: e.clientX, y: e.clientY });
                    }}
                    className={cn(
                      "flex items-center gap-1.5 py-0.5 pl-8 pr-3 text-sm",
                      isTalking
                        ? "text-primary"
                        : cl.id === snapshot.ownClient
                          ? "text-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    <User
                      className={cn("size-3.5", isTalking && "fill-primary/20")}
                    />
                    <span>{cl.name}</span>
                    {mutedClients.has(cl.id) && (
                      <VolumeX className="size-3 text-destructive" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-border p-4">
            <div className="text-xs uppercase text-muted-foreground">服务器</div>
            <div className="mt-1 font-semibold">{snapshot.name}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {snapshot.channels.length} 个频道 · {snapshot.clients.length} 人在线
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto p-4">
            <div className="flex flex-col gap-1.5">
              {snapshot.welcomeMessage && (
                <div className="rounded-md bg-card p-2 text-xs text-muted-foreground">
                  {snapshot.welcomeMessage}
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} className="text-sm">
                  <span
                    className={cn(
                      "text-xs",
                      m.scope === "poke"
                        ? "font-medium text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    [
                    {m.scope === "channel"
                      ? "频道"
                      : m.scope === "server"
                        ? "服务器"
                        : m.scope === "poke"
                          ? "戳"
                          : "私信"}
                    ]{" "}
                  </span>
                  <span className="font-medium text-primary">{m.from}</span>
                  <span className="text-muted-foreground">：</span>
                  <MessageBody text={m.message} />
                </div>
              ))}
            </div>
          </div>

          <form
            className="flex gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              sendChat("channel", text);
              setDraft("");
            }}
          >
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEmoji(!showEmoji)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent"
              >
                <Smile className="size-4" />
              </button>
              {showEmoji && (
                <EmojiPicker
                  onSelect={(text) => {
                    setDraft((prev) => prev + text);
                    setShowEmoji(false);
                  }}
                  onClose={() => setShowEmoji(false)}
                />
              )}
            </div>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="向当前频道发送消息…"
              className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              发送
            </button>
          </form>
        </main>
      </div>

      {showFiles && (
        <div className="flex h-52 shrink-0 flex-col border-t border-border">
          <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
            <FolderOpen className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">频道文件</span>
            <div className="flex-1" />
            <button
              onClick={refreshFiles}
              title="刷新"
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            >
              <RefreshCw className="size-3.5" />
            </button>
            <button
              onClick={async () => {
                try {
                  const sel = await open({ multiple: false });
                  if (sel && typeof sel === "string" && snapshot) {
                    const name = sel.split("/").pop() || "file";
                    const me = snapshot.clients.find((c) => c.id === snapshot.ownClient);
                    if (me) uploadFile(me.channel, `/${name}`, sel);
                  }
                } catch { /* dialog not available */ }
              }}
              title="上传"
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            >
              <Upload className="size-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {files.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                点击刷新查看频道文件
              </div>
            ) : (
              files.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                >
                  {f.isFile ? <File className="size-3.5 text-muted-foreground" /> : <Folder className="size-3.5 text-muted-foreground" />}
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.size > 1024 * 1024
                      ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
                      : f.size > 1024
                        ? `${(f.size / 1024).toFixed(0)} KB`
                        : `${f.size} B`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <footer className="flex h-16 shrink-0 items-center gap-2 border-t border-border px-4">
        <button
          onClick={() => {
            const next = !muted;
            setMutedState(next);
            setMuted(next);
          }}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-accent",
            muted ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          {muted ? "已静音" : "麦克风"}
        </button>
        <button
          onClick={() => {
            const next = !deafened;
            setDeafenedState(next);
            setDeafened(next);
          }}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-accent",
            deafened ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {deafened ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          {deafened ? "已闭麦" : "扬声器"}
        </button>
        <button
          onClick={() => {
            setShowFiles(!showFiles);
            if (!showFiles) refreshFiles();
          }}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-accent",
            showFiles ? "text-primary" : "text-muted-foreground",
          )}
        >
          <FolderOpen className="size-4" />
          文件
        </button>
        <div className="flex-1" />
        <button
          onClick={onDisconnect}
          className="flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-accent"
        >
          <PhoneOff className="size-4" />
          断开
        </button>
      </footer>

      {menu && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
          <div
            className="fixed z-30 w-44 overflow-hidden rounded-md border border-border bg-popover py-1 text-sm shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            <div className="border-b border-border px-3 py-1 text-xs text-muted-foreground">
              {menu.name}
            </div>
            <div className="border-b border-border px-3 py-2">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>音量</span>
                <span>{Math.round((clientVolumes.get(menu.id) ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={clientVolumes.get(menu.id) ?? 1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setClientVolumes((prev) => new Map(prev).set(menu.id, v));
                  setClientVolume(menu.id, v);
                }}
                className="w-full"
              />
            </div>
            <button
              className="block w-full px-3 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                const id = menu.id;
                const name = menu.name;
                setMenu(null);
                askInput(`戳 ${name}`, "输入消息", (m) => poke(id, m));
              }}
            >
              戳一下
            </button>
            <button
              className="block w-full px-3 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                const id = menu.id;
                const willMute = !mutedClients.has(id);
                muteClient(id, willMute);
                setMutedClients((prev) => {
                  const next = new Set(prev);
                  if (willMute) next.add(id);
                  else next.delete(id);
                  return next;
                });
                setMenu(null);
              }}
            >
              {mutedClients.has(menu.id) ? "取消静音此用户" : "静音此用户"}
            </button>
            {adminMode && (
              <>
                <button
                  className="block w-full px-3 py-1.5 text-left text-destructive hover:bg-accent"
                  onClick={() => {
                    const id = menu.id;
                    const name = menu.name;
                    setMenu(null);
                    askInput(`将 ${name} 踢出频道`, "原因（可空）", (m) =>
                      kickClient(id, m, false),
                    );
                  }}
                >
                  踢出频道
                </button>
                <button
                  className="block w-full px-3 py-1.5 text-left text-destructive hover:bg-accent"
                  onClick={() => {
                    const id = menu.id;
                    const name = menu.name;
                    setMenu(null);
                    askInput(`将 ${name} 踢出服务器`, "原因（可空）", (m) =>
                      kickClient(id, m, true),
                    );
                  }}
                >
                  踢出服务器
                </button>
              </>
            )}
          </div>
        </>
      )}

      {dialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <form
            className="w-80 rounded-lg border border-border bg-card p-5"
            onSubmit={(e) => {
              e.preventDefault();
              dialog.onSubmit(dialogValue);
              setDialog(null);
            }}
          >
            <h3 className="mb-3 text-sm font-semibold">{dialog.title}</h3>
            <input
              autoFocus
              value={dialogValue}
              onChange={(e) => setDialogValue(e.target.value)}
              placeholder={dialog.placeholder}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-ring"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="h-9 rounded-md border border-border px-3 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                type="submit"
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                确定
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function isImageUrl(s: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(s)
    || /(imgur|tenor|gfycat|imgbb|postimg)/i.test(s);
}

function MessageBody({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: { type: "text" | "img"; value: string }[] = [];
    const words = text.split(/(\s+)/);
    for (const w of words) {
      const trimmed = w.trim();
      if (trimmed && isImageUrl(trimmed)) {
        out.push({ type: "img", value: trimmed });
      } else {
        out.push({ type: "text", value: w });
      }
    }
    return out;
  }, [text]);

  return (
    <span>
      {parts.map((p, i) =>
        p.type === "img" ? (
          <img
            key={i}
            src={p.value}
            alt=""
            className="inline-block max-h-40 max-w-[200px] rounded object-contain"
            loading="lazy"
          />
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </span>
  );
}

export default App;
