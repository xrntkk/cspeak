// Pure stats computation helpers for CS2 demo reports.
// No demoparser2 dependency — operates on already-extracted event arrays.

import { predictRating3 } from "./rating3_model.js";

export const WEAPON_TIERS = {
  // Sniper
  awp: "sniper",
  ssg08: "sniper",
  scar20: "sniper",
  g3sg1: "sniper",
  // Tier-one rifles
  ak47: "t1_rifle",
  m4a1: "t1_rifle",
  m4a1_silencer: "t1_rifle",
  m4a4: "t1_rifle",
  // Tier-two rifles
  famas: "t2_rifle",
  galilar: "t2_rifle",
  aug: "t2_rifle",
  sg556: "t2_rifle",
  // SMG / shotgun
  mp9: "smg_shotgun",
  mac10: "smg_shotgun",
  mp7: "smg_shotgun",
  mp5sd: "smg_shotgun",
  ump45: "smg_shotgun",
  p90: "smg_shotgun",
  bizon: "smg_shotgun",
  xm1014: "smg_shotgun",
  mag7: "smg_shotgun",
  nova: "smg_shotgun",
  sawedoff: "smg_shotgun",
  // Upgraded pistols
  deagle: "pistol_upgraded",
  tec9: "pistol_upgraded",
  fiveseven: "pistol_upgraded",
  cz75a: "pistol_upgraded",
  p250: "pistol_upgraded",
  revolver: "pistol_upgraded",
  // Starter pistols
  glock: "pistol_starter",
  hkp2000: "pistol_starter",
  usp_silencer: "pistol_starter",
};

export const WEAPON_PRICES = {
  awp: 4750,
  ssg08: 1700,
  scar20: 5000,
  g3sg1: 5000,
  ak47: 2700,
  m4a1: 2900,
  m4a1_silencer: 2900,
  m4a4: 3100,
  famas: 2050,
  galilar: 1800,
  aug: 3300,
  sg556: 3000,
  mp9: 1250,
  mac10: 1050,
  mp7: 1500,
  mp5sd: 1500,
  ump45: 1200,
  p90: 2350,
  bizon: 1400,
  xm1014: 2000,
  mag7: 1300,
  nova: 1050,
  sawedoff: 1100,
  deagle: 700,
  tec9: 500,
  fiveseven: 500,
  cz75a: 500,
  p250: 300,
  revolver: 600,
  glock: 200,
  hkp2000: 200,
  usp_silencer: 200,
};

function normalizeWeaponName(name) {
  if (!name) return null;
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+$/, "");
}

export function getWeaponTier(name) {
  return WEAPON_TIERS[normalizeWeaponName(name)] || "unknown";
}

export function getWeaponPrice(name) {
  return WEAPON_PRICES[normalizeWeaponName(name)] ?? 0;
}

export function getEquipmentValue(snapshot) {
  if (!snapshot) return 0;
  const armor = (snapshot.armor_value ?? 0) * 6.5; // kevlar ~650, no per-piece price exposed
  const helmet = snapshot.has_helmet ? 1000 : 0;
  const activeWeapon = snapshot.active_weapon_name;
  const inventory = Array.isArray(snapshot.inventory) ? snapshot.inventory : [];
  const mostExpensive = [activeWeapon, ...inventory]
    .filter(Boolean)
    .map(getWeaponPrice)
    .reduce((a, b) => Math.max(a, b), 0);
  return armor + helmet + mostExpensive;
}

const TRADE_WINDOW_MS = 5000;
const TICK_RATE = 64;
const TRADE_WINDOW_TICKS = (TRADE_WINDOW_MS / 1000) * TICK_RATE;

function ensurePlayer(stats, name, teamHint) {
  if (!stats.has(name)) {
    stats.set(name, {
      name,
      team: teamHint ?? null,
      kills: 0,
      deaths: 0,
      assists: 0,
      headshots: 0,
      damage: 0,
      damageTaken: 0,
      kastRounds: new Set(),
      roundsPlayed: 0,
      openingKills: 0,
      openingDeaths: 0,
      tradeKills: 0,
      tradedDeaths: 0,
      multiKillRounds: [0, 0, 0, 0, 0, 0], // index = kills count
      flashAssists: 0,
      clutchWins: [0, 0, 0, 0, 0, 0],
      clutchAttempts: [0, 0, 0, 0, 0, 0],
      saves: 0,
      killTicks: [],
      deathTicks: [],
      equipmentValueSpent: 0,
    });
  }
  return stats.get(name);
}

function isTradeKill(attacker, victimName, killTick, playerStats) {
  const victim = playerStats.get(victimName);
  const victimTeam = victim?.team;
  // Only count trade when killing an enemy after a teammate died.
  if (victimTeam && victimTeam === attacker.team) return false;
  for (const [name, p] of playerStats) {
    if (name === attacker.name || p.team !== attacker.team) continue;
    for (const death of p.deathTicks) {
      if (death.tick < killTick && killTick - death.tick <= TRADE_WINDOW_TICKS) {
        return true;
      }
    }
  }
  return false;
}

function isTradedDeath(victim, deathTick, playerStats) {
  for (const [name, p] of playerStats) {
    if (name === victim.name || p.team !== victim.team) continue;
    for (const kill of p.killTicks) {
      if (kill.tick > deathTick && kill.tick - deathTick <= TRADE_WINDOW_TICKS) {
        return true;
      }
    }
  }
  return false;
}

export function computePlayerStats(events, rounds, freezeSnapshots) {
  const playerStats = new Map();
  const deaths = (events.player_death ?? []).slice().sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
  const hurts = events.player_hurt ?? [];
  const blinds = events.player_blind ?? [];
  const spawns = events.player_spawn ?? [];

  const roundByNum = new Map(rounds.map((r) => [r.round, r]));

  const killsPerRound = new Map();
  const firstDeathPerRound = new Map();
  const recentBlinds = [];
  const roundPlayers = new Map();
  const roundSurvivors = new Map();

  for (const d of deaths) {
    const round = d.round ?? 0;
    if (!roundPlayers.has(round)) roundPlayers.set(round, new Set());
    if (d.attacker_name) roundPlayers.get(round).add(d.attacker_name);
    if (d.user_name) roundPlayers.get(round).add(d.user_name);
  }
  for (const s of spawns) {
    const round = s.round ?? 0;
    if (!roundPlayers.has(round)) roundPlayers.set(round, new Set());
    if (s.user_name) roundPlayers.get(round).add(s.user_name);
  }

  for (const [round, players] of roundPlayers) {
    roundSurvivors.set(round, new Set(players));
  }

  function relevantBlindsForKill(killTick, victimName) {
    return recentBlinds.filter(
      (b) =>
        b.victim === victimName &&
        b.tick <= killTick &&
        killTick - b.tick <= TRADE_WINDOW_TICKS &&
        b.duration > 0.5
    );
  }

  for (const b of blinds) {
    recentBlinds.push({
      tick: b.tick ?? 0,
      attacker: b.attacker_name,
      victim: b.user_name,
      duration: b.blind_duration ?? 0,
    });
  }

  for (const d of deaths) {
    const round = d.round ?? 0;
    const attackerName = d.attacker_name;
    const victimName = d.user_name;
    const assisterName = d.assister_name;
    const tick = d.tick ?? 0;

    // Suicide (fall damage / world / killing yourself): attacker === victim.
    // HLTV counts these as neither a kill nor a death for anyone, so skip the
    // whole event. Enemy grenade/molotov kills (attacker !== victim) are real
    // kills and fall through normally.
    if (attackerName && victimName && attackerName === victimName) {
      continue;
    }

    if (victimName) {
      const victim = ensurePlayer(playerStats, victimName, d.user_team);
      victim.deaths += 1;
      victim.deathTicks.push({ round, tick });
      victim.team = d.user_team ?? victim.team;
      const survivors = roundSurvivors.get(round);
      if (survivors) survivors.delete(victimName);
    }

    if (attackerName) {
      const attacker = ensurePlayer(playerStats, attackerName, d.attacker_team);
      attacker.kills += 1;
      attacker.team = d.attacker_team ?? attacker.team;
      if (d.headshot) attacker.headshots += 1;
      attacker.killTicks.push({ round, tick });

      if (!killsPerRound.has(round)) killsPerRound.set(round, new Map());
      const roundKills = killsPerRound.get(round);
      roundKills.set(attackerName, (roundKills.get(attackerName) || 0) + 1);

      attacker.kastRounds.add(round);

      if (victimName && isTradeKill(attacker, victimName, tick, playerStats)) {
        attacker.tradeKills += 1;
      }

      const flashers = relevantBlindsForKill(tick, victimName);
      for (const f of flashers) {
        if (f.attacker && f.attacker !== attackerName) {
          const flasher = ensurePlayer(playerStats, f.attacker, null);
          flasher.flashAssists += 1;
          flasher.kastRounds.add(round);
        }
      }

      if (!firstDeathPerRound.has(round)) {
        firstDeathPerRound.set(round, { attacker: attackerName, victim: victimName, tick });
        attacker.openingKills += 1;
        if (victimName) {
          const victim = playerStats.get(victimName);
          if (victim) victim.openingDeaths += 1;
        }
      }
    }

    if (assisterName) {
      const assister = ensurePlayer(playerStats, assisterName, d.assister_team);
      assister.assists += 1;
      assister.team = d.assister_team ?? assister.team;
      assister.kastRounds.add(round);
    }
  }

  // Post-pass: traded deaths require all kills to be known.
  for (const d of deaths) {
    const victimName = d.user_name;
    const tick = d.tick ?? 0;
    const round = d.round ?? 0;
    if (victimName) {
      const victim = playerStats.get(victimName);
      if (victim && isTradedDeath(victim, tick, playerStats)) {
        victim.tradedDeaths += 1;
        victim.kastRounds.add(round);
      }
    }
  }

  // Damage. demoparser2's dmg_health is the weapon's THEORETICAL damage (an AWP
  // headshot reports 450), not the HP actually removed. HLTV ADR counts real
  // blood-loss. We reconstruct it from the `health` field (victim HP *after*
  // each hit): real = pre_hp - health_after, pre_hp resets to 100 each round.
  // This also naturally caps overkill. Teammate damage is excluded.
  const hurtsSorted = [...hurts].sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
  const preHp = new Map(); // `${round}|${victim}` -> HP before next hit
  for (const h of hurtsSorted) {
    const attackerName = h.attacker_name;
    const victimName = h.user_name;
    const rawDmg = h.dmg_health ?? 0;
    const hpAfter = h.health ?? 0;
    const round = h.round ?? 0;
    if (!victimName) continue;
    const key = `${round}|${victimName}`;
    const prev = preHp.has(key) ? preHp.get(key) : 100;
    let real = prev - hpAfter;
    if (real < 0) real = 0;
    preHp.set(key, hpAfter);
    if (!attackerName || attackerName === victimName || rawDmg <= 0) continue;
    if (
      h.attacker_team != null &&
      h.user_team != null &&
      h.attacker_team === h.user_team
    ) {
      continue;
    }
    if (real <= 0) continue;
    const attacker = ensurePlayer(playerStats, attackerName, h.attacker_team);
    attacker.damage += real;
    const victim = ensurePlayer(playerStats, victimName, h.user_team);
    victim.damageTaken += real;
  }

  for (const e of events.bomb_planted ?? []) {
    if (e.user_name) {
      const p = ensurePlayer(playerStats, e.user_name, "t");
      p.kastRounds.add(e.round ?? 0);
    }
  }
  for (const e of events.bomb_defused ?? []) {
    if (e.user_name) {
      const p = ensurePlayer(playerStats, e.user_name, "ct");
      p.kastRounds.add(e.round ?? 0);
    }
  }

  for (const [round, players] of roundPlayers) {
    const roundKills = killsPerRound.get(round) ?? new Map();
    for (const name of players) {
      const p = ensurePlayer(playerStats, name, null);
      p.roundsPlayed += 1;
      const survivors = roundSurvivors.get(round);
      if (survivors && survivors.has(name)) {
        p.kastRounds.add(round);
      }
      const kills = roundKills.get(name) || 0;
      if (kills >= 1 && kills <= 5) {
        p.multiKillRounds[kills] += 1;
      }
    }
  }

  for (const r of rounds) {
    if (r.winner === "unknown") continue;
    const roundDeaths = deaths.filter((d) => d.round === r.round);
    const participants = roundPlayers.get(r.round) ?? new Set();
    const teams = new Map();
    for (const name of participants) {
      const p = playerStats.get(name);
      if (p) teams.set(name, p.team);
    }
    let ctAlive = new Set([...participants].filter((n) => teams.get(n) === "ct"));
    let tAlive = new Set([...participants].filter((n) => teams.get(n) === "t"));
    for (const d of roundDeaths) {
      if (d.user_name) {
        ctAlive.delete(d.user_name);
        tAlive.delete(d.user_name);
      }
    }
    const winningSet = r.winner === "ct" ? ctAlive : tAlive;
    const losingSet = r.winner === "ct" ? tAlive : ctAlive;
    if (winningSet.size === 1 && losingSet.size >= 1) {
      const winnerName = [...winningSet][0];
      const p = playerStats.get(winnerName);
      if (p) {
        const n = Math.min(losingSet.size, 4);
        p.clutchWins[n] += 1;
      }
    }
  }

  for (const snapshot of freezeSnapshots.values()) {
    for (const [name, s] of snapshot) {
      const p = playerStats.get(name);
      if (p) {
        p.equipmentValueSpent += getEquipmentValue(s);
      }
    }
  }

  return playerStats;
}

export function computeDerivedStats(p) {
  const rounds = Math.max(p.roundsPlayed, 1);
  const kpr = p.kills / rounds;
  const dpr = p.deaths / rounds;
  const apr = p.assists / rounds;
  const adr = p.damage / rounds;
  const kast = p.kastRounds.size / rounds;
  const hsp = p.kills > 0 ? p.headshots / p.kills : 0;
  return {
    kpr,
    dpr,
    apr,
    adr,
    kast,
    hsp,
    openingKills: p.openingKills,
    openingDeaths: p.openingDeaths,
    tradeKills: p.tradeKills,
    tradedDeaths: p.tradedDeaths,
    multiKillRounds: p.multiKillRounds,
    flashAssists: p.flashAssists ?? 0,
    roundsPlayed: p.roundsPlayed,
  };
}

// Community reverse-engineered HLTV Rating 2.0 (R² ≈ 0.995)
export function computeRating2(stats) {
  const kpr = stats.kpr;
  const dpr = stats.dpr;
  const apr = stats.apr;
  const adr = stats.adr;
  const kast = stats.kast * 100; // formula expects 0-100 scale
  const impact = 2.13 * kpr + 0.42 * apr - 0.41;
  const rating = 0.0073 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587;
  return { rating, impact };
}

// Rating 3.0 approximation via the trained model (see rating3_model.js, R²≈0.80
// on HLTV ground truth). Builds the same engineered feature dict as the Python
// trainer (src/features.py build_model_features). round_swing and eco features
// are computed elsewhere (or default to 0 here); they add ~+0.02 R² when present.
export function computeRating3(stats, extra = {}) {
  const kpr = stats.kpr;
  const dpr = stats.dpr;
  const apr = stats.apr;
  const adr = stats.adr;
  const kast = stats.kast; // 0-1 scale
  const mk = stats.multiKillRounds || [0, 0, 0, 0, 0, 0];
  const rounds = Math.max(stats.roundsPlayed, 1);

  const impact = 2.13 * kpr + 0.42 * apr - 0.41;
  const rating2Baseline =
    0.0073 * (kast * 100) + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587;
  const openingKd = Math.min(
    stats.openingDeaths > 0 ? stats.openingKills / stats.openingDeaths : stats.openingKills,
    5.0
  );
  const tradeKd = Math.min(
    stats.tradedDeaths > 0 ? stats.tradeKills / stats.tradedDeaths : stats.tradeKills,
    5.0
  );
  const multiKillTotal = mk[2] + mk[3] + mk[4] + mk[5];

  const features = {
    kpr,
    dpr,
    apr,
    adr,
    kast,
    hsp: stats.hsp,
    opening_kills: stats.openingKills,
    opening_deaths: stats.openingDeaths,
    trade_kills: stats.tradeKills,
    traded_deaths: stats.tradedDeaths,
    multi_kill_2: mk[2],
    multi_kill_3: mk[3],
    multi_kill_4: mk[4],
    multi_kill_5: mk[5],
    flash_assists: stats.flashAssists ?? 0,
    round_swing: extra.round_swing ?? 0,
    impact,
    rating2_baseline: rating2Baseline,
    opening_kd: openingKd,
    trade_kd: tradeKd,
    multi_kill_total: multiKillTotal,
    kast_x_adr: kast * adr,
    kpr_x_kast: kpr * kast,
    survival: Math.max(0, 1 - dpr),
    eco_kpr: extra.eco_kpr ?? kpr,
    eco_advantage: extra.eco_advantage ?? 1.0,
  };

  const rating = predictRating3(features);
  return {
    rating,
    subRatings: {
      kills: kpr,
      damage: adr / 80,
      survival: Math.max(0, 1 - dpr),
      kast,
      multiKills: (mk[2] + mk[3] * 2 + mk[4] * 3 + mk[5] * 4) / rounds,
      roundSwing: extra.round_swing ?? 0,
    },
  };
}
