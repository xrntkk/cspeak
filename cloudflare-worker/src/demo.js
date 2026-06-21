// Cloudflare Worker demo parser using demoparser2 (Rust -> WASM).
// This module parses CS2 .dem files into a JSON report and stores it in R2/KV.

import "./demoparser-polyfill.js";
import wasm_bindgen, { parseEvent, parseHeader } from "demoparser2";
import wasmModule from "../node_modules/demoparser2/demoparser2_bg.wasm";

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
  const tickRate = 64; // CS2 default, can be read from server info if needed

  // Events we care about for the MVP report.
  const roundEnds = parseEvent(bytes, "round_end") ?? [];
  const deaths = parseEvent(bytes, "player_death") ?? [];

  // Final score from the last round_end event.
  const finalRound = roundEnds[roundEnds.length - 1];
  const scoreCt = finalRound?.ct_score ?? 0;
  const scoreT = finalRound?.t_score ?? 0;

  // Build player stats from player_death events.
  const playerStats = new Map();

  function ensurePlayer(name, teamHint) {
    if (!playerStats.has(name)) {
      playerStats.set(name, {
        name,
        team: teamHint ?? null,
        kills: 0,
        deaths: 0,
        assists: 0,
        headshots: 0,
      });
    }
    return playerStats.get(name);
  }

  const killFeed = [];
  const maxKillFeed = 200;

  for (const d of deaths) {
    const roundNum = d.round ?? 0;
    const attackerName = d.attacker_name;
    const victimName = d.user_name;
    const assisterName = d.assister_name;

    if (attackerName) {
      const attacker = ensurePlayer(attackerName, d.attacker_team);
      attacker.kills += 1;
      attacker.team = d.attacker_team ?? attacker.team;
      if (d.headshot) attacker.headshots += 1;
    }

    if (victimName) {
      const victim = ensurePlayer(victimName, d.user_team);
      victim.deaths += 1;
      victim.team = d.user_team ?? victim.team;
    }

    if (assisterName) {
      const assister = ensurePlayer(assisterName, d.assister_team);
      assister.assists += 1;
      assister.team = d.assister_team ?? assister.team;
    }

    if (killFeed.length < maxKillFeed) {
      killFeed.push({
        tick: d.tick ?? 0,
        round: roundNum,
        attacker: attackerName ?? null,
        victim: victimName ?? null,
        weapon: d.weapon ?? null,
        headshot: !!d.headshot,
        attackerPos: d.attacker_x != null ? { x: d.attacker_x, y: d.attacker_y, z: d.attacker_z } : null,
        victimPos: d.user_x != null ? { x: d.user_x, y: d.user_y, z: d.user_z } : null,
      });
    }
  }

  // Round summary.
  const rounds = roundEnds.map((r, idx) => ({
    round: idx + 1,
    winner: r.winner === 2 ? "ct" : r.winner === 3 ? "t" : "unknown",
    reason: r.reason ?? "unknown",
    scoreCt: r.ct_score ?? 0,
    scoreT: r.t_score ?? 0,
    tick: r.tick ?? 0,
  }));

  return {
    header: {
      map: mapName,
      tickCount: header?.tick_count ?? 0,
      tickRate,
      durationSeconds: (header?.tick_count ?? 0) / tickRate,
      demoVersion: header?.demo_version ?? null,
    },
    finalScore: { ct: scoreCt, t: scoreT },
    totalRounds: roundEnds.length,
    players: Array.from(playerStats.values()).sort((a, b) => b.kills - a.kills),
    rounds,
    killFeed,
    generatedAt: Date.now(),
  };
}

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
// Multipart upload helpers for large .dem files.
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
