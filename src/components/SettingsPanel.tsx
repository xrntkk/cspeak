import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  listDevices,
  setApmEnabled,
  setDenoiseMode,
  setInputDevice,
  setMicGain,
  setOutputDevice,
  setPttEnabled,
  setSensitivity,
  setSpkGain,
  usePrivilegeKey,
  type DenoiseMode,
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
  /// WebRTC echo cancellation + auto gain (AEC/AGC master switch).
  apmEnabled: boolean;
  /// Noise suppression stage: off / webrtc / deepfilter.
  denoiseMode: DenoiseMode;
  /// Whether to show admin actions (kick) in the user menu. Set automatically
  /// after applying a privilege key; can also be toggled manually.
  adminMode: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const selectCls =
  "rounded-md border border-border bg-background px-2 py-1.5 text-sm";

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

  useEffect(() => {
    listDevices().then(([ins, outs]) => {
      setInputs(ins);
      setOutputs(outs);
    });
  }, []);

  const patch = (p: Partial<AudioSettings>) => onChange({ ...settings, ...p });

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
      <div className="w-[28rem] rounded-lg border border-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">音频设置</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
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
                <option key={d} value={d}>{d}</option>
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
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </Row>

          <Row label={`麦克风音量 ${Math.round(settings.micGain * 100)}%`}>
            <input
              type="range"
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

          <Row label={`麦克风灵敏度阈值 ${settings.sensitivity.toFixed(3)}(0=常开)`}>
            <input
              type="range"
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

          <div className="border-t border-border pt-4">
            <label className="flex items-center justify-between">
              <span className="text-sm">回声消除 / 自动增益(AEC/AGC)</span>
              <input
                type="checkbox"
                checked={settings.apmEnabled}
                onChange={(e) => {
                  patch({ apmEnabled: e.target.checked });
                  setApmEnabled(e.target.checked);
                }}
              />
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              WebRTC 处理:消除扬声器回声并自动调平音量。外放时建议开启。
            </p>
          </div>

          <Row label="降噪">
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
                  className={`flex-1 rounded-md border px-2 py-1.5 text-sm ${
                    settings.denoiseMode === mode
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              AI 降噪(DeepFilterNet)对键盘、风扇、人声背景等噪声抑制更强,质量优于官方。
            </p>
          </Row>

          <div className="border-t border-border pt-4">
            <label className="flex items-center justify-between">
              <span className="text-sm">进出频道音效</span>
              <input
                type="checkbox"
                checked={settings.sfxEnabled}
                onChange={(e) => patch({ sfxEnabled: e.target.checked })}
              />
            </label>
          </div>

          <div className="border-t border-border pt-4">
            <Row label="权限密钥(Privilege Key)">
              <div className="flex gap-2">
                <input
                  value={privKey}
                  onChange={(e) => setPrivKey(e.target.value)}
                  placeholder="粘贴管理员发的 token"
                  className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                />
                <button
                  type="button"
                  disabled={!privKey.trim()}
                  onClick={() => {
                    usePrivilegeKey(privKey.trim());
                    patch({ adminMode: true });
                    setPrivKey("");
                  }}
                  className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  应用
                </button>
              </div>
            </Row>
            <label className="mt-2 flex items-center justify-between">
              <span className="text-sm">显示管理操作(踢人)</span>
              <input
                type="checkbox"
                checked={settings.adminMode}
                onChange={(e) => patch({ adminMode: e.target.checked })}
              />
            </label>
          </div>

          <div className="border-t border-border pt-4">
            <label className="flex items-center justify-between">
              <span className="text-sm">按键说话(PTT)</span>
              <input
                type="checkbox"
                checked={settings.pttEnabled}
                onChange={(e) => {
                  patch({ pttEnabled: e.target.checked });
                  setPttEnabled(e.target.checked);
                }}
              />
            </label>
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
                className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm hover:bg-accent"
              >
                {capturingKey ? "按下一个键…" : `热键:${settings.pttKey || "未设置"}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
