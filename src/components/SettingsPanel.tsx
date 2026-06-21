import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Download,
  Gauge,
  KeyRound,
  RefreshCw,
  Settings as SettingsIcon,
  Shield,
  Sliders,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import {
  checkUpdate,
  downloadUpdate,
  listDevices,
  onUpdateDownloadProgress,
  openInstaller,
  setApmEnabled,
  setDenoiseMode,
  setInputDevice,
  setMicGain,
  setMicTest,
  setOutputDevice,
  setPttEnabled,
  setSensitivity,
  setSpkGain,
  usePrivilegeKey,
  type DenoiseMode,
  type UpdateInfo,
} from "@/lib/ipc";

export interface AudioSettings {
  inputDevice: string | null;
  outputDevice: string | null;
  micGain: number;
  spkGain: number;
  sensitivity: number;
  pttEnabled: boolean;
  pttKey: string;
  sfxEnabled: boolean;
  micTest: boolean;
  /// WebRTC echo cancellation + auto gain (AEC/AGC master switch).
  apmEnabled: boolean;
  /// Noise suppression stage: off / webrtc / deepfilter.
  denoiseMode: DenoiseMode;
  /// Whether to show admin actions (kick) in the user menu. Set automatically
  /// after applying a privilege key; can also be toggled manually.
  adminMode: boolean;
  /// Whether to auto-check for updates on launch.
  updateCheckEnabled: boolean;
  /// CS Agent worker endpoint (AI SDK v7 streaming chat).
  agentEndpoint: string;
  /// Optional bearer token sent to the Worker when AGENT_ACCESS_TOKEN is set.
  agentAccessToken: string;
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-muted-foreground/80">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <span
        className={cn(
          "size-5 rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

const selectCls =
  "h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring";
const rangeCls = "w-full accent-primary";

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  inline = false,
  scrollToUpdate = false,
  onScrolledToUpdate,
}: {
  settings: AudioSettings;
  onChange: (next: AudioSettings) => void;
  onClose?: () => void;
  inline?: boolean;
  scrollToUpdate?: boolean;
  onScrolledToUpdate?: () => void;
}) {
  const [inputs, setInputs] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [capturingKey, setCapturingKey] = useState(false);
  const [privKey, setPrivKey] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const updateSectionRef = useRef<HTMLDivElement>(null);

  // Auto-check for updates on mount so the current version and availability
  // are visible immediately without an extra click.
  useEffect(() => {
    if (settings.updateCheckEnabled) {
      doCheckUpdate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to the update section when requested (e.g. from the update banner).
  useEffect(() => {
    if (scrollToUpdate && updateSectionRef.current) {
      updateSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      onScrolledToUpdate?.();
    }
  }, [scrollToUpdate, onScrolledToUpdate]);

  const doCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    setDownloadedPath(null);
    setDownloadProgress(0);
    setDownloadError(null);
    setOpenError(null);
    try {
      const info = await checkUpdate();
      setUpdateInfo(info);
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Listen for download progress events while downloading.
  useEffect(() => {
    if (!downloading) return;
    const unlisten = onUpdateDownloadProgress((p) => {
      if (p.total > 0) {
        setDownloadProgress(Math.round((p.downloaded / p.total) * 100));
      } else {
        setDownloadProgress(-1); // indeterminate
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [downloading]);

  const doDownload = async () => {
    if (!updateInfo?.recommendedAsset) return;
    setDownloading(true);
    setDownloadError(null);
    setDownloadProgress(0);
    setDownloadedPath(null);
    setOpenError(null);
    try {
      const path = await downloadUpdate(
        updateInfo.recommendedAsset.url,
        updateInfo.recommendedAsset.name,
      );
      setDownloadedPath(path);
      // Auto-open the installer using the platform-specific handler.
      const shouldOpen = await confirm(
        "安装前需要先关闭当前应用，否则可能导致安装失败。是否现在打开安装包？",
        { title: "关闭应用以继续安装", kind: "warning" },
      );
      if (shouldOpen) {
        try {
          await openInstaller(path);
        } catch (e) {
          setOpenError(String(e));
        }
      }
    } catch (e) {
      setDownloadError(String(e));
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    listDevices().then(([ins, outs]) => {
      setInputs(ins);
      setOutputs(outs);
    });
  }, []);

  const patch = (p: Partial<AudioSettings>) => onChange({ ...settings, ...p });

  const panel = (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-card",
        inline ? "min-h-0 flex-1 rounded-none border-0" : "max-h-full w-[28rem] max-w-full rounded-lg border border-border shadow-xl",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {!inline && (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SettingsIcon className="size-4 text-muted-foreground" />
          <span className="font-semibold">设置</span>
          <div className="flex-1" />
          {onClose && (
            <button
              onClick={onClose}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </header>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <Section icon={<Volume2 className="size-3.5" />} title="设备">
            <Row label="输入设备(麦克风)">
              <select
                className={selectCls}
                value={settings.inputDevice ?? ""}
                onChange={(e) => {
                  const name = e.target.value || null;
                  patch({ inputDevice: name });
                  setInputDevice(name);
                }}
              >
                <option value="">系统默认</option>
                {inputs.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Row>

            <Row label="输出设备(扬声器)">
              <select
                className={selectCls}
                value={settings.outputDevice ?? ""}
                onChange={(e) => {
                  const name = e.target.value || null;
                  patch({ outputDevice: name });
                  setOutputDevice(name);
                }}
              >
                <option value="">系统默认</option>
                {outputs.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Row>
          </Section>

          <Section icon={<Waves className="size-3.5" />} title="测试">
            <label className="flex items-center justify-between">
              <span className="text-sm">麦克风测试(本地回放)</span>
              <input
                type="checkbox"
                checked={settings.micTest}
                onChange={(e) => {
                  const next = e.target.checked;
                  setMicTest(next);
                  patch({ micTest: next });
                }}
              />
            </label>
            {settings.micTest && (
              <p className="mt-1 text-xs text-muted-foreground">
                正在播放处理后的麦克风信号至本地扬声器。
              </p>
            )}
          </Section>

          <Section icon={<Sliders className="size-3.5" />} title="音量">
            <Row label={`麦克风音量 ${Math.round(settings.micGain * 100)}%`}>
              <input
                type="range"
                className={rangeCls}
                min={0}
                max={2}
                step={0.05}
                value={settings.micGain}
                onChange={(e) => {
                  const g = Number(e.target.value);
                  patch({ micGain: g });
                  setMicGain(g);
                }}
              />
            </Row>

            <Row label={`扬声器音量 ${Math.round(settings.spkGain * 100)}%`}>
              <input
                type="range"
                className={rangeCls}
                min={0}
                max={2}
                step={0.05}
                value={settings.spkGain}
                onChange={(e) => {
                  const g = Number(e.target.value);
                  patch({ spkGain: g });
                  setSpkGain(g);
                }}
              />
            </Row>

            <Row
              label={`麦克风灵敏度阈值 ${settings.sensitivity.toFixed(3)}(0=常开)`}
            >
              <input
                type="range"
                className={rangeCls}
                min={0}
                max={0.1}
                step={0.001}
                value={settings.sensitivity}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  patch({ sensitivity: s });
                  setSensitivity(s);
                }}
              />
            </Row>
          </Section>

          <Section icon={<Waves className="size-3.5" />} title="降噪处理">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm">回声消除 / 自动增益(AEC/AGC)</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  WebRTC 处理:消除扬声器回声并自动调平音量。外放时建议开启。
                </p>
              </div>
              <Toggle
                checked={settings.apmEnabled}
                onChange={(v) => {
                  patch({ apmEnabled: v });
                  setApmEnabled(v);
                }}
              />
            </div>

            <div className="border-t border-border pt-3">
              <Row label="降噪模式">
                <div className="flex gap-1.5">
                  {(
                    [
                      ["off", "关"],
                      ["webrtc", "WebRTC"],
                      ["deepfilter", "AI 降噪"],
                    ] as [DenoiseMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        patch({ denoiseMode: mode });
                        setDenoiseMode(mode);
                      }}
                      className={cn(
                        "flex-1 rounded-md border px-2 py-1.5 text-sm transition-colors",
                        settings.denoiseMode === mode
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Row>
              <p className="mt-2 text-xs text-muted-foreground">
                AI 降噪(DeepFilterNet)对键盘、风扇、人声背景等噪声抑制更强,质量优于官方。
              </p>
            </div>
          </Section>

          <Section icon={<Gauge className="size-3.5" />} title="体验">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">进出频道音效</span>
              <Toggle
                checked={settings.sfxEnabled}
                onChange={(v) => patch({ sfxEnabled: v })}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-sm">按键说话(PTT)</span>
              <Toggle
                checked={settings.pttEnabled}
                onChange={(v) => {
                  patch({ pttEnabled: v });
                  setPttEnabled(v);
                }}
              />
            </div>
            {settings.pttEnabled && (
              <button
                onClick={() => setCapturingKey(true)}
                onKeyDown={(e) => {
                  if (capturingKey) {
                    e.preventDefault();
                    patch({ pttKey: e.code });
                    setCapturingKey(false);
                  }
                }}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                {capturingKey
                  ? "按下一个键…"
                  : `热键:${settings.pttKey || "未设置"}`}
              </button>
            )}
          </Section>

          <Section icon={<Shield className="size-3.5" />} title="管理">
            <Row label="权限密钥(Privilege Key)">
              <div className="flex gap-2">
                <input
                  value={privKey}
                  onChange={(e) => setPrivKey(e.target.value)}
                  placeholder="粘贴管理员发的 token"
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                />
                <button
                  type="button"
                  disabled={!privKey.trim()}
                  onClick={() => {
                    usePrivilegeKey(privKey.trim());
                    patch({ adminMode: true });
                    setPrivKey("");
                  }}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  <KeyRound className="size-3.5" />
                  应用
                </button>
              </div>
            </Row>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-sm">显示管理操作(踢人)</span>
              <Toggle
                checked={settings.adminMode}
                onChange={(v) => patch({ adminMode: v })}
              />
            </div>
          </Section>

          <Section icon={<Bot className="size-3.5" />} title="CS Agent">
            <Row label="后端地址">
              <input
                value={settings.agentEndpoint}
                onChange={(e) => patch({ agentEndpoint: e.target.value })}
                placeholder="https://…/agent"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              />
            </Row>
            <Row label="访问令牌（可选）">
              <input
                type="password"
                value={settings.agentAccessToken}
                onChange={(e) => patch({ agentAccessToken: e.target.value })}
                placeholder="留空则不校验"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              />
            </Row>
            <p className="text-xs text-muted-foreground">
              若后端启用了访问控制，填入令牌以鉴权。API 密钥仅存于服务端，前端不会接触。
            </p>
          </Section>

          <div ref={updateSectionRef}>
            <Section icon={<Download className="size-3.5" />} title="更新">
              <div className="flex items-center justify-between gap-3">
              <span className="text-sm">当前版本</span>
              <span className="rounded-md bg-accent px-2 py-0.5 font-mono text-xs">
                v{updateInfo?.currentVersion ?? "—"}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">启动时自动检查更新</span>
              <Toggle
                checked={settings.updateCheckEnabled}
                onChange={(v) => patch({ updateCheckEnabled: v })}
              />
            </div>

            <button
              type="button"
              disabled={checkingUpdate}
              onClick={doCheckUpdate}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-background text-sm transition-colors hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw
                className={cn("size-3.5", checkingUpdate && "animate-spin")}
              />
              {checkingUpdate ? "检查中…" : "检查更新"}
            </button>

            {updateError && (
              <p className="text-xs text-destructive">
                检查失败:{updateError.length > 80
                  ? updateError.slice(0, 80) + "…"
                  : updateError}
              </p>
            )}

            {updateInfo && updateInfo.latestVersion &&
              updateInfo.latestVersion !== updateInfo.currentVersion && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ArrowUpRight className="size-3.5 text-primary" />
                    发现新版本 v{updateInfo.latestVersion}
                  </div>
                  {updateInfo.releaseNotes && (
                    <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                      {updateInfo.releaseNotes}
                    </p>
                  )}

                  {/* In-app download + install when a platform asset is found */}
                  {updateInfo.recommendedAsset && !downloadedPath && (
                    <>
                      {downloading ? (
                        <div className="mt-3 flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>下载中…</span>
                            <span>
                              {downloadProgress >= 0 ? `${downloadProgress}%` : "…"}
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-accent">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{
                                width: downloadProgress >= 0 ? `${downloadProgress}%` : "100%",
                                animation: downloadProgress < 0 ? "pulse 1.5s infinite" : undefined,
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={downloading}
                          onClick={doDownload}
                          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          <Download className="size-3.5" />
                          立即更新
                        </button>
                      )}
                      {downloadError && (
                        <p className="mt-2 text-xs text-destructive">
                          下载失败:{downloadError.length > 60
                            ? downloadError.slice(0, 60) + "…"
                            : downloadError}
                        </p>
                      )}
                    </>
                  )}

                  {/* Download complete: offer to open the installer */}
                  {downloadedPath && (
                    <div className="mt-3 flex flex-col gap-2">
                      <p className="text-xs text-primary">
                        下载完成，请在弹出的安装界面中完成安装。
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          setOpenError(null);
                          const shouldOpen = await confirm(
                            "安装前需要先关闭当前应用，否则可能导致安装失败。是否现在打开安装包？",
                            { title: "关闭应用以继续安装", kind: "warning" },
                          );
                          if (!shouldOpen) return;
                          try {
                            await openInstaller(downloadedPath);
                          } catch (e) {
                            setOpenError(String(e));
                          }
                        }}
                        className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                      >
                        <Download className="size-3.5" />
                        重新打开安装包
                      </button>
                      {openError && (
                        <p className="text-xs text-destructive">
                          打开失败：{openError.length > 80
                            ? openError.slice(0, 80) + "…"
                            : openError}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Fallback: open release page in browser */}
                  {!updateInfo.recommendedAsset && updateInfo.downloadUrl && (
                    <button
                      type="button"
                      onClick={() => openUrl(updateInfo.downloadUrl!)}
                      className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <Download className="size-3.5" />
                      前往下载页
                    </button>
                  )}

                  {/* Secondary link to release page even when in-app download is available */}
                  {updateInfo.recommendedAsset && updateInfo.downloadUrl && (
                    <button
                      type="button"
                      onClick={() => openUrl(updateInfo.downloadUrl!)}
                      className="mt-2 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      或在浏览器中打开发布页
                    </button>
                  )}
                </div>
              )}

            {updateInfo && updateInfo.latestVersion &&
              updateInfo.latestVersion === updateInfo.currentVersion && (
                <p className="text-xs text-muted-foreground">
                  已是最新版本
                </p>
              )}
          </Section>
        </div>
      </div>
    </div>
  );

  if (inline) return panel;

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-black/50 p-4"
      onClick={onClose}
    >
      {panel}
    </div>
  );
}
