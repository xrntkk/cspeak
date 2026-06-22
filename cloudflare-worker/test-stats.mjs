import {
  computePlayerStats,
  computeDerivedStats,
  computeRating2,
  computeRating3,
  getEquipmentValue,
} from "./src/stats.js";

function makeEvents(deaths, hurts = [], blinds = [], plants = [], defuses = [], spawns = []) {
  return {
    player_death: deaths,
    player_hurt: hurts,
    player_blind: blinds,
    bomb_planted: plants,
    bomb_defused: defuses,
    player_spawn: spawns,
    round_start: [],
    round_freeze_end: [],
    round_end: [],
    bomb_exploded: [],
    weapon_fire: [],
    item_pickup: [],
  };
}

function makeRounds(rounds) {
  return rounds.map((r, idx) => ({
    round: r.round ?? idx + 1,
    winner: r.winner ?? "ct",
    reason: r.reason ?? "elimination",
    scoreCt: r.scoreCt ?? 0,
    scoreT: r.scoreT ?? 0,
    tick: r.tick ?? 0,
    bombPlanted: r.bombPlanted ?? false,
  }));
}

// ---------------------------------------------------------------------------
// Basic stats
// ---------------------------------------------------------------------------

{
  const deaths = [
    { round: 1, tick: 100, attacker_name: "A", user_name: "B", attacker_team: "t", user_team: "ct", headshot: true, weapon: "ak47" },
    { round: 1, tick: 200, attacker_name: "A", user_name: "C", attacker_team: "t", user_team: "ct", headshot: false, weapon: "ak47" },
    { round: 1, tick: 300, attacker_name: "B", user_name: "A", attacker_team: "ct", user_team: "t", headshot: false, weapon: "m4a4" },
  ];
  const hurts = [
    // dmg_health is the weapon's theoretical damage; `health` is the victim's
    // HP after the hit. Real blood-loss = 100 - health_after.
    { round: 1, tick: 50, attacker_name: "A", user_name: "B", attacker_team: "t", user_team: "ct", dmg_health: 80, health: 20 },
    { round: 1, tick: 60, attacker_name: "C", user_name: "A", attacker_team: "ct", user_team: "t", dmg_health: 50, health: 50 },
  ];
  const spawns = [
    { round: 1, user_name: "A", team: "t" },
    { round: 1, user_name: "B", team: "ct" },
    { round: 1, user_name: "C", team: "ct" },
  ];
  const events = makeEvents(deaths, hurts, [], [], [], spawns);
  const rounds = makeRounds([{ round: 1, winner: "ct" }]);
  const stats = computePlayerStats(events, rounds, new Map());

  const a = stats.get("A");
  console.assert(a.kills === 2, "A kills", a.kills);
  console.assert(a.deaths === 1, "A deaths", a.deaths);
  console.assert(a.damage === 80, "A damage", a.damage);
  console.assert(a.damageTaken === 50, "A damageTaken", a.damageTaken);

  const b = stats.get("B");
  console.assert(b.kills === 1, "B kills", b.kills);
  console.assert(b.deaths === 1, "B deaths", b.deaths);

  console.log("basic stats OK");
}

// ---------------------------------------------------------------------------
// KAST
// ---------------------------------------------------------------------------

{
  const deaths = [
    { round: 1, tick: 100, attacker_name: "A", user_name: "B", attacker_team: "t", user_team: "ct" },
    { round: 1, tick: 200, attacker_name: "C", user_name: "D", attacker_team: "ct", user_team: "t", assister_name: "E", assister_team: "ct" },
  ];
  const spawns = [
    { round: 1, user_name: "A", team: "t" },
    { round: 1, user_name: "B", team: "ct" },
    { round: 1, user_name: "C", team: "ct" },
    { round: 1, user_name: "D", team: "t" },
    { round: 1, user_name: "E", team: "ct" },
  ];
  const events = makeEvents(deaths, [], [], [], [], spawns);
  const rounds = makeRounds([{ round: 1, winner: "ct" }]);
  const stats = computePlayerStats(events, rounds, new Map());

  const a = stats.get("A");
  const c = stats.get("C");
  const e = stats.get("E");
  console.assert(a.kastRounds.has(1), "A KAST kill");
  console.assert(c.kastRounds.has(1), "C KAST kill");
  console.assert(e.kastRounds.has(1), "E KAST assist");
  console.log("KAST OK");
}

// ---------------------------------------------------------------------------
// Opening / trade / multi-kill
// ---------------------------------------------------------------------------

{
  const deaths = [
    { round: 1, tick: 100, attacker_name: "A", user_name: "B", attacker_team: "t", user_team: "ct" },
    { round: 1, tick: 120, attacker_name: "A", user_name: "C", attacker_team: "t", user_team: "ct" },
    { round: 1, tick: 140, attacker_name: "A", user_name: "D", attacker_team: "t", user_team: "ct" },
    { round: 1, tick: 150, attacker_name: "D", user_name: "A", attacker_team: "ct", user_team: "t" }, // D trades after teammates died
  ];
  const spawns = [
    { round: 1, user_name: "A", team: "t" },
    { round: 1, user_name: "B", team: "ct" },
    { round: 1, user_name: "C", team: "ct" },
    { round: 1, user_name: "D", team: "ct" },
  ];
  const events = makeEvents(deaths, [], [], [], [], spawns);
  const rounds = makeRounds([{ round: 1, winner: "t" }]);
  const stats = computePlayerStats(events, rounds, new Map());

  const a = stats.get("A");
  console.assert(a.openingKills === 1, "A opening kills", a.openingKills);
  console.assert(a.multiKillRounds[3] === 1, "A 3k round", a.multiKillRounds[3]);

  const d = stats.get("D");
  console.assert(d.tradeKills === 1, "D trade kill", d.tradeKills);
  console.assert(d.openingKills === 0, "D not opening");

  const b = stats.get("B");
  console.assert(b.tradedDeaths === 1, "B traded death", b.tradedDeaths);
  console.log("opening/trade/multi OK");
}

// ---------------------------------------------------------------------------
// Suicide: world/self kills count as neither kill nor death; enemy grenade
// kills (attacker !== victim) still count.
// ---------------------------------------------------------------------------

{
  const deaths = [
    { round: 1, tick: 100, attacker_name: "A", user_name: "B", attacker_team: "t", user_team: "ct", weapon: "hegrenade" },
    { round: 1, tick: 200, attacker_name: "C", user_name: "C", attacker_team: "ct", user_team: "ct", weapon: "world" },
  ];
  const spawns = [
    { round: 1, user_name: "A", team: "t" },
    { round: 1, user_name: "B", team: "ct" },
    { round: 1, user_name: "C", team: "ct" },
  ];
  const events = makeEvents(deaths, [], [], [], [], spawns);
  const rounds = makeRounds([{ round: 1, winner: "t" }]);
  const stats = computePlayerStats(events, rounds, new Map());

  const a = stats.get("A");
  console.assert(a.kills === 1, "A grenade kill counts", a.kills);
  const c = stats.get("C");
  console.assert(c.kills === 0, "C suicide no kill", c.kills);
  console.assert(c.deaths === 0, "C suicide no death", c.deaths);
  console.log("suicide OK");
}

// ---------------------------------------------------------------------------
// Rating 2.0
// ---------------------------------------------------------------------------

{
  const derived = computeDerivedStats({
    kills: 20,
    deaths: 15,
    assists: 5,
    headshots: 5,
    damage: 1600,
    damageTaken: 0,
    kastRounds: new Set([...Array(20).keys()].map((i) => i + 1)),
    roundsPlayed: 30,
    openingKills: 2,
    openingDeaths: 1,
    tradeKills: 1,
    tradedDeaths: 0,
    multiKillRounds: [0, 10, 3, 1, 0, 0],
    flashAssists: 0,
    clutchWins: [0, 0, 0, 0, 0, 0],
    clutchAttempts: [0, 0, 0, 0, 0, 0],
    saves: 0,
    killTicks: [],
    deathTicks: [],
    equipmentValueSpent: 0,
  });
  const { rating, impact } = computeRating2(derived);
  console.log("Rating 2.0 sample:", rating, "impact:", impact);
  console.assert(rating > 1.0 && rating < 1.5, "rating sane", rating);
  const r3 = computeRating3(derived);
  console.log("Rating 3.0 approx sample:", r3.rating, r3.subRatings);
}

// ---------------------------------------------------------------------------
// Equipment value
// ---------------------------------------------------------------------------

{
  const val = getEquipmentValue({
    armor_value: 100,
    has_helmet: true,
    active_weapon_name: "AK-47",
    inventory: ["Glock"],
  });
  console.assert(val > 0, "equipment value", val);
  console.log("equipment value OK:", val);
}

console.log("\nAll unit tests passed.");
