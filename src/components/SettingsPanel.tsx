import { useEffect, useState } from "react";
import {
  ArrowUpRight,
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
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import {
  checkUpdate,
  listDevices,
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
}: {
  settings: AudioSettings;
  onChange: (next: AudioSettings) => void;
  onClose: () => void;
}) {
  const [inputs, setInputs] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [capturingKey, setCapturingKey] = useState(false);
  const [privKey, setPrivKey] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const doCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const info = await checkUpdate();
      setUpdateInfo(info);
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    listDevices().then(([ins, outs]) => {
      setInputs(ins);
      setOutputs(outs);
    });
  }, []);

  const patch = (p: Partial<AudioSettings>) => onChange({ ...settings, ...p });

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-[28rem] max-w-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SettingsIcon className="size-4 text-muted-foreground" />
          <span className="font-semibold">设置</span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

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
                  <button
                    type="button"
                    onClick={() => {
                      if (updateInfo.downloadUrl) openUrl(updateInfo.downloadUrl);
                    }}
                    className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Download className="size-3.5" />
                    前往下载
                  </button>
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
}
