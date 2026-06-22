// Cloudflare Worker demo parser using demoparser2 (Rust -> WASM).
// This module parses CS2 .dem files into a JSON report and stores it in R2/KV.

import "./demoparser-polyfill.js";
import wasm_bindgen, { parseEvent, parseEvents, parseTicks, parseHeader } from "demoparser2";
import wasmModule from "../node_modules/demoparser2/demoparser2_bg.wasm";
import {
  computePlayerStats,
  computeDerivedStats,
  computeRating2,
  computeRating3,
  getEquipmentValue,
} from "./stats.js";

let initialized = false;

async function ensureInit() {
  if (initialized) return;
  await wasm_bindgen(wasmModule);
  initialized = true;
}

const DEMO_MAGIC = [0x48, 0x4c, 0x32, 0x44, 0x45, 0x4d, 0x4f]; // "HL2DEMO"

function isValidDemoHeader(bytes) {
  if (bytes.length < DEMO_MAGIC.length) return false;
  for (let i = 0; i < DEMO_MAGIC.length; i++) {
    if (bytes[i] !== DEMO_MAGIC[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Event / tick parsing
// ---------------------------------------------------------------------------

const EVENTS_TO_PARSE = [
  "player_death",
  "player_hurt",
  "round_start",
  "round_freeze_end",
  "round_end",
  "bomb_planted",
  "bomb_defused",
  "bomb_exploded",
  "player_blind",
  "weapon_fire",
  "item_pickup",
  "player_spawn",
];

const TICK_PROPS = [
  "player_name",
  "player_steamid",
  "team_num",
  "is_alive",
  "active_weapon_name",
  "inventory",
  "armor_value",
  "has_helmet",
  "has_defuser",
  "balance",
  "cash_spent_this_round",
  "equipment_value_this_round",
  "total_cash_spent",
  "num_player_alive_ct",
  "num_player_alive_t",
  "is_bomb_planted",
  "total_rounds_played",
];

function parseAllEvents(bytes) {
  const parsed = parseEvents(bytes, EVENTS_TO_PARSE) ?? {};
  const events = {};
  for (const name of EVENTS_TO_PARSE) {
    events[name] = Array.isArray(parsed[name]) ? parsed[name] : (parseEvent(bytes, name) ?? []);
  }
  return events;
}

function getRoundFreezeTicks(freezeEndEvents) {
  return freezeEndEvents.map((e) => e.tick ?? 0).filter((t) => t > 0);
}

function parseFreezeSnapshots(bytes, freezeEndEvents) {
  const ticks = getRoundFreezeTicks(freezeEndEvents);
  if (ticks.length === 0) return [];
  const wantedTicks = new Int32Array(ticks);
  try {
    const data = parseTicks(bytes, TICK_PROPS, wantedTicks, false);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("parseTicks failed:", e);
    return [];
  }
}

function buildFreezeSnapshotMap(snapshots, freezeEndEvents) {
  const byTick = new Map();
  for (const s of snapshots) {
    const tick = s.tick;
    if (!tick) continue;
    if (!byTick.has(tick)) byTick.set(tick, new Map());
    const name = s.player_name;
    if (name) byTick.get(tick).set(name, s);
  }

  const map = new Map();
  for (const evt of freezeEndEvents) {
    const round = evt.round ?? 0;
    const tick = evt.tick ?? 0;
    let snapshot = byTick.get(tick);
    if (!snapshot && tick > 0) {
      const ticks = Array.from(byTick.keys()).sort((a, b) => a - b);
      const nearest = ticks.find((t) => t >= tick) ?? ticks.findLast((t) => t < tick);
      if (nearest) snapshot = byTick.get(nearest);
    }
    if (snapshot) map.set(round, snapshot);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Round context
// ---------------------------------------------------------------------------

function buildRounds(events) {
  const roundEnds = events.round_end ?? [];
  const roundStarts = events.round_start ?? [];
  const freezeEnds = events.round_freeze_end ?? [];

  const rounds = roundEnds.map((r, idx) => ({
    round: r.round ?? idx + 1,
    winner: r.winner === 2 ? "ct" : r.winner === 3 ? "t" : "unknown",
    reason: r.reason ?? "unknown",
    scoreCt: r.ct_score ?? 0,
    scoreT: r.t_score ?? 0,
    tick: r.tick ?? 0,
    startTick: roundStarts[idx]?.tick ?? 0,
    freezeEndTick: freezeEnds[idx]?.tick ?? 0,
    aliveCt: [],
    aliveT: [],
    bombPlanted: false,
    plantTick: null,
    defuseTick: null,
  }));

  const byRound = new Map(rounds.map((r) => [r.round, r]));

  for (const e of events.bomb_planted ?? []) {
    const r = byRound.get(e.round ?? 0);
    if (r) {
      r.bombPlanted = true;
      r.plantTick = e.tick ?? null;
    }
  }
  for (const e of events.bomb_defused ?? []) {
    const r = byRound.get(e.round ?? 0);
    if (r) r.defuseTick = e.tick ?? null;
  }

  return rounds;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/**
 * Parse a CS2 demo byte array into a structured report object.
 * @param {Uint8Array} bytes
 * @returns {object}
 */
export async function parseDemoToReport(bytes) {
  if (!isValidDemoHeader(bytes)) {
    throw new Error("invalid .dem file: missing HL2DEMO magic bytes");
  }

  await ensureInit();

  const header = parseHeader(bytes);
  const mapName = header?.map_name ?? "unknown";
  const tickRate = 64; // CS2 default

  const events = parseAllEvents(bytes);
  const rounds = buildRounds(events);
  const freezeSnapshots = buildFreezeSnapshotMap(
    parseFreezeSnapshots(bytes, events.round_freeze_end ?? []),
    events.round_freeze_end ?? []
  );

  const playerStats = computePlayerStats(events, rounds, freezeSnapshots);

  const deaths = events.player_death ?? [];
  const killFeed = [];
  const maxKillFeed = 200;
  for (const d of deaths) {
    if (killFeed.length >= maxKillFeed) break;
    killFeed.push({
      tick: d.tick ?? 0,
      round: d.round ?? 0,
      attacker: d.attacker_name ?? null,
      victim: d.user_name ?? null,
      weapon: d.weapon ?? null,
      headshot: !!d.headshot,
      attackerPos: d.attacker_x != null ? { x: d.attacker_x, y: d.attacker_y, z: d.attacker_z } : null,
      victimPos: d.user_x != null ? { x: d.user_x, y: d.user_y, z: d.user_z } : null,
    });
  }

  const players = [];
  for (const p of playerStats.values()) {
    const derived = computeDerivedStats(p);
    const r2 = computeRating2(derived);
    const r3 = computeRating3(derived);
    players.push({
      name: p.name,
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      headshots: p.headshots,
      damage: p.damage,
      damageTaken: p.damageTaken,
      roundsPlayed: p.roundsPlayed,
      kastRounds: p.kastRounds.size,
      kast: Number(derived.kast.toFixed(3)),
      adr: Number(derived.adr.toFixed(2)),
      kpr: Number(derived.kpr.toFixed(3)),
      dpr: Number(derived.dpr.toFixed(3)),
      apr: Number(derived.apr.toFixed(3)),
      hsp: Number(derived.hsp.toFixed(3)),
      openingKills: p.openingKills,
      openingDeaths: p.openingDeaths,
      tradeKills: p.tradeKills,
      tradedDeaths: p.tradedDeaths,
      multiKillRounds: p.multiKillRounds,
      flashAssists: p.flashAssists,
      clutchWins: p.clutchWins,
      rating2: Number(r2.rating.toFixed(3)),
      impact: Number(r2.impact.toFixed(3)),
      rating3: Number(r3.rating.toFixed(3)),
      subRatings: {
        kills: Number(r3.subRatings.kills.toFixed(3)),
        damage: Number(r3.subRatings.damage.toFixed(3)),
        survival: Number(r3.subRatings.survival.toFixed(3)),
        kast: Number(r3.subRatings.kast.toFixed(3)),
        multiKills: Number(r3.subRatings.multiKills.toFixed(3)),
        roundSwing: Number(r3.subRatings.roundSwing.toFixed(3)),
      },
    });
  }

  players.sort((a, b) => b.kills - a.kills);

  return {
    header: {
      map: mapName,
      tickCount: header?.tick_count ?? 0,
      tickRate,
      durationSeconds: (header?.tick_count ?? 0) / tickRate,
      demoVersion: header?.demo_version ?? null,
    },
    finalScore: { ct: rounds[rounds.length - 1]?.scoreCt ?? 0, t: rounds[rounds.length - 1]?.scoreT ?? 0 },
    totalRounds: rounds.length,
    players,
    rounds: rounds.map((r) => ({
      round: r.round,
      winner: r.winner,
      reason: r.reason,
      scoreCt: r.scoreCt,
      scoreT: r.scoreT,
      tick: r.tick,
      bombPlanted: r.bombPlanted,
    })),
    killFeed,
    generatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Storage helpers (unchanged)
// ---------------------------------------------------------------------------

/**
 * Store a report in R2 (preferred) or KV (fallback) and its metadata in KV.
 * @param {object} report
 * @param {object} env
 * @returns {Promise<{reportId: string, url: string}>}
 */
export async function storeReport(report, env) {
  const reportId = crypto.randomUUID();
  const reportJson = JSON.stringify(report);

  if (env.DEMO_REPORTS) {
    await env.DEMO_REPORTS.put(`reports/${reportId}.json`, reportJson, {
      httpMetadata: { contentType: "application/json" },
    });
  } else if (env.DEMO_META) {
    // Fallback when R2 is not enabled: store the full report JSON in KV.
    // KV value size limit is 25MB; this works for MVP reports.
    await env.DEMO_META.put(`report:${reportId}`, reportJson);
  } else {
    throw new Error("no report storage binding configured (DEMO_REPORTS or DEMO_META)");
  }

  const meta = {
    reportId,
    map: report.header.map,
    scoreCt: report.finalScore.ct,
    scoreT: report.finalScore.t,
    durationSeconds: report.header.durationSeconds,
    generatedAt: report.generatedAt,
  };

  if (env.DEMO_META) {
    await env.DEMO_META.put(`demo:${reportId}`, JSON.stringify(meta));
  }

  const origin = env.DEMO_REPORTS?.publicUrl
    ? new URL(env.DEMO_REPORTS.publicUrl).origin
    : "https://csspeak-market.xrntkk.top";
  const url = `${origin}/demo/report/${reportId}`;
  return { reportId, url };
}

/**
 * Load a report by ID.
 * @param {string} reportId
 * @param {object} env
 * @returns {Promise<object | null>}
 */
export async function loadReport(reportId, env) {
  if (env.DEMO_REPORTS) {
    const obj = await env.DEMO_REPORTS.get(`reports/${reportId}.json`);
    if (!obj) return null;
    return await obj.json();
  }
  if (env.DEMO_META) {
    const json = await env.DEMO_META.get(`report:${reportId}`);
    if (!json) return null;
    return JSON.parse(json);
  }
  return null;
}

/**
 * Load report metadata by ID.
 * @param {string} reportId
 * @param {object} env
 * @returns {Promise<object | null>}
 */
export async function loadReportMeta(reportId, env) {
  if (!env.DEMO_META) return null;
  const meta = await env.DEMO_META.get(`demo:${reportId}`);
  if (!meta) return null;
  return JSON.parse(meta);
}

// ---------------------------------------------------------------------------
// Multipart upload helpers (unchanged)
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per part

export function getChunkSize() {
  return CHUNK_SIZE;
}

/**
 * Start a multipart upload for a demo file.
 * @param {object} env
 * @returns {Promise<{uploadId: string, key: string}>}
 */
export async function startMultipartUpload(env) {
  if (!env.DEMO_REPORTS) {
    throw new Error("R2 bucket DEMO_REPORTS is not configured");
  }
  const key = `uploads/${crypto.randomUUID()}.dem`;
  const multipart = await env.DEMO_REPORTS.createMultipartUpload(key);
  return { uploadId: multipart.uploadId, key };
}

/**
 * Upload one part of a multipart upload.
 * @param {object} env
 * @param {string} key
 * @param {string} uploadId
 * @param {number} partNumber
 * @param {Uint8Array} bytes
 * @returns {Promise<{partNumber: number, etag: string}>}
 */
export async function uploadPart(env, key, uploadId, partNumber, bytes) {
  if (!env.DEMO_REPORTS) {
    throw new Error("R2 bucket DEMO_REPORTS is not configured");
  }
  const multipart = env.DEMO_REPORTS.resumeMultipartUpload(key, uploadId);
  const part = await multipart.uploadPart(partNumber, bytes);
  return { partNumber, etag: part.etag };
}

/**
 * Complete a multipart upload, parse the demo, store the report, and delete the raw demo.
 * @param {object} env
 * @param {string} key
 * @param {string} uploadId
 * @param {Array<{partNumber: number, etag: string}>} parts
 * @returns {Promise<{reportId: string, url: string, summary: object}>}
 */
export async function completeMultipartUpload(env, key, uploadId, parts) {
  if (!env.DEMO_REPORTS) {
    throw new Error("R2 bucket DEMO_REPORTS is not configured");
  }

  // Sort parts by partNumber and complete the multipart upload.
  const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const multipart = env.DEMO_REPORTS.resumeMultipartUpload(key, uploadId);
  await multipart.complete(sortedParts);

  // Read the assembled demo into memory and parse it.
  const obj = await env.DEMO_REPORTS.get(key);
  if (!obj) {
    throw new Error("completed demo object not found in R2");
  }
  const bytes = await obj.bytes();

  try {
    const report = await parseDemoToReport(bytes);
    const { reportId, url } = await storeReport(report, env);
    return {
      reportId,
      url,
      summary: {
        map: report.header.map,
        scoreCt: report.finalScore.ct,
        scoreT: report.finalScore.t,
        durationSeconds: report.header.durationSeconds,
        totalRounds: report.totalRounds,
      },
    };
  } finally {
    // Clean up the raw demo object after parsing.
    await env.DEMO_REPORTS.delete(key).catch(() => {});
  }
}
