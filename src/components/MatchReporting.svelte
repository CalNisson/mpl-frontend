<script>
  import { onMount, onDestroy } from "svelte";
  import {
    getSeasonMatchesForReporting,
    getSeasonRostersForReporting,
    uploadMatchReport,
    getMatchGames,
    upsertMatchGame,
    patchMatchSummary,
  } from "../lib/api.js";
  import ReplayAnalyzer from "../components/ReplayAnalyzer.svelte";

  export let seasonId;
  export let canEdit = false;

  const ANALYZER_PATH = `${import.meta.env.BASE_URL}replay_analyzer.html`;

  
function roundLabel(m) {
  if (m?.is_playins) return `Play-ins: ${m.playins_round ?? "Round"}`;
  if (m?.is_playoff) return `Playoffs: ${m.playoff_round ?? "Round"}`;
  return `Week ${m.week ?? "?"}`;
}

let loading = true;
  let error = "";
  let overwrite = false;

  let matches = [];
  let rosterRows = [];

  let analysis = null;

  let selectedGroup = "";
  let selectedMatchId = "";

  let mapping = null;

  let readyToUpload = false;
  let showOverride = false;

  // reporting mode
  // - replay: requires an analyzed replay (normal path)
  // - manual: allows reporting forfeits / admin fixes without a replay (e.g., playoffs matches not in Schedule tab)
  let mode = "replay";

  // manual (forfeit) fields
  let mfWinnerId = "";
  let mfTeam1Score = "";
  let mfTeam2Score = "";
  let mfBestOf = ""; // "", 3, 5 (used for default score suggestion)
  let mfReplay = "FORFEIT";
  let mfAutoScore = true;

  // override fields
  let ovTeam1Id = "";
  let ovTeam2Id = "";
  let ovTeam1Score = 1;
  let ovTeam2Score = 0;
  let ovWinnerId = "";
  let ovReplay = "";

  // diff calculation mode
  let ovDiffMode = "score";

  // pokemon stat overrides
  let ovPokemonStats = [];

  // NEW: set handling
  let ovIsMultiSet = false;
  let ovBestOf = 3;     // 3 or 5
  let ovGameNumber = 1; // integer 1..bestOf

  function setErr(e) {
    error = e?.message ?? String(e);
  }

  function neededWins(bestOf) {
    const bo = Number(bestOf);
    if (!Number.isFinite(bo) || bo <= 1) return 1;
    return Math.floor(bo / 2) + 1;
  }

  function getMatchById(id) {
    const mid = Number(id);
    if (!mid) return null;
    return (matches ?? []).find((x) => Number(x.id) === mid) ?? null;
  }

  function normName(s) {
    if (!s) return "";
    return String(s)
      .trim()
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  const CANONICAL_FORMS = new Map([
    ["maushold-three", "maushold"],
    ["maushold-four", "maushold"],
    ["tatsugiri-droopy", "tatsugiri"],
    ["tatsugiri-curly", "tatsugiri"],
    ["tatsugiri-stretchy", "tatsugiri"],
  ]);

  function canonicalKeyFromName(name) {
    let k = normName(name);
    if (!k) return "";

    const hadMega =
      k.startsWith("mega-") || k.endsWith("-mega") || k.includes("-mega-");

    k = k.replace(/^mega-/, "");
    k = k.replace(/-mega(-[a-z0-9]+)?$/, "");
    k = k.replace(/-mega-/g, "-");

    if (hadMega) {
      k = k.replace(/-(x|y)$/, "");
    }

    // Your existing canonicals (keep)
    const canonical = CANONICAL_FORMS.get(k);
    if (canonical) k = canonical;

    return k;
  }


  function canonicalizeNameIfNeeded(rawName) {
    const raw = String(rawName ?? "").trim();
    if (!raw) return "";

    const k = canonicalKeyFromName(raw);
    if (k === "maushold") return "Maushold";
    if (k === "tatsugiri") return "Tatsugiri";
    return raw;
  }

  function compareKey(name) {
    return canonicalKeyFromName(name);
  }

  const GENDER_FORMS = new Set(["meowstic", "indeedee", "basculegion", "oinkologne"]);

  function parseShowdownDetail(detail) {
    const raw = String(detail ?? "").trim();
    if (!raw) return { base: "", gender: null };

    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    const base = parts[0] ?? "";

    let gender = null;
    for (const p of parts.slice(1)) {
      if (p === "M" || p === "F") {
        gender = p;
        break;
      }
    }
    return { base, gender };
  }

  function displayNameFromDetail(detail) {
    const { base, gender } = parseShowdownDetail(detail);
    if (!base) return "";

    const canonBase = canonicalizeNameIfNeeded(base);
    const baseKey = normName(canonBase);

    if (GENDER_FORMS.has(baseKey) && (gender === "M" || gender === "F")) {
      return `${canonBase} (${gender === "M" ? "Male" : "Female"})`;
    }
    return canonBase;
  }

  function matchKeysFromDisplayName(displayName) {
    const keys = new Set();
    if (!displayName) return [];

    keys.add(compareKey(displayName));

    const m = String(displayName).match(/^(.*)\s+\((Male|Female)\)\s*$/);
    if (m) keys.add(compareKey(m[1].trim()));

    return Array.from(keys).filter(Boolean);
  }

  function analysisPlayers() {
    const stats = analysis?.analysis?.stats;
    if (!stats) return [];
    if (Array.isArray(stats)) return stats;
    return Object.entries(stats).map(([key, v]) => ({ key, ...v }));
  }

  
function groupKey(m) {
  if (m?.is_playins) return `PI:${m.playins_round ?? "Play-ins"}`;
  if (m?.is_playoff) return `PO:${m.playoff_round ?? "Playoffs"}`;
  return `W:${m.week ?? "?"}`;
}

function groupLabelFromKey(k) {
  if (!k) return "";
  if (k.startsWith("PI:")) return `Play-ins: ${k.slice(3)}`;
  if (k.startsWith("PO:")) return `Playoffs: ${k.slice(3)}`;
  if (k.startsWith("W:")) return `Week ${k.slice(2)}`;
  return k;
}

function getGroups() {
  const seen = new Set();
  const out = [];
  for (const m of (matches ?? [])) {
    const k = groupKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  // Sort: play-ins first, then playoffs, then regular weeks ascending
  out.sort((a, b) => {
    const pa = a.startsWith("PI:") ? 0 : a.startsWith("PO:") ? 1 : 2;
    const pb = b.startsWith("PI:") ? 0 : b.startsWith("PO:") ? 1 : 2;
    if (pa !== pb) return pa - pb;

    if (a.startsWith("W:") && b.startsWith("W:")) {
      const na = Number(a.slice(2));
      const nb = Number(b.slice(2));
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    }
    return a.localeCompare(b);
  });
  return out;
}

function matchesForGroup(group) {
  if (!group) return [];
  return (matches ?? []).filter((m) => groupKey(m) === group);
}

function getWeeks() {
    const set = new Set(matches.map((m) => m.week).filter((w) => w != null));
    return Array.from(set).sort((a, b) => a - b);
  }

  function matchesForWeek(week) {
    const w = Number(week);
    if (!w) return [];
    return matches.filter((m) => (m.week ?? 0) === w);
  }

  function rosterForWeek(week) {
    const w = Number(week);
    return rosterRows.filter((r) => {
      const a = r.acquisition_week ?? 0;
      const d = r.dropped_week ?? null;
      return (a === 0 || a <= w) && (d == null || d > w);
    });
  }

  function groupRoster(rows) {
    const byTeam = {};
    for (const r of rows) {
      if (!byTeam[r.team_id]) {
        byTeam[r.team_id] = {
          team_id: r.team_id,
          team_name: r.team_name,
          coach_id: r.coach_id ?? null,
          coach_name: r.coach_name ?? null,
          pokemon: [],
          pokemonSet: new Set(),
          keyToPokemon: new Map(),
        };
      }

      const dbName = canonicalizeNameIfNeeded(r.pokemon_name);
      const entry = { pokemon_id: r.pokemon_id, pokemon_name: dbName };
      byTeam[r.team_id].pokemon.push(entry);

      const keys = matchKeysFromDisplayName(dbName);
      for (const k of keys) {
        byTeam[r.team_id].pokemonSet.add(k);
        if (!byTeam[r.team_id].keyToPokemon.has(k)) {
          byTeam[r.team_id].keyToPokemon.set(k, entry);
        }
      }
    }
    return Object.values(byTeam);
  }

  function buildPokemonStatsFromAnalysis(player, team_id, rosterTeam) {
    const team = player?.team ?? [];
    const stats = [];

    for (const mon of team) {
      if (!mon?.brought) continue;

      const detail = mon?.formes?.[0]?.detail ?? "";
      const display = displayNameFromDetail(detail);
      const keys = matchKeysFromDisplayName(display);

      let rosterMon = null;
      for (const k of keys) {
        const hit = rosterTeam?.keyToPokemon?.get(k) ?? null;
        if (hit) {
          rosterMon = hit;
          break;
        }
      }
      if (!rosterMon) continue;

      const k = Array.isArray(mon.kills) ? mon.kills.reduce((a, b) => a + (b ?? 0), 0) : 0;
      const d = mon.fainted ? 1 : 0;

      stats.push({
        team_id,
        pokemon_id: rosterMon.pokemon_id,
        pokemon_name: rosterMon.pokemon_name,
        kills: k,
        deaths: d,
      });
    }

    return stats;
  }

  // ----------------------------
  // NEW: derive "game score" from replay
  // Score = remaining mons = 6 - deaths (clamped)
  // ----------------------------
  function clampInt(n, a, b) {
    n = Number(n);
    if (!Number.isFinite(n)) return a;
    return Math.max(a, Math.min(b, Math.trunc(n)));
  }

  function playerDeaths(p) {
    // analyzer JSON usually has total.deaths
    const d = p?.total?.deaths ?? p?.total?.Deaths ?? null;
    return Number.isFinite(Number(d)) ? Number(d) : 0;
  }

  function gameScoreFromPlayer(p) {
    // Default to 6; if you later want variable teamsize, wire it here.
    const deaths = clampInt(playerDeaths(p), 0, 6);
    return clampInt(6 - deaths, 0, 6);
  }

  function computeGameScores(p1, p2) {
    // p1/p2 here are replay players (not match team1/team2)
    const s1 = gameScoreFromPlayer(p1);
    const s2 = gameScoreFromPlayer(p2);
    return { s1, s2 };
  }

  function computeMapping() {
    mapping = null;
    readyToUpload = false;
    showOverride = false;

    const matchId = Number(selectedMatchId);
    if (!analysis || !matchId) return;

    const m = matches.find((x) => x.id === matchId);
    if (!m) {
      mapping = { error: "Selected match not found.", mismatches: [] };
      return;
    }

    const players = analysisPlayers();
    if (players.length < 2) {
      mapping = { error: "Replay analysis did not contain two players.", mismatches: [] };
      return;
    }

    const wk = Number(m.week);
    if (!Number.isFinite(wk) || wk <= 0) {
      mapping = { error: "Selected match has no valid week value.", mismatches: [] };
      return;
    }

    const rosterGrouped = groupRoster(rosterForWeek(wk));

    function usedMons(p) {
      const team = p?.team ?? [];
      return team
        .filter((mon) => mon?.brought)
        .map((mon) => {
          const detail = mon?.formes?.[0]?.detail ?? "";
          const display = displayNameFromDetail(detail);
          return matchKeysFromDisplayName(display);
        })
        .flat()
        .filter(Boolean);
    }

    function bestRosterForPlayer(p) {
      const used = new Set(usedMons(p));
      let best = null;

      for (const rt of rosterGrouped) {
        let overlap = 0;
        let missing = [];

        for (const u of used) {
          if (rt.pokemonSet.has(u)) overlap += 1;
          else missing.push(u);
        }

        const score = overlap * 1000 - missing.length;
        if (!best || score > best.score) best = { rt, overlap, missing, score, used: Array.from(used) };
      }
      return best;
    }

    const p1 = players[0];
    const p2 = players[1];

    const b1 = bestRosterForPlayer(p1);
    let b2 = bestRosterForPlayer(p2);

    if (b2 && b1 && b2.rt.team_id === b1.rt.team_id) {
      const used2 = new Set(usedMons(p2));
      const candidates = rosterGrouped
        .filter((rt) => rt.team_id !== b1.rt.team_id)
        .map((rt) => {
          let overlap = 0;
          let missing = [];
          for (const u of used2) {
            if (rt.pokemonSet.has(u)) overlap += 1;
            else missing.push(u);
          }
          const score = overlap * 1000 - missing.length;
          return { rt, overlap, missing, score, used: Array.from(used2) };
        })
        .sort((a, b) => b.score - a.score);

      if (candidates.length) b2 = candidates[0];
    }

    const mismatches = [];
    if (!b1 || !b2) {
      mismatches.push({ kind: "mapping", message: "Could not map both replay players to teams." });
    } else {
      if (b1.missing.length) mismatches.push({ kind: "roster", team_id: b1.rt.team_id, team_name: b1.rt.team_name, player: p1.username, missing: b1.missing });
      if (b2.missing.length) mismatches.push({ kind: "roster", team_id: b2.rt.team_id, team_name: b2.rt.team_name, player: p2.username, missing: b2.missing });
    }

    // Determine winner from analysis
    const p1Win = !!p1.win;
    const p2Win = !!p2.win;

    // Game score from deaths (remaining mons)
    const { s1: p1GameScore, s2: p2GameScore } = computeGameScores(p1, p2);

    // We'll assign the game score to match.team1/team2 based on alignment/swap
    let team1_score = null;
    let team2_score = null;
    let winner_team_id = null;

    if (p1Win !== p2Win) {
      winner_team_id = p1Win ? b1?.rt?.team_id : b2?.rt?.team_id;
    }

    const mappedTeam1 = b1?.rt?.team_id;
    const mappedTeam2 = b2?.rt?.team_id;

    const aligns = mappedTeam1 === m.team1_id && mappedTeam2 === m.team2_id;
    const alignsSwapped = mappedTeam1 === m.team2_id && mappedTeam2 === m.team1_id;
    const matchTeamsOk = aligns || alignsSwapped;

    if (!matchTeamsOk) {
      mismatches.push({
        kind: "match_teams",
        message:
          `Selected match is ${m.team1_name} vs ${m.team2_name}, ` +
          `but replay maps to ${b1?.rt?.team_name ?? "?"} vs ${b2?.rt?.team_name ?? "?"}. ` +
          `Upload is blocked unless you use Override.`,
      });
    }

    // Assign scores relative to the match record
    if (aligns) {
      team1_score = p1GameScore;
      team2_score = p2GameScore;
    } else if (alignsSwapped) {
      team1_score = p2GameScore;
      team2_score = p1GameScore;
    } else {
      // Fallback: keep p1->team1 order (best effort)
      team1_score = p1GameScore;
      team2_score = p2GameScore;
    }

    let finalTeam1 = m.team1_id;
    let finalTeam2 = m.team2_id;

    let finalWinner = null;
    if (winner_team_id) finalWinner = winner_team_id;

    const pstats1 = buildPokemonStatsFromAnalysis(p1, mappedTeam1, b1?.rt);
    const pstats2 = buildPokemonStatsFromAnalysis(p2, mappedTeam2, b2?.rt);
    const pokemon_stats = [...pstats1, ...pstats2];

    mapping = {
      match: m,
      p1: { username: p1.username, team: b1?.rt, overlap: b1?.overlap, missing: b1?.missing ?? [] },
      p2: { username: p2.username, team: b2?.rt, overlap: b2?.overlap, missing: b2?.missing ?? [] },
      replay_url: analysis.replayUrl,
      suggested: {
        team1_id: finalTeam1,
        team2_id: finalTeam2,
        team1_score,
        team2_score,
        winner_id: finalWinner,
        pokemon_stats,
      },
      mismatches,
    };

    readyToUpload =
      mismatches.length === 0 &&
      matchTeamsOk &&
      team1_score != null &&
      team2_score != null &&
      finalWinner != null;

    // preload override defaults
    ovReplay = analysis.replayUrl ?? "";
    ovTeam1Id = String(finalTeam1 ?? "");
    ovTeam2Id = String(finalTeam2 ?? "");
    ovTeam1Score = team1_score ?? 0;
    ovTeam2Score = team2_score ?? 0;
    ovWinnerId = String(finalWinner ?? "");
    ovPokemonStats = pokemon_stats.map((x) => ({ ...x }));

    ovDiffMode = "score";

    // reset set controls
    ovIsMultiSet = false;
    ovBestOf = 3;
    ovGameNumber = 1;
  }

  async function load() {
    if (!seasonId) return;
    loading = true;
    error = "";
    analysis = null;
    selectedGroup = "";
    selectedMatchId = "";
    mapping = null;

    try {
      const [m, r] = await Promise.all([
        getSeasonMatchesForReporting(seasonId),
        getSeasonRostersForReporting(seasonId),
      ]);
      matches = Array.isArray(m) ? m : [];
      rosterRows = Array.isArray(r) ? r : [];
    } catch (e) {
      setErr(e);
      matches = [];
      rosterRows = [];
    } finally {
      loading = false;
    }
  }

  function onMessage(ev) {
    const data = ev?.data;
    if (!data || data.type !== "mpl_replay_analysis") return;

    const json = data.analysis?.json ?? data.analysis ?? null;
    analysis = { replayUrl: data.replayUrl ?? "", analysis: json };

    selectedGroup = "";
    selectedMatchId = "";
    mapping = null;
    readyToUpload = false;
    showOverride = false;
  }

  onMount(() => {
    window.addEventListener("message", onMessage);
    load();
  });

  onDestroy(() => {
    window.removeEventListener("message", onMessage);
  });

  $: if (analysis && selectedGroup && selectedMatchId) {
    computeMapping();
  }
  // If there is no analysis loaded, force Manual mode
  $: if (!analysis && mode === "replay") {
    mode = "manual";
  }

  // Manual mode: default winner + score suggestion for forfeits
  $: if (mode === "manual" && selectedMatchId) {
    const m = getMatchById(selectedMatchId);
    if (m) {
      const bo = Number(m.best_of) || (mfBestOf ? Number(mfBestOf) : 0) || 3;
      if (!mfBestOf) mfBestOf = String(bo);

      // Default winner to Team 1 if not selected
      if (!mfWinnerId) mfWinnerId = String(m.team1_id ?? "");

      // Auto-suggest series score if enabled
      if (mfAutoScore) {
        const bestOf = Number(mfBestOf || bo) || 3;
        const need = (bestOf === 1) ? 3 : neededWins(bestOf);
        const team1_id = Number(m.team1_id);
        const team2_id = Number(m.team2_id);
        const w = Number(mfWinnerId);
        if (w === team1_id) {
          mfTeam1Score = String(need);
          mfTeam2Score = "0";
        } else if (w === team2_id) {
          mfTeam1Score = "0";
          mfTeam2Score = String(need);
        }
      }
    }
  }


  // ----------------------------
  // NEW: Set validation + series recompute
  // ----------------------------
  function requiredWins(bestOf) {
    const bo = Number(bestOf);
    return bo === 5 ? 3 : 2; // only 3 or 5 supported
  }

  function validateSetInputs() {
    if (!showOverride) return null; // only used for override submit path

    if (!ovIsMultiSet) return null;

    const bo = Number(ovBestOf);
    if (bo !== 3 && bo !== 5) return "Best-of must be 3 or 5.";

    const gn = Number(ovGameNumber);
    if (!Number.isFinite(gn)) return "Game number must be a whole number.";
    if (!Number.isInteger(gn)) return "Game number must be a whole number.";
    if (gn < 1) return "Game number must be at least 1.";
    if (gn > bo) return `Game number cannot be greater than best-of (${bo}).`;

    return null;
  }

  function computeSeriesFromGames(games, team1_id, team2_id, bestOf) {
    // games rows expected shape: { game_number, winner_id, ... }
    let w1 = 0;
    let w2 = 0;

    for (const g of games ?? []) {
      const wid = Number(g?.winner_id ?? 0);
      if (!wid) continue;
      if (wid === Number(team1_id)) w1 += 1;
      else if (wid === Number(team2_id)) w2 += 1;
    }

    const need = requiredWins(bestOf);
    let winner_id = null;
    if (w1 >= need && w1 > w2) winner_id = Number(team1_id);
    else if (w2 >= need && w2 > w1) winner_id = Number(team2_id);

    return { team1_wins: w1, team2_wins: w2, winner_id };
  }

  async function onUpload() {
    const matchId = Number(selectedMatchId);
    if (!matchId) return;

    error = "";

    // payload values
    const replay = showOverride ? (ovReplay?.trim() || null) : (mapping?.replay_url?.trim() || null);
    const team1_score = showOverride ? Number(ovTeam1Score) : Number(mapping?.suggested?.team1_score);
    const team2_score = showOverride ? Number(ovTeam2Score) : Number(mapping?.suggested?.team2_score);
    const winner_id = showOverride ? Number(ovWinnerId) : Number(mapping?.suggested?.winner_id);

    const pokemon_stats = showOverride
      ? (ovPokemonStats ?? []).map((x) => ({
          team_id: Number(x.team_id),
          pokemon_id: Number(x.pokemon_id),
          kills: Number(x.kills),
          deaths: Number(x.deaths),
        }))
      : (mapping?.suggested?.pokemon_stats ?? []).map((x) => ({
          team_id: x.team_id,
          pokemon_id: x.pokemon_id,
          kills: x.kills,
          deaths: x.deaths,
        }));

    try {
      if (!showOverride) {
        // Non-override path: always treat as single-game update to matches (game score)
        await uploadMatchReport(matchId, {
          replay,
          team1_score,
          team2_score,
          winner_id,
          is_double_loss: false,
          pokemon_stats,
          force_overwrite: !!overwrite,
        });
        await load();
        return;
      }

      // Override path:
      const setErrMsg = validateSetInputs();
      if (setErrMsg) {
        error = setErrMsg;
        return;
      }

      if (!ovIsMultiSet) {
        // Single-game override: patch match directly with GAME score
        await uploadMatchReport(matchId, {
          replay,
          team1_score,
          team2_score,
          winner_id,
          is_double_loss: false,
          pokemon_stats,
          force_overwrite: !!overwrite,
        });
        await load();
        return;
      }

      // Multi-game set:
      const bo = Number(ovBestOf);
      const gn = Number(ovGameNumber);

      // 1) upsert this game into match_games
      await upsertMatchGame(matchId, gn, {
        replay,
        team1_score,
        team2_score,
        winner_id,
        pokemon_stats,
      });

      // 2) refetch all games and recompute series wins
      const games = await getMatchGames(matchId);

      const team1_id = Number(ovTeam1Id) || Number(mapping?.suggested?.team1_id) || Number(mapping?.match?.team1_id);
      const team2_id = Number(ovTeam2Id) || Number(mapping?.suggested?.team2_id) || Number(mapping?.match?.team2_id);

      const { team1_wins, team2_wins, winner_id: seriesWinner } =
        computeSeriesFromGames(games, team1_id, team2_id, bo);

      // 3) patch match summary to reflect series score
      await patchMatchSummary(matchId, {
        team1_score: team1_wins,
        team2_score: team2_wins,
        winner_id: seriesWinner, // null if not decided
        best_of: bo,             // optional if you store it; harmless if ignored
      });

      await load();
    } catch (e) {
      setErr(e);
    }
  }

  async function onSubmitForfeit() {
    const matchId = Number(selectedMatchId);
    if (!matchId) return;

    const m = getMatchById(matchId);
    if (!m) {
      error = "Selected match not found.";
      return;
    }

    const team1_id = Number(m.team1_id);
    const team2_id = Number(m.team2_id);

    const winner_id = Number(String(mfWinnerId ?? "").trim());
    if (!winner_id) {
      error = "Forfeit requires selecting a winner.";
      return;
    }
    if (winner_id !== team1_id && winner_id !== team2_id) {
      error = "Forfeit winner must be Team 1 or Team 2.";
      return;
    }

    const bo = Number(mfBestOf) || Number(m.best_of) || 3;
    const need = neededWins(bo);

    const s1raw = String(mfTeam1Score ?? "").trim();
    const s2raw = String(mfTeam2Score ?? "").trim();

    const team1_score = s1raw === "" ? (winner_id === team1_id ? need : 0) : Number(s1raw);
    const team2_score = s2raw === "" ? (winner_id === team2_id ? need : 0) : Number(s2raw);

    if (!Number.isFinite(team1_score) || !Number.isFinite(team2_score)) {
      error = "Scores must be valid numbers.";
      return;
    }

    error = "";
    try {
      await uploadMatchReport(matchId, {
        replay: (mfReplay ?? "FORFEIT").trim() || "FORFEIT",
        team1_score,
        team2_score,
        winner_id,
        is_double_loss: false,
        pokemon_stats: [],
        force_overwrite: !!overwrite,
      });
      await load();
    } catch (e) {
      setErr(e);
    }
  }

  function summarizeTeam(team_id) {
    const useOverride = !!showOverride;

    const team1_id = useOverride ? Number(ovTeam1Id) : Number(mapping?.suggested?.team1_id);
    const team2_id = useOverride ? Number(ovTeam2Id) : Number(mapping?.suggested?.team2_id);

    const team1_score = useOverride ? Number(ovTeam1Score) : Number(mapping?.suggested?.team1_score ?? 0);
    const team2_score = useOverride ? Number(ovTeam2Score) : Number(mapping?.suggested?.team2_score ?? 0);

    const statsSource = useOverride ? (ovPokemonStats ?? []) : (mapping?.suggested?.pokemon_stats ?? []);
    const stats = statsSource.filter((s) => Number(s.team_id) === Number(team_id));

    const kills = stats.reduce((a, s) => a + (Number(s.kills) || 0), 0);
    const deaths = stats.reduce((a, s) => a + (Number(s.deaths) || 0), 0);

    const mode = useOverride ? ovDiffMode : "score";

    let diff = 0;
    if (mode === "kills") {
      diff = kills - deaths;
    } else {
      if (Number(team_id) === team1_id) diff = team1_score - team2_score;
      else if (Number(team_id) === team2_id) diff = team2_score - team1_score;
      else diff = 0;
    }

    return { kills, deaths, diff };
  }
</script>

{#if !canEdit}
  <div class="card muted">Match Reporting is only available to League Masters and Admins.</div>
{:else}
  <div class="grid">
    <div class="card">
      <div class="card-title">Replay Analyzer</div>
      <ReplayAnalyzer
        on:analyzed={(ev) => {
          const replayUrl = ev.detail?.replayUrl ?? "";
          const json = ev.detail?.analysis ?? ev.detail?.json ?? null;

          analysis = { replayUrl, analysis: json };

          selectedGroup = "";
          selectedMatchId = "";
          mapping = null;
          readyToUpload = false;
          showOverride = false;
        }}
      />
    </div>

    <div class="card">
      <div class="card-title">Match Upload</div>

      {#if loading}
        <div class="muted">Loading match data…</div>
      {:else}
        {#if error}
          <div class="error">{error}</div>
        {/if}

                <div class="mode-row">
          <button
            class="tab"
            class:active={mode === "replay"}
            on:click={() => (mode = "replay")}
            disabled={!analysis}
            title={!analysis ? "Analyze a replay to enable replay reporting." : ""}
          >
            Replay
          </button>
          <button class="tab" class:active={mode === "manual"} on:click={() => (mode = "manual")}>
            Manual / Forfeit
          </button>
        </div>

        {#if mode === "replay"}
          {#if !analysis}
            <div class="muted">Analyze a replay to begin.</div>
          {:else}
          <div class="block">
            <div class="muted">Replay:</div>
            <div class="mono">{analysis.replayUrl}</div>
          </div>

          <div class="row">
            <label class="field">
              <span class="lab">Week</span>
              <select class="select" bind:value={selectedGroup}>
                <option value="">Select round…</option>
                {#each getGroups() as g}
                  <option value={g}>{groupLabelFromKey(g)}</option>
                {/each}
              </select>
            </label>

            <label class="field">
              <span class="lab">Match</span>
              <select class="select" bind:value={selectedMatchId} disabled={!selectedGroup}>
                <option value="">Select match…</option>
                {#each matchesForGroup(selectedGroup) as m (m.id)}
                  <option value={m.id}>
                    {m.team1_name} vs {m.team2_name} (#{m.id})
                  </option>
                {/each}
              </select>
            </label>
          </div>

          {#if mapping}
            {#if mapping.error}
              <div class="error">{mapping.error}</div>
            {:else}
              <div class="block">
                <div class="muted">Replay players mapped to teams:</div>
                <ul>
                  <li>
                    <span class="mono">{mapping.p1.username}</span>
                    → <b>{mapping.p1.team?.team_name}</b>
                    {#if mapping.p1.team?.coach_name}
                      <span class="muted">({mapping.p1.team.coach_name})</span>
                    {/if}
                  </li>
                  <li>
                    <span class="mono">{mapping.p2.username}</span>
                    → <b>{mapping.p2.team?.team_name}</b>
                    {#if mapping.p2.team?.coach_name}
                      <span class="muted">({mapping.p2.team.coach_name})</span>
                    {/if}
                  </li>
                </ul>
              </div>

              {#if mapping.mismatches?.length}
                <div class="error">
                  <div style="font-weight:800; margin-bottom:.25rem;">Validation issues (upload blocked)</div>
                  {#each mapping.mismatches as mm}
                    {#if mm.kind === "roster"}
                      <div>
                        <b>{mm.player}</b> has Pokémon not on <b>{mm.team_name}</b>: {mm.missing.join(", ")}
                      </div>
                    {:else if mm.kind === "match_teams"}
                      <div>{mm.message}</div>
                    {:else}
                      <div>{mm.message}</div>
                    {/if}
                  {/each}
                </div>
              {/if}

              <div class="divider"></div>

              <div class="preview">
                <div class="preview-title">Preview (single-game score)</div>
                <div class="preview-line">
                  <b>{mapping.match.team1_name}</b>
                  <span class="muted">vs</span>
                  <b>{mapping.match.team2_name}</b>
                </div>
                {#if mapping.suggested.winner_id}
                  <div class="preview-line">
                    {#if mapping.suggested.winner_id === mapping.match.team1_id}
                      <b>{mapping.suggested.team1_score}</b>
                      <span class="muted">-</span>
                      {mapping.suggested.team2_score}
                    {:else}
                      {mapping.suggested.team1_score}
                      <span class="muted">-</span>
                      <b>{mapping.suggested.team2_score}</b>
                    {/if}
                  </div>
                {:else}
                  <div class="muted">No winner detected in replay analysis.</div>
                {/if}

                <div class="stats-row">
                  {#each [mapping.p1.team?.team_id, mapping.p2.team?.team_id].filter(Boolean) as tid (tid)}
                    {@const s = summarizeTeam(tid)}
                    <div class="stat-card">
                      <div class="muted">Team {tid}</div>
                      <div>Kills: {s.kills}</div>
                      <div>Deaths: {s.deaths}</div>
                      <div>Diff: {s.diff}</div>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="row" style="margin-top:.75rem;">
                <button class="btn" on:click={() => (showOverride = !showOverride)}>
                  {showOverride ? "Hide override" : "Override / edit before upload"}
                </button>
                
{#if canEdit}
  <label class="checkbox" style="display:flex; align-items:center; gap:.5rem; margin-right:.75rem;">
    <input type="checkbox" bind:checked={overwrite} />
    <span>Overwrite</span>
  </label>
{/if}

<button class="btn coral" on:click={onUpload} disabled={!readyToUpload && !showOverride}>
                  Upload
                </button>
              </div>

              {#if showOverride}
                <div class="override">
                  <div class="muted" style="margin-bottom:.5rem;">
                    Override lets you manually adjust the computed values before upload.
                  </div>

                  <label class="field">
                    <span class="lab">Replay URL</span>
                    <input class="select" type="text" bind:value={ovReplay} />
                  </label>

                  <label class="field" style="margin-top:.5rem;">
                    <span class="lab">
                      <input type="checkbox" bind:checked={ovIsMultiSet} style="margin-right:.5rem;" />
                      Part of multi-game set
                    </span>
                  </label>

                  {#if ovIsMultiSet}
                    <div class="row">
                      <label class="field">
                        <span class="lab">Best of</span>
                        <select class="select" bind:value={ovBestOf}>
                          <option value="3">Best of 3</option>
                          <option value="5">Best of 5</option>
                        </select>
                      </label>
                      <label class="field">
                        <span class="lab">Game #</span>
                        <input class="select" type="number" min="1" step="1" bind:value={ovGameNumber} />
                      </label>
                    </div>
                  {/if}

                  <div class="row">
                    <label class="field">
                      <span class="lab">Team 1 score (GAME)</span>
                      <input class="select" type="number" min="0" step="1" bind:value={ovTeam1Score} />
                    </label>
                    <label class="field">
                      <span class="lab">Team 2 score (GAME)</span>
                      <input class="select" type="number" min="0" step="1" bind:value={ovTeam2Score} />
                    </label>
                    <label class="field">
                      <span class="lab">Winner team_id</span>
                      <input class="select" type="number" min="1" step="1" bind:value={ovWinnerId} />
                    </label>
                  </div>

                  <label class="field" style="margin-top:.5rem;">
                    <span class="lab">Diff calculation</span>
                    <select class="select" bind:value={ovDiffMode}>
                      <option value="score">By match score (2-0 = +2 / -2)</option>
                      <option value="kills">By kills (kills - deaths)</option>
                    </select>
                  </label>

                  <div class="divider"></div>

                  <div class="muted" style="margin-bottom:.25rem;">Pokémon stats (kills/deaths)</div>
                  <div class="poke-grid">
                    {#each ovPokemonStats as ps, i (ps.team_id + ':' + ps.pokemon_id)}
                      <div class="poke-row">
                        <div class="mono" title="{ps.team_id}">{ps.pokemon_name}</div>
                        <input class="select" type="number" min="0" step="1" bind:value={ovPokemonStats[i].kills} />
                        <input class="select" type="number" min="0" step="1" bind:value={ovPokemonStats[i].deaths} />
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            {/if}
          {/if}
          {/if}
        {:else}
          <div class="row">
            <label class="field">
              <span class="lab">Round</span>
              <select class="select" bind:value={selectedGroup}>
                <option value="">Select round…</option>
                {#each getGroups() as g}
                  <option value={g}>{groupLabelFromKey(g)}</option>
                {/each}
              </select>
            </label>

            <label class="field">
              <span class="lab">Match</span>
              <select class="select" bind:value={selectedMatchId} disabled={!selectedGroup}>
                <option value="">Select match…</option>
                {#each matchesForGroup(selectedGroup) as m (m.id)}
                  <option value={m.id}>
                    {m.team1_name} vs {m.team2_name} (#{m.id})
                  </option>
                {/each}
              </select>
            </label>
          </div>

          {#if selectedMatchId}
            {@const mm = getMatchById(selectedMatchId)}
            {#if mm}
              <div class="block">
                <div class="muted">Reporting a forfeit:</div>
                <div>
                  <b>{mm.team1_name}</b> vs <b>{mm.team2_name}</b>
                  <span class="muted">(#{mm.id}, {roundLabel(mm)})</span>
                </div>
              </div>

              <div class="row">
                <label class="field">
                  <span class="lab">Winner</span>
                  <select class="select" bind:value={mfWinnerId}>
                    <option value="">Select winner…</option>
                    <option value={mm.team1_id}>{mm.team1_name}</option>
                    <option value={mm.team2_id}>{mm.team2_name}</option>
                  </select>
                </label>

                <label class="field">
                  <span class="lab">Best of</span>
                  <select class="select" bind:value={mfBestOf}>
                    <option value="1">1</option>
                    <option value="3">3</option>
                    <option value="5">5</option>
                  </select>
                </label>

                <label class="field">
                  <span class="lab">{mm.team1_name} Score</span>
                  <input
                    class="score-input"
                    type="number"
                    min="0"
                    step="1"
                    bind:value={mfTeam1Score}
                    on:input={() => (mfAutoScore = false)}
                  />
                </label>

                <label class="field">
                  <span class="lab">{mm.team2_name} Score</span>
                  <input
                    class="score-input"
                    type="number"
                    min="0"
                    step="1"
                    bind:value={mfTeam2Score}
                    on:input={() => (mfAutoScore = false)}
                  />
                </label>
              </div>

              <div class="row">
                <label class="check">
                  <input type="checkbox" bind:checked={mfAutoScore} />
                  Auto-suggest score
                </label>

                <label class="check">
                  <input type="checkbox" bind:checked={overwrite} />
                  Overwrite existing report
                </label>

                <button class="btn primary" disabled={!mfWinnerId} on:click={onSubmitForfeit}>
                  Submit Forfeit
                </button>
              </div>
            {/if}
          {/if}
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  @media (max-width: 980px) {
    .grid { grid-template-columns: 1fr; }
  }
  .card {
    border-radius: 16px;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .card-title {
    font-weight: 900;
    font-size: 1.05rem;
    margin-bottom: 0.4rem;
  }
  .muted { opacity: 0.75; }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.9rem;
    word-break: break-all;
  }
  .analyzer {
    width: 100%;
    height: 70vh;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.25);
  }
  .row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: end;
  }
  .field {
    display: grid;
    gap: 0.25rem;
    min-width: 180px;
    flex: 1;
  }
  .lab { font-size: 0.85rem; opacity: 0.9; }
  select.select { appearance: none; }
  .btn {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.92);
    padding: 0.55rem 0.85rem;
    border-radius: 12px;
    cursor: pointer;
  }
  .btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .coral {
    background: rgba(255, 107, 107, 0.18);
    border-color: rgba(255, 107, 107, 0.35);
  }
  .divider {
    margin: 0.85rem 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
  }
  .error {
    background: rgba(255, 80, 80, 0.12);
    border: 1px solid rgba(255, 80, 80, 0.25);
    padding: 0.6rem 0.75rem;
    border-radius: 12px;
    margin: 0.5rem 0;
  }
  .block { margin: 0.75rem 0; }
  .preview {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.18);
  }
  .preview-title { font-weight: 900; margin-bottom: 0.4rem; }
  .preview-line { display: flex; gap: 0.5rem; align-items: baseline; }
  .stats-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-top: 0.65rem;
  }
  .stat-card {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 0.5rem 0.6rem;
    background: rgba(255, 255, 255, 0.04);
  }
  .override {
    margin-top: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.18);
  }
  .poke-grid { display: grid; gap: 0.35rem; }
  .poke-row {
    display: grid;
    grid-template-columns: 1fr 90px 90px;
    gap: 0.5rem;
    align-items: center;
  }

  .mode-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .tab {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.9);
    padding: 0.45rem 0.65rem;
    border-radius: 10px;
    cursor: pointer;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .tab:hover { background: rgba(255, 255, 255, 0.07); }
  .tab:disabled { opacity: 0.5; cursor: not-allowed; }
  .tab.active {
    background: rgba(255, 255, 255, 0.10);
    border-color: rgba(255, 255, 255, 0.22);
  }
  .check {
    display: inline-flex;
    gap: 0.5rem;
    align-items: center;
    opacity: 0.9;
    font-size: 0.9rem;
    user-select: none;
  }
  .score-input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.25);
    color: #e8eefc;
    box-sizing: border-box;
  }
</style>
