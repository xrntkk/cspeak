export interface MapData {
  pos_x: number;
  pos_y: number;
  scale: number;
  rotate?: number | null;
  zoom?: number | null;
  z_cutoff?: number;
  lower_level_max_units?: number;
}

let mapDataCache: Record<string, MapData> | null = null;

export async function loadMapData(): Promise<Record<string, MapData>> {
  if (mapDataCache) return mapDataCache;
  const resp = await fetch("/maps/map_data.json");
  if (!resp.ok) throw new Error("failed to load map data");
  mapDataCache = (await resp.json()) as Record<string, MapData>;
  return mapDataCache;
}

export function getMapImageUrl(mapName: string): string {
  return `/maps/${mapName}.png`;
}

export function worldToMapPixel(
  mapName: string,
  worldX: number,
  worldY: number,
  worldZ?: number,
  mapData?: Record<string, MapData>,
): { x: number; y: number } | null {
  const data = mapData?.[mapName];
  if (!data) return null;

  let pixelX = (worldX - data.pos_x) / data.scale;
  let pixelY = (data.pos_y - worldY) / data.scale;

  if (data.z_cutoff != null && worldZ != null && worldZ < data.z_cutoff) {
    pixelY += 1024;
  }

  return { x: pixelX, y: pixelY };
}

export interface DemoReport {
  header: {
    map: string;
    tickCount: number;
    tickRate: number;
    durationSeconds: number;
    demoVersion: string | null;
  };
  finalScore: { ct: number; t: number };
  totalRounds: number;
  players: Array<{
    name: string;
    team: string | null;
    kills: number;
    deaths: number;
    assists: number;
    headshots: number;
  }>;
  rounds: Array<{
    round: number;
    winner: string;
    reason: string;
    scoreCt: number;
    scoreT: number;
    tick: number;
  }>;
  killFeed: Array<{
    tick: number;
    round: number;
    attacker: string | null;
    victim: string | null;
    weapon: string | null;
    headshot: boolean;
    attackerPos: { x: number; y: number; z: number } | null;
    victimPos: { x: number; y: number; z: number } | null;
  }>;
  generatedAt: number;
}

export async function loadDemoReport(url: string): Promise<DemoReport> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`failed to load report: ${resp.status}`);
  return (await resp.json()) as DemoReport;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function teamName(team: string | null): string {
  if (team === "ct") return "CT";
  if (team === "t") return "T";
  return team ?? "未知";
}
