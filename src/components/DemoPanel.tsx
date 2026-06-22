import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  DemoReport,
  formatDuration,
  getMapImageUrl,
  loadDemoReport,
  loadMapData,
  MapData,
  teamName,
  worldToMapPixel,
} from "@/lib/demo";
import { BarChart3, Crosshair, Skull, Target, Users, Zap, TrendingUp } from "lucide-react";

type Tab = "overview" | "scoreboard" | "rounds" | "heatmap";

export function DemoPanel({ reportUrl }: { reportUrl: string }) {
  const [report, setReport] = useState<DemoReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  useEffect(() => {
    setReport(null);
    setError(null);
    loadDemoReport(reportUrl)
      .then(setReport)
      .catch((e) => setError(e.message));
  }, [reportUrl]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        加载复盘失败：{error}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        加载复盘中…
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "总览" },
    { key: "scoreboard", label: "比分板" },
    { key: "rounds", label: "回合" },
    { key: "heatmap", label: "热力图" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-5 text-primary" />
          <span className="text-lg font-semibold">{report.header.map}</span>
          <span className="ml-2 text-sm text-muted-foreground">
            CT {report.finalScore.ct} : {report.finalScore.t} T
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          时长 {formatDuration(report.header.durationSeconds)} · {report.totalRounds} 回合 · {report.killFeed.length} 次击杀
        </div>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-border px-4 pt-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "border-b-2 px-3 py-1.5 text-sm transition-colors",
              activeTab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "overview" && <Overview report={report} />}
        {activeTab === "scoreboard" && <Scoreboard report={report} />}
        {activeTab === "rounds" && <Rounds report={report} />}
        {activeTab === "heatmap" && <Heatmap report={report} />}
      </div>
    </div>
  );
}

function Overview({ report }: { report: DemoReport }) {
  const totalKills = report.killFeed.length;
  const headshots = report.killFeed.filter((k) => k.headshot).length;
  const topKiller = report.players[0];
  const topRated = report.players.reduce((a, b) => (b.rating2 > a.rating2 ? b : a), report.players[0]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard icon={Crosshair} label="总击杀" value={String(totalKills)} />
      <StatCard icon={Target} label="爆头率" value={`${Math.round((headshots / Math.max(totalKills, 1)) * 100)}%`} />
      <StatCard icon={Users} label="玩家数" value={String(report.players.length)} />
      <StatCard
        icon={Skull}
        label="最高击杀"
        value={topKiller ? `${topKiller.name} (${topKiller.kills})` : "-"}
      />
      <StatCard icon={Zap} label="最高 Rating 2.0" value={topRated ? `${topRated.name} (${topRated.rating2.toFixed(2)})` : "-"} />
      <StatCard icon={TrendingUp} label="最高 Rating 3.0" value={topRated ? `${topRated.name} (${topRated.rating3.toFixed(2)})` : "-"} />
      <StatCard icon={Target} label="平均 Rating 2.0" value={report.players.length ? (report.players.reduce((s, p) => s + p.rating2, 0) / report.players.length).toFixed(2) : "-"} />
      <StatCard icon={TrendingUp} label="平均 Rating 3.0" value={report.players.length ? (report.players.reduce((s, p) => s + p.rating3, 0) / report.players.length).toFixed(2) : "-"} />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Scoreboard({ report }: { report: DemoReport }) {
  return (
    <div className="rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2">玩家</th>
            <th className="px-3 py-2">阵营</th>
            <th className="px-3 py-2 text-right">K</th>
            <th className="px-3 py-2 text-right">D</th>
            <th className="px-3 py-2 text-right">A</th>
            <th className="px-3 py-2 text-right">ADR</th>
            <th className="px-3 py-2 text-right">KAST</th>
            <th className="px-3 py-2 text-right">Rating 2.0</th>
            <th className="px-3 py-2 text-right">Rating 3.0</th>
            <th className="px-3 py-2 text-right">K/D</th>
          </tr>
        </thead>
        <tbody>
          {report.players.map((p) => (
            <tr key={p.name} className="border-b border-border last:border-0 hover:bg-accent/50">
              <td className="px-3 py-2 font-medium">{p.name}</td>
              <td className="px-3 py-2">{teamName(p.team)}</td>
              <td className="px-3 py-2 text-right">{p.kills}</td>
              <td className="px-3 py-2 text-right">{p.deaths}</td>
              <td className="px-3 py-2 text-right">{p.assists}</td>
              <td className="px-3 py-2 text-right">{p.adr}</td>
              <td className="px-3 py-2 text-right">{Math.round(p.kast * 100)}%</td>
              <td className="px-3 py-2 text-right">{p.rating2.toFixed(2)}</td>
              <td
                className="px-3 py-2 text-right font-medium"
                title={`Rating 3.0 近似子评分：Kills ${p.subRatings.kills.toFixed(2)}, Damage ${p.subRatings.damage.toFixed(2)}, Survival ${p.subRatings.survival.toFixed(2)}, KAST ${p.subRatings.kast.toFixed(2)}, Multi-Kills ${p.subRatings.multiKills.toFixed(2)}, Round Swing ${p.subRatings.roundSwing.toFixed(2)}`}
              >
                {p.rating3.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right">
                {(p.deaths > 0 ? p.kills / p.deaths : p.kills).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rounds({ report }: { report: DemoReport }) {
  return (
    <div className="space-y-2">
      {report.rounds.map((r) => (
        <div
          key={r.round}
          className={cn(
            "flex items-center justify-between rounded-md border border-border px-4 py-2 text-sm",
            r.winner === "ct" ? "bg-blue-500/5" : r.winner === "t" ? "bg-yellow-500/5" : "",
          )}
        >
          <div className="flex items-center gap-3">
            <span className="w-8 text-xs text-muted-foreground">第{r.round}回合</span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-xs font-medium",
                r.winner === "ct"
                  ? "bg-blue-500/10 text-blue-600"
                  : r.winner === "t"
                    ? "bg-yellow-500/10 text-yellow-600"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {r.winner === "ct" ? "CT 胜" : r.winner === "t" ? "T 胜" : "未知"}
            </span>
            <span className="text-xs text-muted-foreground">{r.reason}</span>
          </div>
          <div className="text-sm font-medium">
            {r.scoreCt} : {r.scoreT}
          </div>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ report }: { report: DemoReport }) {
  const [mapData, setMapData] = useState<Record<string, MapData> | null>(null);
  const [filter, setFilter] = useState<"all" | "kills" | "deaths">("all");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadMapData().then(setMapData).catch(() => setMapData({}));
  }, []);

  const points = useMemo(() => {
    const data = mapData;
    if (!data) return [];
    const pts: { x: number; y: number; type: "kill" | "death" }[] = [];
    for (const k of report.killFeed) {
      if ((filter === "all" || filter === "kills") && k.attackerPos) {
        const pos = worldToMapPixel(report.header.map, k.attackerPos.x, k.attackerPos.y, k.attackerPos.z, data);
        if (pos) pts.push({ ...pos, type: "kill" });
      }
      if ((filter === "all" || filter === "deaths") && k.victimPos) {
        const pos = worldToMapPixel(report.header.map, k.victimPos.x, k.victimPos.y, k.victimPos.z, data);
        if (pos) pts.push({ ...pos, type: "death" });
      }
    }
    return pts;
  }, [report, mapData, filter]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mapName = report.header.map;
    const img = new Image();
    img.src = getMapImageUrl(mapName);
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = p.type === "kill" ? "rgba(239, 68, 68, 0.7)" : "rgba(59, 130, 246, 0.7)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
  }, [report, mapData, points]);

  if (mapData === null) {
    return <div className="text-sm text-muted-foreground">加载地图数据中…</div>;
  }

  if (!mapData[report.header.map]) {
    return (
      <div className="text-sm text-destructive">
        暂不支持地图 {report.header.map} 的热力图（缺少地图数据或图片）。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {[
          { key: "all", label: "全部" },
          { key: "kills", label: "击杀位置" },
          { key: "deaths", label: "死亡位置" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as typeof filter)}
            className={cn(
              "rounded-md border px-3 py-1 text-xs transition-colors",
              filter === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-accent",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="overflow-auto rounded-md border border-border bg-black/5 p-2 dark:bg-white/5">
        <canvas ref={canvasRef} className="max-w-none" />
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-red-500" /> 击杀
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-blue-500" /> 死亡
        </div>
      </div>
    </div>
  );
}
