<script>
  import { createEventDispatcher, onMount } from "svelte";
  import {
    getSeasonDashboard,
    getSeasonSchedule,
    getPlayoffsStatus,
    getPlayoffsBracket,
    publishPlayoffs
  } from "../lib/api.js";

  export let seasonId;
  export let leagueId;
  export let canEdit = false;

  // teams should be the "current season teams" list you already have (teamsMerged is perfect)
  export let teams = [];

  const dispatch = createEventDispatcher();

  // ----------------------------
  // LocalStorage (frontend-only)
  // ----------------------------
  function keyBase() {
    const sid = seasonId ?? "none";
    const lid = leagueId ?? "none";
    return `mpl.playoffs.${lid}.${sid}`;
  }

  function loadJson(k, fallback) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveJson(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // ignore
    }
  }

  // ----------------------------
  // Playoffs published status (backend)
  // ----------------------------
  let playoffsStatus = null; // { playoffs_published, playins_published, playoff_matches, ... }
  let published = false;

  let statusLoading = false;
  let statusError = "";

  let officialBracket = null;
  let publishedPreview = null;
  let publishedPhase = "playoffs";

  // ✅ NEW: lock structural options once published
  $: structureLocked = !!published;

  // Convert the backend "published bracket" (matches + links) into the same shape
  // the planner uses for rendering the bracket preview.
  function previewFromOfficialBracket(official) {
    const out = {
      playinsRounds: [],
      playoffsRounds: [],
      matchesFlat: [],
      linksFlat: []
    };

    if (!official || !Array.isArray(official.matches)) return out;

    const links = Array.isArray(official.links) ? official.links : [];
    const linkMap = new Map(); // from_match_id -> { to_match_id, to_slot }
    for (const l of links) {
      const from = Number(l.from_match_id ?? l.fromMatchId);
      const to = Number(l.to_match_id ?? l.toMatchId);
      const toSlot = Number(l.to_slot ?? l.toSlot);
      if (Number.isFinite(from) && Number.isFinite(to)) {
        linkMap.set(from, { to, toSlot: Number.isFinite(toSlot) ? toSlot : null });
      }
    }

    // group by (phase, round_index)
    const by = new Map(); // key -> array
    for (const m of official.matches) {
      const phase = String(m.phase ?? "").toLowerCase();
      const ri = Number(m.round_index ?? m.roundIndex ?? 0);
      const si = Number(m.slot_index ?? m.slotIndex ?? 0);
      const key = `${phase}:${ri}`;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push({ ...m, _phase: phase, _ri: ri, _si: si });
    }

    function buildRounds(phase) {
      const rounds = [];
      const roundIndexes = Array.from(by.keys())
        .filter((k) => k.startsWith(`${phase}:`))
        .map((k) => Number(k.split(":")[1]))
        .filter((n) => Number.isFinite(n));
      const uniq = Array.from(new Set(roundIndexes)).sort((a, b) => a - b);

      for (const ri of uniq) {
        const key = `${phase}:${ri}`;
        const ms = (by.get(key) ?? []).sort((a, b) => a._si - b._si);

        const roundLabel =
          ms.find((x) => x.playoff_round ?? x.playins_round)?.playoff_round ??
          ms.find((x) => x.playins_round ?? x.playoff_round)?.playins_round ??
          `Round ${ri + 1}`;

        const matches = ms.map((x) => {
          const id = Number(x.id);
          const link = linkMap.get(id);

          const t1id = x.team1_id ?? null;
          const t2id = x.team2_id ?? null;

          return {
            id,
            phase,
            roundIndex: ri,
            slotIndex: x._si,
            label: x.playoff_round ?? x.playins_round ?? roundLabel,
            players: [
              {
                id: t1id ?? `tbd-${id}-a`,
                teamId: t1id,
                name: x.team1_name ?? "TBD",
                score: ""
              },
              {
                id: t2id ?? `tbd-${id}-b`,
                teamId: t2id,
                name: x.team2_name ?? "TBD",
                score: ""
              }
            ],
            nextMatchId: link ? link.to : null,
            nextSlot: link ? link.toSlot : null
          };
        });

        rounds.push({ name: roundLabel, index: ri, matches });
      }

      return rounds;
    }

    out.playinsRounds = buildRounds("playins");
    out.playoffsRounds = buildRounds("playoffs");

    return out;
  }

  let _lastStatusKey = "";

  async function refreshPlayoffsStatus() {
    if (!seasonId || !leagueId) return;
    statusLoading = true;
    statusError = "";
    try {
      playoffsStatus = await getPlayoffsStatus(seasonId, leagueId);
      published = !!(playoffsStatus?.playoffs_published || playoffsStatus?.playins_published);
      dispatch("publishedChanged", { published });
    } catch (e) {
      statusError = e?.message ?? String(e);
      playoffsStatus = null;
      published = false;
      dispatch("publishedChanged", { published });
    } finally {
      statusLoading = false;
    }
  }

  async function refreshOfficialBracket() {
    if (!seasonId || !leagueId) return;
    try {
      officialBracket = await getPlayoffsBracket(seasonId, leagueId);
    } catch (e) {
      console.error("getPlayoffsBracket failed:", e);
      statusError = e?.message ?? String(e);
      officialBracket = null;
      playoffsStatus = null;
      published = false;
      dispatch("publishedChanged", { published });
    }

    if (officialBracket?.published) publishedPreview = previewFromOfficialBracket(officialBracket);
    else publishedPreview = null;
  }

  $: publishedPhase = (() => {
    const ms = officialBracket?.matches ?? [];
    const hasPlayoffs = ms.some(
      (m) => (m?.phase ?? "").toLowerCase() === "playoffs" || m?.is_playoff === true
    );
    if (hasPlayoffs) return "playoffs";
    const hasPlayins = ms.some(
      (m) => (m?.phase ?? "").toLowerCase() === "playins" || m?.is_playins === true
    );
    return hasPlayins ? "playins" : "playoffs";
  })();

  $: {
    const k = `${leagueId ?? "none"}:${seasonId ?? "none"}`;
    if (k !== _lastStatusKey) {
      _lastStatusKey = k;
      refreshPlayoffsStatus();
      refreshOfficialBracket();
    }
  }

  function buildPublishPayload({ overwrite = true } = {}) {
    // IMPORTANT: publish the CURRENT local preview (the league_master's selected options)
    if (!preview?.playoffsRounds?.length && !preview?.playinsRounds?.length) {
      return { published: true, overwrite, matches: [], links: [] };
    }

    const matches = [];
    const links = [];

    function pushMatch(m, roundLabel) {
      const t1 = m?.players?.[0]?.teamId ?? null;
      const t2 = m?.players?.[1]?.teamId ?? null;

      matches.push({
        temp_id: m.id,
        phase: m.phase,
        round_index: m.roundIndex,
        slot_index: m.slotIndex,
        round_label: (roundLabel ?? m.label),
        team1_id: t1,
        team2_id: t2
      });

      if (m.nextMatchId && (m.nextSlot === 1 || m.nextSlot === 2)) {
        links.push({
          from_temp_id: m.id,
          to_temp_id: m.nextMatchId,
          to_slot: m.nextSlot
        });
      }
    }

    for (const round of preview.playoffsRounds ?? []) {
      for (const m of round?.matches ?? []) pushMatch(m, round?.name ?? null);
    }
    for (const round of preview.playinsRounds ?? []) {
      for (const m of round?.matches ?? []) pushMatch(m, round?.name ?? null);
    }

    return { published: true, overwrite, matches, links };
  }

  async function setPublished(next) {
    if (!canEdit) return;

    const want = !!next;

    if (want) {
      const payload = buildPublishPayload({ overwrite: true });
      const out = await publishPlayoffs(seasonId, payload, leagueId);
      // refresh so EVERYONE sees exactly what was saved
      await refreshPlayoffsStatus();
      await refreshOfficialBracket();
      // default the editor preview to official after publishing
      showOfficialPreview = true;
      return out;
    } else {
      const out = await publishPlayoffs(
        seasonId,
        { published: false, overwrite: true, matches: [], links: [] },
        leagueId
      );
      await refreshPlayoffsStatus();
      await refreshOfficialBracket();
      showOfficialPreview = false;
      return out;
    }
  }

  // ----------------------------
  // Settings (local)
  // ----------------------------
  const DEFAULTS = {
    allQualify: false,
    qualifyCount: 8,
    hasPlayins: false,
    playinsQualify: 4,
    playinsAdvance: 2,
    seeding: "standings", // league|conference|division (kept for legacy; UI uses league/conference/division)
    bracketType: "standard", // standard|weighted_byes
    // If enabled, the generated playoffs bracket will include a 3rd-place match
    // in the final column (Loser of Semifinal 1 vs Loser of Semifinal 2).
    includeThirdPlace: true
  };

  let settings = { ...DEFAULTS };
  let previewVersion = 0;

  function clampInt(x, lo, hi) {
    const n = Number(x);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, Math.trunc(n)));
  }

  function normalizeSettings(raw, teamsCount) {
    const base = { ...DEFAULTS, ...(raw ?? {}) };
    const nTeams = teamsCount ?? 0;

    // normalize seeding values (old "standings" -> "league")
    const seeding = base.seeding === "standings" ? "league" : base.seeding;

    if (base.allQualify) {
      return {
        ...base,
        seeding,
        qualifyCount: nTeams,
        hasPlayins: false,
        playinsQualify: 0,
        playinsAdvance: 0
      };
    }

    const qualifyCount = clampInt(base.qualifyCount, 2, nTeams);

    if (!base.hasPlayins) {
      return {
        ...base,
        seeding,
        qualifyCount,
        playinsQualify: 0,
        playinsAdvance: 0
      };
    }

    const playinsQualify = clampInt(base.playinsQualify || 4, 2, qualifyCount - 1);
    const playinsAdvance = clampInt(base.playinsAdvance || 2, 1, playinsQualify - 1);

    return {
      ...base,
      seeding,
      qualifyCount,
      playinsQualify,
      playinsAdvance
    };
  }

  function persistSettings(next) {
    const normalized = normalizeSettings(next, (teams ?? []).length);
    settings = normalized;
    saveJson(`${keyBase()}.settings`, normalized);
    previewVersion++;
  }

  $: settingsKey = `${keyBase()}.settings`;

  $: {
    settingsKey;
    (teams ?? []).length;

    const raw = loadJson(settingsKey, null);
    settings = normalizeSettings(raw, (teams ?? []).length);
  }

  // ----------------------------
  // Team color helpers (dimmed)
  // ----------------------------
  function normalizeHex(c) {
    if (!c) return null;
    const s = String(c).trim();
    if (!s) return null;
    if (s.startsWith("#")) return s;
    if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
    return null;
  }

  function pickPrimaryColor(t) {
    return normalizeHex(
      t?.primary_color ??
        t?.color_primary ??
        t?.team_color ??
        t?.color ??
        t?.color1 ??
        t?.primaryColor
    );
  }

  function hexToRgb(hex) {
    if (!hex) return null;
    const h = hex.replace("#", "");
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return { r, g, b };
  }

  function mixRgb(a, b, t) {
    return {
      r: Math.round(a.r * (1 - t) + b.r * t),
      g: Math.round(a.g * (1 - t) + b.g * t),
      b: Math.round(a.b * (1 - t) + b.b * t)
    };
  }

  function rgbToHex(rgb) {
    const to = (n) => n.toString(16).padStart(2, "0");
    return `#${to(rgb.r)}${to(rgb.g)}${to(rgb.b)}`;
  }

  function dimHex(hex, t = 0.15) {
    const c = hexToRgb(hex);
    if (!c) return null;
    const bg = { r: 22, g: 32, b: 64 }; // roughly #0b1020
    return rgbToHex(mixRgb(c, bg, Math.max(0, Math.min(1, t))));
  }

  function textColorForBg(hex) {
    const c = hexToRgb(hex);
    if (!c) return null;
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return luminance > 155 ? "#0b1020" : "#ffffff";
  }

  function teamPillStyle(t) {
    const base = pickPrimaryColor(t);
    if (!base) return "";
    const bg = dimHex(base, 0.74) ?? base;
    const fg = textColorForBg(bg) ?? "#ffffff";
    return `background:${bg}; color:${fg}; border-color: rgba(255,255,255,0.14);`;
  }

  // ----------------------------
  // Standings source (season dashboard)
  // ----------------------------
  let dashboardStandings = null;
  let standingsError = "";

  async function loadDashboardStandings() {
    standingsError = "";
    dashboardStandings = null;
    if (!seasonId) return;

    try {
      const dash = await getSeasonDashboard(seasonId, leagueId);
      const s =
        dash?.standings ??
        dash?.data?.standings ??
        dash?.leaderboard ??
        dash?.data?.leaderboard ??
        dash?.regular_season_standings ??
        dash?.data?.regular_season_standings ??
        null;

      dashboardStandings = Array.isArray(s) ? s : null;
    } catch (e) {
      standingsError = e?.message ?? String(e);
      dashboardStandings = null;
    }
  }

  onMount(loadDashboardStandings);

  $: {
    seasonId;
    leagueId;
    loadDashboardStandings();
  }

  // ----------------------------
  // Schedule matches (fallback standings source)
  // ----------------------------
  let scheduleMatches = [];
  let scheduleError = "";

  async function loadScheduleMatches() {
    scheduleError = "";
    scheduleMatches = [];
    if (!seasonId) return;

    try {
      const out = await getSeasonSchedule(seasonId, leagueId);
      scheduleMatches = Array.isArray(out) ? out : out?.matches ?? [];
      if (!Array.isArray(scheduleMatches)) scheduleMatches = [];
    } catch (e) {
      scheduleError = e?.message ?? String(e);
      scheduleMatches = [];
    }
  }

  onMount(loadScheduleMatches);

  $: {
    seasonId;
    leagueId;
    loadScheduleMatches();
  }

  // ----------------------------
  // Standings / seeding helpers
  // ----------------------------
  function numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function firstNumOrNull(...vals) {
    for (const v of vals) {
      const n = numOrNull(v);
      if (n != null) return n;
    }
    return null;
  }

  let seasonWinsByTeamId = {};
  let seasonLossesByTeamId = {};
  let seasonDiffByTeamId = {};

  $: {
    const wins = {};
    const losses = {};
    const diff = {};

    for (const t of teams ?? []) {
      if (t?.id == null) continue;
      wins[t.id] = 0;
      losses[t.id] = 0;
      diff[t.id] = 0;
    }

    const excludedMatchIds = new Set(
      (scheduleMatches ?? [])
        .filter((m) => m?.is_playoff || m?.is_playins)
        .map((m) => m.id)
    );

    for (const m of scheduleMatches ?? []) {
      if (!m || m.id == null) continue;
      if (excludedMatchIds.has(m.id)) continue;

      let t1Id = m.team1_id ?? null;
      let t2Id = m.team2_id ?? null;

      if (t1Id == null || t2Id == null) {
        const t1 = (teams ?? []).find((t) => t?.team_name === m.team1_name);
        const t2 = (teams ?? []).find((t) => t?.team_name === m.team2_name);
        t1Id = t1?.id ?? null;
        t2Id = t2?.id ?? null;
      }

      if (t1Id == null || t2Id == null) continue;

      const s1 = m.team1_score ?? 0;
      const s2 = m.team2_score ?? 0;

      const hasAnyScore = m.team1_score != null || m.team2_score != null;
      const played = hasAnyScore && (s1 !== 0 || s2 !== 0);
      if (!played) continue;

      if (m.is_double_loss) {
        losses[t1Id] = (losses[t1Id] ?? 0) + 1;
        losses[t2Id] = (losses[t2Id] ?? 0) + 1;

        diff[t1Id] = (diff[t1Id] ?? 0) - s2;
        diff[t2Id] = (diff[t2Id] ?? 0) - s1;
        continue;
      }

      if (s1 > s2) {
        wins[t1Id] = (wins[t1Id] ?? 0) + 1;
        losses[t2Id] = (losses[t2Id] ?? 0) + 1;

        diff[t1Id] = (diff[t1Id] ?? 0) + s1;
        diff[t2Id] = (diff[t2Id] ?? 0) - s1;
      } else if (s2 > s1) {
        wins[t2Id] = (wins[t2Id] ?? 0) + 1;
        losses[t1Id] = (losses[t1Id] ?? 0) + 1;

        diff[t2Id] = (diff[t2Id] ?? 0) + s2;
        diff[t1Id] = (diff[t1Id] ?? 0) - s2;
      } else {
        // ties: no W/L change, no diff change
      }
    }

    seasonWinsByTeamId = wins;
    seasonLossesByTeamId = losses;
    seasonDiffByTeamId = diff;
  }

  function standingsSort(a, b) {
    const ra = firstNumOrNull(
      a?.regular_season_rank,
      a?.rank,
      a?.standing?.rank,
      a?.standings?.rank,
      a?.record?.rank,
      a?.seed,
      a?.place
    );
    const rb = firstNumOrNull(
      b?.regular_season_rank,
      b?.rank,
      b?.standing?.rank,
      b?.standings?.rank,
      b?.record?.rank,
      b?.seed,
      b?.place
    );
    if (ra != null && rb != null && ra !== rb) return ra - rb;

    const wa =
      seasonWinsByTeamId[a?.id] ??
      firstNumOrNull(a?.season_wins, a?.wins, a?.standing?.wins, a?.record?.wins, a?.record?.w) ??
      0;
    const wb =
      seasonWinsByTeamId[b?.id] ??
      firstNumOrNull(b?.season_wins, b?.wins, b?.standing?.wins, b?.record?.wins, b?.record?.w) ??
      0;
    if (wb !== wa) return wb - wa;

    const da =
      seasonDiffByTeamId[a?.id] ??
      firstNumOrNull(
        a?.differential,
        a?.diff,
        a?.standing?.differential,
        a?.standing?.diff,
        a?.record?.diff
      ) ??
      0;
    const db =
      seasonDiffByTeamId[b?.id] ??
      firstNumOrNull(
        b?.differential,
        b?.diff,
        a?.standing?.differential,
        b?.standing?.diff,
        b?.record?.diff
      ) ??
      0;
    if (db !== da) return db - da;

    const la =
      seasonLossesByTeamId[a?.id] ??
      firstNumOrNull(
        a?.season_losses,
        a?.losses,
        a?.standing?.losses,
        a?.record?.losses,
        a?.record?.l
      ) ??
      0;
    const lb =
      seasonLossesByTeamId[b?.id] ??
      firstNumOrNull(
        b?.season_losses,
        b?.losses,
        b?.standing?.losses,
        b?.record?.losses,
        b?.record?.l
      ) ??
      0;
    if (la !== lb) return la - lb;

    return (a?.team_name ?? "").localeCompare(b?.team_name ?? "");
  }

  function mergeTeamsWithStandings(teamsList, standingsList) {
    const teamsSafe = (teamsList ?? []).filter((t) => t && t.id != null);
    if (!Array.isArray(standingsList) || standingsList.length === 0) return teamsSafe.slice();

    const byId = new Map(teamsSafe.map((t) => [Number(t.id), t]));
    const merged = [];

    for (const row of standingsList) {
      const teamId = firstNumOrNull(row?.team_id, row?.teamId, row?.team?.id);
      if (teamId == null) continue;

      const base = byId.get(Number(teamId));
      if (!base) continue;

      merged.push({
        ...base,
        team_name: base.team_name ?? row?.team_name ?? row?.name ?? base.name,
        regular_season_rank: firstNumOrNull(row?.regular_season_rank, row?.rank, row?.place),
        season_wins: firstNumOrNull(row?.season_wins, row?.wins, row?.record?.wins, row?.record?.w),
        season_losses: firstNumOrNull(
          row?.season_losses,
          row?.losses,
          row?.record?.losses,
          row?.record?.l
        ),
        differential: firstNumOrNull(row?.differential, row?.diff, row?.record?.diff)
      });
    }

    const seen = new Set(merged.map((t) => Number(t.id)));
    for (const t of teamsSafe) {
      if (!seen.has(Number(t.id))) merged.push(t);
    }

    return merged;
  }

  function getStandings(list) {
    return (list ?? []).slice().sort(standingsSort);
  }

  function seedLeague(list) {
    return getStandings(list).map((t, i) => ({ ...t, _seed: i + 1 }));
  }

  function seedConference(list) {
    const standings = getStandings(list);
    const confOrder = [];
    const byConf = new Map();

    for (const t of standings) {
      const c = t?.conference ?? "—";
      if (!byConf.has(c)) {
        byConf.set(c, []);
        confOrder.push(c);
      }
      byConf.get(c).push(t);
    }

    const seeded = [];
    let k = 1;
    let r = 0;
    while (seeded.length < standings.length) {
      for (const c of confOrder) {
        const arr = byConf.get(c) ?? [];
        if (arr[r]) seeded.push({ ...arr[r], _seed: k++ });
      }
      r++;
    }
    return seeded;
  }

  function seedDivision(list) {
    const standings = getStandings(list);
    const byDiv = new Map();

    for (const t of standings) {
      const d = t?.division ?? "—";
      const arr = byDiv.get(d) ?? [];
      arr.push(t);
      byDiv.set(d, arr);
    }

    const divOrder = Array.from(byDiv.keys()).sort((da, db) => {
      const aTop = byDiv.get(da)?.[0];
      const bTop = byDiv.get(db)?.[0];
      return standingsSort(aTop, bTop);
    });

    const seeded = [];
    let k = 1;
    let r = 0;
    while (seeded.length < standings.length) {
      for (const d of divOrder) {
        const arr = byDiv.get(d) ?? [];
        if (arr[r]) seeded.push({ ...arr[r], _seed: k++ });
      }
      r++;
    }
    return seeded;
  }

  function seedTeams(list, seeding) {
    if (seeding === "conference") return seedConference(list);
    if (seeding === "division") return seedDivision(list);
    return seedLeague(list);
  }

  // ----------------------------
  // Bracket building (preview)
  // ----------------------------
  function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  function teamLabel(t) {
    if (!t) return "TBD";
    const name = t?.team_name ?? "Team";
    const seed = t?._seed ?? null;
    return seed ? `#${seed} ${name}` : name;
  }

  function buildStandardPlayoffs(qualified) {
    const n = qualified.length;
    const size = nextPow2(n);

    const slots = [];
    for (let s = 1; s <= size; s++) {
      slots.push(qualified.find((t) => t._seed === s) ?? null);
    }

    const firstRoundPairs = [];
    for (let i = 0; i < size / 2; i++) {
      firstRoundPairs.push([slots[i], slots[size - 1 - i]]);
    }

    const rounds = [];
    const roundNames = [];
    if (size === 2) roundNames.push("Finals");
    else if (size === 4) roundNames.push("Semifinals", "Finals");
    else if (size === 8) roundNames.push("Quarterfinals", "Semifinals", "Finals");
    else if (size === 16) roundNames.push("Round of 16", "Quarterfinals", "Semifinals", "Finals");
    else if (size === 32)
      roundNames.push("Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Finals");
    else {
      roundNames.push(`Round of ${size}`);
      let cur = size / 2;
      while (cur >= 2) {
        if (cur === 2) roundNames.push("Finals");
        else roundNames.push(`Round of ${cur}`);
        cur = cur / 2;
      }
    }

    const r0 = firstRoundPairs.map((pair, idx) => ({
      id: `P-R0-M${idx + 1}`,
      phase: "playoffs",
      roundIndex: 0,
      slotIndex: idx,
      label: roundNames[0] ? `${roundNames[0]} M${idx + 1}` : `Match ${idx + 1}`,
      players: pair.map((t, pi) => ({
        id: t?.id ?? `bye-${idx}-${pi}`,
        teamId: t?.id ?? null,
        name: t ? teamLabel(t) : "BYE",
        score: "",
        _sourcePlayinMatchId: t?._sourcePlayinMatchId ?? null // optional
      })),
      nextMatchId: null,
      nextSlot: null
    }));

    rounds.push({ name: roundNames[0] ?? "Round 1", index: 0, matches: r0 });

    let prevCount = r0.length;
    let roundIdx = 1;

    while (prevCount >= 2) {
      const count = prevCount / 2;
      const matches = [];

      for (let i = 0; i < count; i++) {
        matches.push({
          id: `P-R${roundIdx}-M${i + 1}`,
          phase: "playoffs",
          roundIndex: roundIdx,
          slotIndex: i,
          label: roundNames[roundIdx]
            ? `${roundNames[roundIdx]} M${i + 1}`
            : `Round ${roundIdx + 1} M${i + 1}`,
          players: [
            { id: `tbd-${roundIdx}-${i}-a`, teamId: null, name: "TBD", score: "" },
            { id: `tbd-${roundIdx}-${i}-b`, teamId: null, name: "TBD", score: "" }
          ],
          nextMatchId: null,
          nextSlot: null
        });
      }

      rounds.push({
        name: roundNames[roundIdx] ?? `Round ${roundIdx + 1}`,
        index: roundIdx,
        matches
      });

      for (let i = 0; i < prevCount; i++) {
        const from = rounds[roundIdx - 1].matches[i];
        const to = rounds[roundIdx].matches[Math.floor(i / 2)];
        from.nextMatchId = to.id;
        from.nextSlot = i % 2 === 0 ? 1 : 2;
      }

      prevCount = count;
      roundIdx++;
    }

    return rounds;
  }

  function buildWeightedByesPlayoffs(qualified) {
    // unchanged (your existing code)
    const n = qualified.length;
    if (n <= 2) return buildStandardPlayoffs(qualified);

    const size = nextPow2(n);
    const allowDoubleBye = n > (3 * size) / 4;
    if (!allowDoubleBye) return buildStandardPlayoffs(qualified);

    const bySeed = new Map();
    for (const t of qualified) bySeed.set(t._seed, t);

    function teamOrNull(seed) {
      return bySeed.get(seed) ?? null;
    }

    function classicSeedOrder(targetSize) {
      let order = [1, 2];
      let cur = 2;
      while (cur < targetSize) {
        const next = [];
        for (const s of order) {
          next.push(s);
          next.push(cur * 2 + 1 - s);
        }
        order = next;
        cur *= 2;
      }
      return order;
    }

    function firstRoundPairOrder(targetSize) {
      const order = classicSeedOrder(targetSize);
      const pairs = [];
      for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
      return pairs;
    }

    function seedToVerticalIndex(targetSize) {
      const pairs = firstRoundPairOrder(targetSize);
      const m = new Map();
      pairs.forEach((pair, idx) => {
        const anchor = Math.min(pair[0], pair[1]);
        m.set(anchor, idx);
      });
      return m;
    }

    const verticalIndexByAnchor = seedToVerticalIndex(size);

    function slotFromTeam(t) {
      return t ? { kind: "team", team: t } : null;
    }
    function slotFromMatch(m) {
      return { kind: "match", match: m };
    }
    function slotLabel(slot) {
      if (!slot) return "BYE";
      if (slot.kind === "team") return teamLabel(slot.team);
      return `Winner (${slot.match.label})`;
    }
    function slotId(slot, fallback) {
      if (!slot) return fallback;
      if (slot.kind === "team") return slot.team?.id ?? fallback;
      return `W:${slot.match.id}`;
    }
    function slotTeamId(slot) {
      if (!slot) return null;
      if (slot.kind !== "team") return null;
      return slot.team?.id ?? null;
    }
    function slotSeed(slot) {
      if (!slot) return null;
      if (slot.kind !== "team") return null;
      const s = slot.team?._seed ?? null;
      return Number.isFinite(s) ? s : null;
    }

    let idCounter = 1;

    function mkMatch(roundIndex, slotIndex, label, slotA, slotB, phase) {
      const id = `W-R${roundIndex}-M${idCounter++}`;

      const sa = slotSeed(slotA);
      const sb = slotSeed(slotB);

      let top = slotA;
      let bot = slotB;

      if (sa != null && sb != null && sa > sb) {
        top = slotB;
        bot = slotA;
      } else if (sa == null && sb != null) {
        top = slotB;
        bot = slotA;
      }

      const match = {
        id,
        phase,
        roundIndex,
        slotIndex,
        label,
        players: [
          { id: slotId(top, `tbd-${id}-a`), teamId: slotTeamId(top), name: slotLabel(top), score: "" },
          { id: slotId(bot, `tbd-${id}-b`), teamId: slotTeamId(bot), name: slotLabel(bot), score: "" }
        ],
        nextMatchId: null,
        nextSlot: null
      };

      if (top?.kind === "match") {
        top.match.nextMatchId = match.id;
        top.match.nextSlot = 1;
      }
      if (bot?.kind === "match") {
        bot.match.nextMatchId = match.id;
        bot.match.nextSlot = 2;
      }

      return match;
    }

    function playOrAdvance(roundIndex, slotIndex, label, slotA, slotB, roundBuckets) {
      if (slotA && !slotB) return slotA;
      if (!slotA && slotB) return slotB;
      if (!slotA && !slotB) return null;

      const m = mkMatch(roundIndex, slotIndex, label, slotA, slotB, "playoffs");
      roundBuckets[roundIndex].push(m);
      return slotFromMatch(m);
    }

    const order = classicSeedOrder(size);

    const pods = [];
    for (let i = 0; i < order.length; i += 4) {
      const chunk = order.slice(i, i + 4);
      const present = chunk.map((s) => (s <= n ? s : null)).filter((s) => s != null);
      if (!present.length) continue;

      const seedsSorted = present.slice().sort((a, b) => a - b);
      const topSeed = seedsSorted[0];
      pods.push({ chunk, topSeed });
    }

    pods.sort((a, b) => {
      const ia = verticalIndexByAnchor.get(a.topSeed) ?? 9999;
      const ib = verticalIndexByAnchor.get(b.topSeed) ?? 9999;
      return ia - ib;
    });

    const buckets = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    const podFinalSlots = [];

    for (let podSlot = 0; podSlot < pods.length; podSlot++) {
      const { chunk } = pods[podSlot];

      const present = chunk.map((s) => (s <= n ? s : null)).filter((s) => s != null);
      if (!present.length) continue;

      const seedsSorted = present.slice().sort((a, b) => a - b);
      const topSeed = seedsSorted[0];
      const midSeed = seedsSorted[1] ?? null;
      const lows = seedsSorted.slice(2);

      let lowASeed = lows[0] ?? null;
      let lowBSeed = lows.length >= 2 ? lows[lows.length - 1] : null;

      if (lowASeed != null && lowBSeed != null && lowASeed < lowBSeed) {
        const tmp = lowASeed;
        lowASeed = lowBSeed;
        lowBSeed = tmp;
      }

      const lowA = slotFromTeam(lowASeed != null ? teamOrNull(lowASeed) : null);
      const lowB = slotFromTeam(lowBSeed != null ? teamOrNull(lowBSeed) : null);
      const mid = slotFromTeam(midSeed != null ? teamOrNull(midSeed) : null);
      const top = slotFromTeam(teamOrNull(topSeed));

      const r1Winner = playOrAdvance(0, podSlot, `Weighted • Round 1 M${podSlot + 1}`, lowA, lowB, buckets);
      const r2Winner = playOrAdvance(1, podSlot, `Weighted • Round 2 M${podSlot + 1}`, r1Winner, mid, buckets);
      const podWinner = playOrAdvance(2, podSlot, `Weighted • Round 3 M${podSlot + 1}`, r2Winner, top, buckets);

      if (podWinner) podFinalSlots.push(podWinner);
    }

    const semiWinners = [];
    for (let i = 0; i < podFinalSlots.length; i += 2) {
      const a = podFinalSlots[i] ?? null;
      const b = podFinalSlots[i + 1] ?? null;
      const w = playOrAdvance(3, Math.floor(i / 2), `Semifinal ${Math.floor(i / 2) + 1}`, a, b, buckets);
      if (w) semiWinners.push(w);
    }

    playOrAdvance(4, 0, "Finals", semiWinners[0] ?? null, semiWinners[1] ?? null, buckets);

    const rawRounds = [];
    if (buckets[0].length) rawRounds.push({ name: "Weighted Round 1", key: 0, matches: buckets[0] });
    if (buckets[1].length) rawRounds.push({ name: "Weighted Round 2", key: 1, matches: buckets[1] });
    if (buckets[2].length) rawRounds.push({ name: "Weighted Round 3", key: 2, matches: buckets[2] });

    if (buckets[3].length) {
      rawRounds.push({
        name: buckets[3].length === 1 ? "Finals" : "Semifinals",
        key: 3,
        matches: buckets[3]
      });
    }
    if (buckets[4].length) rawRounds.push({ name: "Finals", key: 4, matches: buckets[4] });

    if (!rawRounds.length) return buildStandardPlayoffs(qualified);

    const rounds = rawRounds.map((r, newIdx) => {
      for (const m of r.matches) m.roundIndex = newIdx;
      return { name: r.name, index: newIdx, matches: r.matches };
    });

    return rounds;
  }

  // Add a 3rd-place match (semifinal losers) into the final column.
  // This is a pure preview/publish structure item: it intentionally does NOT
  // wire links, since it depends on LOSERS (and the published wiring only
  // supports winner advancement).
  function ensureThirdPlaceMatch(playoffsRounds) {
    if (!Array.isArray(playoffsRounds) || playoffsRounds.length < 2) return;

    // Avoid duplicates (e.g. toggling settings / rebuild).
    for (const r of playoffsRounds) {
      if ((r?.matches ?? []).some((m) => String(m?.label ?? "").toLowerCase().includes("third"))) {
        return;
      }
    }

    const semiIdx = playoffsRounds.findIndex((r) => String(r?.name ?? "").toLowerCase().includes("semi"));
    if (semiIdx < 0) return;
    const semis = playoffsRounds[semiIdx]?.matches ?? [];
    if (semis.length < 2) return;

    // Put it in the last round (final column).
    const finalRound = playoffsRounds[playoffsRounds.length - 1];
    if (!finalRound || !Array.isArray(finalRound.matches)) return;

    const id = `P-THIRD:${semis[0]?.id ?? "a"}:${semis[1]?.id ?? "b"}`;

    finalRound.matches.push({
      id,
      phase: "playoffs",
      roundIndex: finalRound.index,
      slotIndex: finalRound.matches.length,
      label: "Third Place",
      players: [
        {
          id: `L:${semis[0]?.id ?? "semi1"}`,
          teamId: null,
          name: `Loser (${semis[0]?.label ?? "Semifinal 1"})`,
          score: ""
        },
        {
          id: `L:${semis[1]?.id ?? "semi2"}`,
          teamId: null,
          name: `Loser (${semis[1]?.label ?? "Semifinal 2"})`,
          score: ""
        }
      ],
      nextMatchId: null,
      nextSlot: null
    });
  }

  function buildPlayins(playinTeams) {
    const n = playinTeams.length;
    const size = nextPow2(n);

    const slots = [];
    for (let s = 1; s <= size; s++) {
      slots.push(playinTeams.find((t) => t._seed === s) ?? null);
    }

    const pairs = [];
    for (let i = 0; i < size / 2; i++) pairs.push([slots[i], slots[size - 1 - i]]);

    const r0 = pairs.map((pair, idx) => ({
      id: `I-R0-M${idx + 1}`,
      phase: "playins",
      roundIndex: 0,
      slotIndex: idx,
      label: `Play-ins M${idx + 1}`,
      players: pair.map((t, pi) => ({
        id: t?.id ?? `bye-${idx}-${pi}`,
        teamId: t?.id ?? null,
        name: t ? teamLabel(t) : "BYE",
        score: ""
      })),
      nextMatchId: null,
      nextSlot: null
    }));

    return [{ name: "Play-ins", index: 0, matches: r0 }];
  }

  // Wire play-in winners into playoff first round slots (so publish creates correct links)
  function wirePlayinsIntoPlayoffs(playinsRounds, playoffsRounds, advanceCount) {
    if (!playinsRounds?.length || !playoffsRounds?.length) return;

    const playinMatches = playinsRounds[0]?.matches ?? [];
    const firstRound = playoffsRounds[0]?.matches ?? [];

    const targets = [];
    for (const m of firstRound) {
      const p1 = m.players?.[0];
      const p2 = m.players?.[1];
      if (p1?.teamId == null && p1?._sourcePlayinMatchId)
        targets.push({ match: m, slot: 1, src: p1._sourcePlayinMatchId });
      if (p2?.teamId == null && p2?._sourcePlayinMatchId)
        targets.push({ match: m, slot: 2, src: p2._sourcePlayinMatchId });
    }

    const used = new Set();
    let wired = 0;

    for (const t of targets) {
      if (wired >= advanceCount) break;
      if (used.has(t.src)) continue;
      const srcMatch = playinMatches.find((pm) => pm.id === t.src);
      if (!srcMatch) continue;

      srcMatch.nextMatchId = t.match.id;
      srcMatch.nextSlot = t.slot;

      used.add(t.src);
      wired++;
    }
  }

  // ----------------------------
  // Preview model (LOCAL)
  // ----------------------------
  let preview = {
    seededAll: [],
    qualified: [],
    playoffsRounds: [],
    playinsRounds: []
  };

  function rebuildPreview() {
    const base = mergeTeamsWithStandings(teams, dashboardStandings);
    const seededAll = seedTeams(base, settings.seeding);

    const nTeams = seededAll.length;
    const qualifyCount = settings.allQualify ? nTeams : clampInt(settings.qualifyCount, 2, nTeams);
    const qualified = seededAll.slice(0, qualifyCount);

    let playinsRounds = [];
    let playoffsInput = qualified;

    if (!settings.allQualify && settings.hasPlayins) {
      const pq = clampInt(settings.playinsQualify, 2, qualifyCount - 1);
      const pa = clampInt(settings.playinsAdvance, 1, pq - 1);

      const playinTeams = qualified.slice(qualifyCount - pq);
      const locked = qualified.slice(0, qualifyCount - pa);

      const playinsSeeded = playinTeams
        .slice()
        .sort((a, b) => standingsSort(a, b))
        .map((t, i) => ({ ...t, _seed: i + 1 }));

      playinsRounds = buildPlayins(playinsSeeded);

      const playinMatches = playinsRounds[0]?.matches ?? [];
      const placeholders = Array.from({ length: pa }).map((_, i) => ({
        id: `playins-adv-${i}`,
        team_name: `Play-ins Winner ${i + 1}`,
        _seed: locked.length + i + 1,
        _sourcePlayinMatchId: playinMatches[i]?.id ?? null
      }));

      playoffsInput = locked.concat(placeholders);
    }

    let playoffsRounds = [];
    if (settings.bracketType === "weighted_byes") {
      playoffsRounds = buildWeightedByesPlayoffs(playoffsInput);
    } else {
      playoffsRounds = buildStandardPlayoffs(playoffsInput);
    }

    if (!settings.allQualify && settings.hasPlayins) {
      const pa = clampInt(settings.playinsAdvance, 1, (settings.playinsQualify ?? 2) - 1);
      const firstRound = playoffsRounds?.[0]?.matches ?? [];

      for (const m of firstRound) {
        for (const p of m.players ?? []) {
          if (p.teamId != null) continue;
          const nm = String(p.name ?? "");
          const exact = playoffsInput.find((t) => {
            if (!t?._sourcePlayinMatchId) return false;
            const want = `#${t._seed} ${t.team_name}`;
            return nm === want;
          });
          if (exact) p._sourcePlayinMatchId = exact._sourcePlayinMatchId;
        }
      }

      wirePlayinsIntoPlayoffs(playinsRounds, playoffsRounds, pa);
    }

    // Optional: include a 3rd-place match (semifinal losers)
    if (settings.includeThirdPlace) {
      ensureThirdPlaceMatch(playoffsRounds);
    }

    preview = { seededAll, qualified, playoffsRounds, playinsRounds };
    previewVersion++;
  }

  // ----------------------------
  // Preview model (DISPLAY)
  // ----------------------------
  let previewMode = "playoffs"; // playoffs | playins

  // When published, everyone should see OFFICIAL. Editor can toggle.
  let showOfficialPreview = false;
  $: showOfficialPreview = published ? showOfficialPreview : false;

  $: {
    settings;
    teams;
    dashboardStandings;
    scheduleMatches;
    rebuildPreview();
  }

  // ✅ CHANGE: when published + we have publishedPreview, ALWAYS use it for rendering the bracket
  // so the league master and normal users see the exact same bracket rendering.
  $: displayPreviewBase = published && publishedPreview ? publishedPreview : preview;

  // ----------------------------
  // Apply reported match results (from season schedule) onto the OFFICIAL bracket
  // so winners advance and scores display.
  // ----------------------------
  function applyReportedResultsToOfficialBracket(basePreview) {
    if (!basePreview) return basePreview;

    // IMPORTANT: build local team map so this function doesn't depend on reactive init ordering
    const teamByIdLocal = new Map((teams ?? []).map((t) => [Number(t.id), t]));

    const scheduleById = new Map();
    for (const m of scheduleMatches ?? []) {
      if (m?.id == null) continue;
      scheduleById.set(Number(m.id), m);
    }

    function cloneRounds(rounds) {
      return (rounds ?? []).map((r) => ({
        ...r,
        matches: (r.matches ?? []).map((mm) => ({
          ...mm,
          players: (mm.players ?? []).map((p) => ({ ...p }))
        }))
      }));
    }

    const out = {
      ...basePreview,
      playinsRounds: cloneRounds(basePreview.playinsRounds),
      playoffsRounds: cloneRounds(basePreview.playoffsRounds)
    };

    const allMatches = [
      ...(out.playinsRounds ?? []).flatMap((r) => r.matches ?? []),
      ...(out.playoffsRounds ?? []).flatMap((r) => r.matches ?? [])
    ];

    const bracketById = new Map();
    for (const bm of allMatches) {
      if (bm?.id == null) continue;
      bracketById.set(Number(bm.id), bm);
    }

    function played(sm) {
      if (!sm) return false;
      return sm.team1_score != null || sm.team2_score != null;
    }

    function winnerTeamId(sm) {
      if (!sm) return null;

      if (sm.winner_team_id != null) return Number(sm.winner_team_id);
      if (sm.winner_id != null) return Number(sm.winner_id);

      const s1 = Number(sm.team1_score ?? 0);
      const s2 = Number(sm.team2_score ?? 0);
      const t1 = sm.team1_id != null ? Number(sm.team1_id) : null;
      const t2 = sm.team2_id != null ? Number(sm.team2_id) : null;

      if (t1 == null || t2 == null) return null;
      if (s1 > s2) return t1;
      if (s2 > s1) return t2;
      return null;
    }

    function teamName(id) {
      const t = teamByIdLocal.get(Number(id));
      return t?.team_name ?? t?.name ?? `Team ${id}`;
    }

    for (const bm of allMatches) {
      const id = Number(bm.id);
      const sm = scheduleById.get(id);

      if (sm && played(sm)) {
        const s1 = sm.team1_score != null ? String(sm.team1_score) : "";
        const s2 = sm.team2_score != null ? String(sm.team2_score) : "";

        if (bm.players?.[0]) bm.players[0].score = s1;
        if (bm.players?.[1]) bm.players[1].score = s2;

        const winId = winnerTeamId(sm);

        if (winId != null && bm.nextMatchId && (bm.nextSlot === 1 || bm.nextSlot === 2)) {
          const next = bracketById.get(Number(bm.nextMatchId));
          if (next?.players?.length >= 2) {
            const slotIdx = bm.nextSlot === 1 ? 0 : 1;
            next.players[slotIdx] = {
              ...next.players[slotIdx],
              id: winId,
              teamId: winId,
              name: teamName(winId),
              score: ""
            };
          }
        }
      }
    }

    return out;
  }

  // If published, overlay reported results from schedule onto the official bracket
  $: displayPreview =
    published && publishedPreview
      ? applyReportedResultsToOfficialBracket(displayPreviewBase)
      : displayPreviewBase;

  // ✅ CHANGE: for non-edit viewers, default to the published phase
  $: {
    if (!canEdit && published) {
      previewMode = publishedPhase === "playins" ? "playins" : "playoffs";
    }
  }

  // For the team color pills we want to resolve IDs against REAL teams list, not placeholders.
  $: teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  // ----------------------------
  // Winner indicator helper
  // ----------------------------
  function winnerIndexForMatch(match) {
    if (!match?.players || match.players.length < 2) return -1;

    const a = Number(match.players[0]?.score ?? "");
    const b = Number(match.players[1]?.score ?? "");

    if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
    if (a === b) return -1;

    return a > b ? 0 : 1;
  }

  // ----------------------------
  // Bracket renderer helpers
  // ----------------------------
  const MATCH_WIDTH = 260;
  const HORIZONTAL_GAP_X = 80;
  const ROUND_GAP_X = MATCH_WIDTH + HORIZONTAL_GAP_X;
  const MATCH_HEIGHT_EST = 90;
  const MATCH_GAP_Y = 40;
  const LEFT_MARGIN = 80;
  const TOP_MARGIN = 60;

  function computeMatchPositions(rounds) {
    const positions = {};
    if (!rounds?.length) return positions;

    // Tag third-place matches
    const all = rounds.flatMap((r) => r.matches ?? []).map((m) => ({
      ...m,
      _isThirdPlace: String(m?.label ?? "").toLowerCase().includes("third")
    }));

    // Layout ONLY the main bracket; third-place is positioned afterwards
    const main = all.filter((m) => !m._isThirdPlace);
    const third = all.filter((m) => m._isThirdPlace);

    const byId = new Map(main.map((m) => [m.id, m]));

    const childrenByParentId = new Map();
    const childIds = new Set();

    for (const m of main) {
      if (!m.nextMatchId) continue;
      if (!byId.has(m.nextMatchId)) continue;

      const arr = childrenByParentId.get(m.nextMatchId) ?? [];
      arr.push(m);
      childrenByParentId.set(m.nextMatchId, arr);
      childIds.add(m.id);
    }

    const roots = main.filter((m) => !childIds.has(m.id));

    const step = MATCH_HEIGHT_EST + MATCH_GAP_Y;
    let nextLeafIndex = 0;

    // ✅ cycle guard
    const visiting = new Set();

    function assignY(match) {
      const existing = positions[match.id];
      if (existing && typeof existing.y === "number") return existing.y;

      if (visiting.has(match.id)) {
        const y = TOP_MARGIN + MATCH_HEIGHT_EST / 2 + nextLeafIndex * step;
        positions[match.id] = positions[match.id] || {};
        positions[match.id].y = y;
        nextLeafIndex++;
        return y;
      }

      visiting.add(match.id);

      const children = childrenByParentId.get(match.id) ?? [];
      let y;

      if (!children.length) {
        y = TOP_MARGIN + MATCH_HEIGHT_EST / 2 + nextLeafIndex * step;
        nextLeafIndex++;
      } else {
        const childYs = children.map(assignY);
        y = childYs.reduce((a, b) => a + b, 0) / childYs.length;
      }

      visiting.delete(match.id);

      positions[match.id] = positions[match.id] || {};
      positions[match.id].y = y;
      return y;
    }

    if (roots.length) {
      roots.forEach((root, idx) => {
        assignY(root);
        if (idx < roots.length - 1) nextLeafIndex++;
      });
    } else {
      // if everything is part of a cycle, just assign in order
      main.forEach((m) => assignY(m));
    }

    // Assign x/y for main matches
    for (const m of main) {
      const x = LEFT_MARGIN + (m.roundIndex ?? 0) * ROUND_GAP_X + MATCH_WIDTH / 2;
      const y = positions[m.id]?.y ?? TOP_MARGIN + MATCH_HEIGHT_EST / 2;
      positions[m.id] = { x, y };
    }

    // ---- Place Third Place matches close to Finals ----
    if (third.length) {
      // Determine last round index in the rendered rounds
      const lastRoundIndex = Math.max(
        ...rounds.map((r) => Number(r?.index ?? r?.roundIndex ?? 0)).filter((n) => Number.isFinite(n))
      );

      // Finals-like match to anchor under (prefer label includes "final")
      const finalsCandidate = main
        .filter((m) => Number(m.roundIndex ?? 0) === lastRoundIndex)
        .find((m) => String(m.label ?? "").toLowerCase().includes("final"));

      let anchorY = null;

      if (finalsCandidate && positions[finalsCandidate.id]) {
        anchorY = positions[finalsCandidate.id].y;
      } else {
        // fallback: lowest match in last column
        const ys = main
          .filter((m) => Number(m.roundIndex ?? 0) === lastRoundIndex)
          .map((m) => positions[m.id]?.y)
          .filter((y) => typeof y === "number");
        if (ys.length) anchorY = Math.max(...ys);
      }

      // If we still couldn't find an anchor, just stick them after the bracket
      if (anchorY == null) {
        const ysAll = Object.values(positions).map((p) => p.y);
        anchorY = ysAll.length ? Math.max(...ysAll) : TOP_MARGIN + MATCH_HEIGHT_EST / 2;
      }

      const baseY = anchorY + MATCH_HEIGHT_EST + MATCH_GAP_Y; // ✅ tight under finals

      // Place third-place matches under finals, stacked if somehow multiple exist
      third
        .slice()
        .sort((a, b) => Number(a.slotIndex ?? 0) - Number(b.slotIndex ?? 0))
        .forEach((m, idx) => {
          const x = LEFT_MARGIN + (m.roundIndex ?? lastRoundIndex) * ROUND_GAP_X + MATCH_WIDTH / 2;
          const y = baseY + idx * step;
          positions[m.id] = { x, y };
        });
    }

    return positions;
  }

  function buildConnections(rounds, pos) {
    const all = (rounds ?? []).flatMap((r) => r.matches ?? []);
    const byId = new Map(all.map((m) => [m.id, m]));
    const lines = [];

    for (const m of all) {
      if (!m.nextMatchId) continue;
      const next = byId.get(m.nextMatchId);
      if (!next) continue;

      const a = pos[m.id];
      const b = pos[next.id];
      if (!a || !b) continue;

      const from = { x: a.x + MATCH_WIDTH / 2, y: a.y };
      const to = { x: b.x - MATCH_WIDTH / 2, y: b.y };
      const midX = (from.x + to.x) / 2;

      lines.push({
        id: `${m.id}->${next.id}`,
        points: `${from.x},${from.y} ${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}`
      });
    }

    return lines;
  }

  function bracketDims(rounds, pos) {
    const ys = Object.values(pos).map((p) => p.y);
    const w = LEFT_MARGIN * 2 + (rounds.length ? rounds.length - 1 : 0) * ROUND_GAP_X + MATCH_WIDTH;
    const h = ys.length ? Math.max(...ys) + MATCH_HEIGHT_EST / 2 + TOP_MARGIN : 220;
    return { w, h };
  }

  function styleForMatch(m, pos) {
    const c = pos[m.id];
    if (!c) return "";
    return `left:${c.x - MATCH_WIDTH / 2}px; top:${c.y - MATCH_HEIGHT_EST / 2}px; width:${MATCH_WIDTH}px;`;
  }

  // ✅ safer fallbacks so this never crashes if displayPreview is temporarily null
  $: safeDisplay = displayPreview ?? { playinsRounds: [], playoffsRounds: [] };

  $: roundsToRender =
    previewMode === "playins" ? (safeDisplay.playinsRounds ?? []) : (safeDisplay.playoffsRounds ?? []);

  $: matchPositions = computeMatchPositions(roundsToRender ?? []);
  $: connectionLines = buildConnections(roundsToRender ?? [], matchPositions);
  $: dims = bracketDims(roundsToRender ?? [], matchPositions);
</script>

{#if !canEdit && !published}
  <div class="card muted">
    <div class="title">Playoffs</div>
    <div class="muted">The league master has not published the Playoffs page yet.</div>
  </div>
{:else}
  <div class="card" style="margin-top:.75rem;">
    <div class="row topbar">
      <div>
        <div class="title">Playoffs</div>
        <div class="muted">Official bracket is saved to the backend when published.</div>

        {#if standingsError}
          <div class="muted" style="margin-top:.25rem; opacity:.75;">
            Standings fetch failed: {standingsError}
          </div>
        {/if}

        {#if scheduleError}
          <div class="muted" style="margin-top:.25rem; opacity:.75;">
            Schedule fetch failed: {scheduleError}
          </div>
        {/if}

        {#if statusError}
          <div class="muted" style="margin-top:.25rem; opacity:.75;">
            Publish status fetch failed: {statusError}
          </div>
        {/if}
      </div>

      {#if canEdit}
        <div class="publishWrap">
          {#if published}
            <label class="line small">
              <input
                type="checkbox"
                checked={showOfficialPreview}
                on:change={async (e) => {
                  showOfficialPreview = e.currentTarget.checked;
                  if (showOfficialPreview) {
                    await refreshOfficialBracket();
                  }
                }}
              />
              <span>Show official preview</span>
            </label>
          {/if}

          <label class="publish">
            <input type="checkbox" checked={published} on:change={(e) => setPublished(e.currentTarget.checked)} />
            <span>Published</span>
          </label>
        </div>
      {/if}
    </div>

    <div class="divider"></div>

    {#if canEdit}
      <div class="grid">
        <section class="panel">
          <div class="panel-title">Settings</div>
          <div class="panel-sub muted">These are stored locally for now.</div>

          {#if published}
            <div class="hint muted" style="margin-top:.35rem;">
              This bracket is published. Unpublish to change settings/structure.
            </div>
          {/if}

          <div class="form2">
            <label class="line">
              <input
                type="checkbox"
                checked={settings.allQualify}
                on:change={(e) => {
                  const next = { ...settings, allQualify: e.currentTarget.checked };
                  if (next.allQualify) {
                    next.hasPlayins = false;
                    next.playinsQualify = 0;
                    next.playinsAdvance = 0;
                  }
                  persistSettings(next);
                }}
                disabled={!canEdit || structureLocked}
              />
              <span>All teams qualify</span>
            </label>

            <div class="row">
              <div class="field">
                <div class="label"># Qualify</div>
                <input
                  class="input"
                  type="number"
                  min="2"
                  max={(teams ?? []).length}
                  value={settings.allQualify ? (teams ?? []).length : settings.qualifyCount}
                  disabled={!canEdit || settings.allQualify || structureLocked}
                  on:input={(e) => {
                    const next = {
                      ...settings,
                      qualifyCount: clampInt(e.currentTarget.value, 2, (teams ?? []).length)
                    };
                    persistSettings(next);
                  }}
                />
                <div class="hint muted">Top N by the seeding rules.</div>
              </div>

              <div class="field">
                <div class="label">Seeding Type</div>
                <select
                  class="input"
                  value={settings.seeding}
                  disabled={!canEdit || structureLocked}
                  on:change={(e) => persistSettings({ ...settings, seeding: e.currentTarget.value })}
                >
                  <option value="league">League</option>
                  <option value="conference">Conference</option>
                  <option value="division">Division</option>
                </select>
                <div class="hint muted">
                  League = overall standings. Conference = a1,b1,a2,b2... Division = divs ordered by best team, then a1,b1,c1...
                </div>
              </div>
            </div>

            <div class="row">
              <div class="field">
                <div class="label">Bracket Type</div>
                <select
                  class="input"
                  value={settings.bracketType}
                  disabled={!canEdit || structureLocked}
                  on:change={(e) => persistSettings({ ...settings, bracketType: e.currentTarget.value })}
                >
                  <option value="standard">Standard</option>
                  <option value="weighted_byes">Weighted Byes (Preview)</option>
                </select>
                <div class="hint muted">Weighted Byes preview uses a simple “staggered entry” ladder-style structure.</div>

                <label class="line" style="margin-top:.5rem;">
                  <input
                    type="checkbox"
                    checked={!!settings.includeThirdPlace}
                    disabled={!canEdit || structureLocked}
                    on:change={(e) =>
                      persistSettings({ ...settings, includeThirdPlace: e.currentTarget.checked })
                    }
                  />
                  <span>Include 3rd-place match</span>
                </label>
                <div class="hint muted">Adds a Third Place match (Semifinal losers) in the final column.</div>
              </div>

              <div class="field">
                <div class="label">Play-ins</div>
                <label class="line" style="margin-top:.35rem;">
                  <input
                    type="checkbox"
                    checked={settings.hasPlayins}
                    disabled={!canEdit || settings.allQualify || structureLocked}
                    on:change={(e) => {
                      const on = e.currentTarget.checked;
                      const next = { ...settings, hasPlayins: on };
                      if (!on) {
                        next.playinsQualify = 0;
                        next.playinsAdvance = 0;
                      } else {
                        const qc = settings.allQualify ? (teams ?? []).length : settings.qualifyCount;
                        next.playinsQualify = clampInt(next.playinsQualify || 4, 2, qc - 1);
                        next.playinsAdvance = clampInt(next.playinsAdvance || 2, 1, next.playinsQualify - 1);
                      }
                      persistSettings(next);
                    }}
                  />
                  <span>Enable play-ins</span>
                </label>

                {#if settings.allQualify}
                  <div class="hint muted">Play-ins disabled when all teams qualify.</div>
                {/if}

                {#if settings.hasPlayins && !settings.allQualify}
                  <div class="row" style="margin-top:.5rem;">
                    <div class="field">
                      <div class="label">Teams in Play-ins</div>
                      <input
                        class="input"
                        type="number"
                        min="2"
                        max={Math.max(2, (settings.qualifyCount ?? 2) - 1)}
                        value={settings.playinsQualify}
                        disabled={!canEdit || structureLocked}
                        on:input={(e) => {
                          const qc = settings.qualifyCount ?? 2;
                          const pq = clampInt(e.currentTarget.value, 2, qc - 1);
                          const pa = clampInt(settings.playinsAdvance, 1, pq - 1);
                          persistSettings({ ...settings, playinsQualify: pq, playinsAdvance: pa });
                        }}
                      />
                    </div>

                    <div class="field">
                      <div class="label">Advance to Playoffs</div>
                      <input
                        class="input"
                        type="number"
                        min="1"
                        max={Math.max(1, (settings.playinsQualify ?? 2) - 1)}
                        value={settings.playinsAdvance}
                        disabled={!canEdit || structureLocked}
                        on:input={(e) => {
                          const pa = clampInt(e.currentTarget.value, 1, (settings.playinsQualify ?? 2) - 1);
                          persistSettings({ ...settings, playinsQualify: settings.playinsQualify, playinsAdvance: pa });
                        }}
                      />
                    </div>
                  </div>

                  <div class="hint muted" style="margin-top:.35rem;">
                    Play-ins teams are the <b>bottom</b> X among qualified. Their winners fill the last Y playoff slots.
                  </div>
                {/if}
              </div>
            </div>

            <div class="divider"></div>

            <div class="panel-title">Preview Controls</div>
            <div class="row" style="margin-top:.5rem;">
              <button
                class="btn {previewMode === 'playoffs' ? 'active' : ''}"
                on:click={() => (previewMode = "playoffs")}
              >
                Playoffs Preview
              </button>

              <button
                class="btn {previewMode === 'playins' ? 'active' : ''}"
                disabled={!safeDisplay.playinsRounds.length}
                on:click={() => (previewMode = "playins")}
              >
                Play-ins Preview
              </button>
            </div>

            {#if published && showOfficialPreview && !publishedPreview}
              <div class="hint muted" style="margin-top:.5rem;">
                Official bracket preview not available yet (failed to load). Toggle off “Show official preview” to see local preview.
              </div>
            {/if}
          </div>
        </section>

        <section class="panel">
          <div class="panel-title">Qualified Teams</div>
          <div class="panel-sub muted">Based on the current standings + your seeding rules.</div>

          {#if !preview.qualified?.length}
            <div class="muted">No teams available.</div>
          {:else}
            <div class="seedlist">
              {#each preview.qualified as t (t.id)}
                <div class="seedrow" style={teamPillStyle(t)}>
                  <div class="seed">#{t._seed}</div>
                  <div class="name">{t.team_name}</div>
                  <div class="meta muted">
                    {#if t.conference}<span>Conf: {t.conference}</span>{/if}
                    {#if t.division}<span>• Div: {t.division}</span>{/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      </div>

      <div class="divider"></div>

      <section class="panel">
        <div class="panel-title">
          {previewMode === "playins" ? "Play-ins Bracket Preview" : "Playoffs Bracket Preview"}
        </div>
        <div class="panel-sub muted">
          This is a <b>{published && showOfficialPreview ? "published (official)" : "structure (local)"} preview</b>.
        </div>

        {#if previewMode === "playins" && !safeDisplay.playinsRounds.length}
          <div class="muted">Play-ins are not enabled (or not valid) with current settings.</div>
        {:else}
          {#key `${previewMode}:${previewVersion}:${published ? "pub" : "draft"}:${showOfficialPreview ? "official" : "local"}`}
            <div class="bracket-shell">
              {#if !(roundsToRender ?? []).length}
                <div class="muted">No bracket to display.</div>
              {:else}
                <div class="bracket-container" style={`width:${dims.w}px; height:${dims.h}px;`}>
                  <svg
                    class="connections"
                    xmlns="http://www.w3.org/2000/svg"
                    width={dims.w}
                    height={dims.h}
                    viewBox={`0 0 ${dims.w} ${dims.h}`}
                  >
                    {#each connectionLines as line (line.id)}
                      <polyline points={line.points} />
                    {/each}
                  </svg>

                  {#each roundsToRender as round (round.index)}
                    {#each round.matches as match (match.id)}
                      {@const wIdx = winnerIndexForMatch(match)}
                      <div class="match-box" style={styleForMatch(match, matchPositions)}>
                        <div class="match-header">
                          <span class="match-label">{match.label}</span>
                          <span class="match-meta muted">
                            {published && showOfficialPreview ? "Official" : "Preview"}
                          </span>
                        </div>

                        <div class="players">
                          {#each match.players as p, idx (p.id)}
                            <div
                              class="player-row {wIdx === idx ? 'winner' : ''}"
                              style={p.teamId ? teamPillStyle(teamById.get(p.teamId)) : ""}
                              title={wIdx === idx ? "Winner" : ""}
                            >
                              <span class="player-name">
                                {p.name}
                                {#if wIdx === idx}
                                  <span class="winner-mark" aria-label="Winner">✓</span>
                                {/if}
                              </span>
                              <span class="player-score">{p.score}</span>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/each}
                  {/each}

                  {#each roundsToRender as round (round.index)}
                    <div
                      class="round-label"
                      style={`left:${LEFT_MARGIN + round.index * ROUND_GAP_X + MATCH_WIDTH / 2}px; top: 16px;`}
                    >
                      {round.name}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/key}
        {/if}
      </section>
    {:else}
      <section class="panel">
        <div class="panel-title">Playoffs Bracket</div>
        <div class="panel-sub muted">This is the published bracket.</div>

        {#if !publishedPreview || !(roundsToRender ?? []).length}
          <div class="muted">Published bracket failed to load (or is empty).</div>
        {:else}
          <div class="bracket-published-shell">
            <div class="bracket-container" style={`width:${dims.w}px; height:${dims.h}px;`}>
              <svg
                class="connections"
                xmlns="http://www.w3.org/2000/svg"
                width={dims.w}
                height={dims.h}
                viewBox={`0 0 ${dims.w} ${dims.h}`}
              >
                {#each connectionLines as line (line.id)}
                  <polyline points={line.points} />
                {/each}
              </svg>

              {#each roundsToRender as round (round.index)}
                {#each round.matches as match (match.id)}
                  {@const wIdx = winnerIndexForMatch(match)}
                  <div class="match-box" style={styleForMatch(match, matchPositions)}>
                    <div class="match-header">
                      <span class="match-label">{match.label}</span>
                      <span class="match-meta muted">Official</span>
                    </div>

                    <div class="players">
                      {#each match.players as p, idx (p.id)}
                        <div
                          class="player-row {wIdx === idx ? 'winner' : ''}"
                          style={p.teamId ? teamPillStyle(teamById.get(p.teamId)) : ""}
                          title={wIdx === idx ? "Winner" : ""}
                        >
                          <span class="player-name">
                            {p.name}
                            {#if wIdx === idx}
                              <span class="winner-mark" aria-label="Winner">✓</span>
                            {/if}
                          </span>
                          <span class="player-score">{p.score}</span>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/each}
              {/each}

              {#each roundsToRender as round (round.index)}
                <div
                  class="round-label"
                  style={`left:${LEFT_MARGIN + round.index * ROUND_GAP_X + MATCH_WIDTH / 2}px; top: 16px;`}
                >
                  {round.name}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .publishWrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
  }

  .publish {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 900;
    user-select: none;
  }
  .publish input {
    width: 18px;
    height: 18px;
  }

  .small {
    font-size: 0.85rem;
    opacity: 0.9;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  @media (min-width: 980px) {
    .grid {
      grid-template-columns: 1.15fr 0.85fr;
    }
  }

  .panel {
    border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    padding: 12px;
  }
  .panel-title {
    font-weight: 900;
    font-size: 1rem;
  }
  .panel-sub {
    margin-top: 2px;
    margin-bottom: 10px;
    color: rgba(255, 255, 255, 0.7);
  }

  .form2 {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .line {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 900;
    user-select: none;
  }
  .line input {
    width: 18px;
    height: 18px;
  }

  .row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  @media (min-width: 980px) {
    .row {
      grid-template-columns: 1fr 1fr;
    }
  }

  .field .label {
    font-weight: 900;
    font-size: 0.9rem;
    margin-bottom: 6px;
    color: rgba(255, 255, 255, 0.86);
  }

  .hint {
    margin-top: 6px;
    font-size: 0.85rem;
  }

  .input {
    width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.18);
    color: rgba(255, 255, 255, 0.92);
    padding: 0.55rem 0.75rem;
    outline: none;
  }

  .seedlist {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .seedrow {
    display: grid;
    grid-template-columns: 60px 1fr;
    gap: 10px;
    padding: 10px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.07);
  }
  .seed {
    font-weight: 900;
    opacity: 0.92;
  }
  .name {
    font-weight: 900;
  }
  .meta {
    grid-column: 1 / -1;
    margin-top: 2px;
    opacity: 0.85;
  }

  .btn {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.92);
    padding: 0.55rem 0.9rem;
    border-radius: 12px;
    cursor: pointer;
    font-weight: 900;
    justify-self: start;
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.active {
    background: rgba(255, 107, 107, 0.22);
    border-color: rgba(255, 107, 107, 0.35);
    color: white;
  }

  .divider {
    margin: 0.9rem 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
  }

  .bracket-shell {
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 6px;
  }

  .bracket-published-shell {
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 6px;
  }

  .bracket-container {
    position: relative;
    border-radius: 0.75rem;
    background: radial-gradient(
      circle at top left,
      rgba(27, 36, 64, 0.85),
      rgba(5, 8, 19, 0.85)
    );
    overflow: visible;
  }

  .connections {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  }

  .connections polyline {
    fill: none;
    stroke: rgba(200, 200, 220, 0.35);
    stroke-width: 2;
  }

  .match-box {
    position: absolute;
    z-index: 2;
    background: rgba(16, 23, 48, 0.95);
    border-radius: 0.6rem;
    border: 1px solid rgba(180, 190, 220, 0.2);
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
    padding: 0.35rem 0.55rem 0.4rem;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-height: 90px;
    height: auto; 
  }

  .match-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.9;
  }

  .players {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .player-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    font-size: 0.85rem;
    padding: 0.15rem 0.25rem;
    border-radius: 0.4rem;
    border-left: 3px solid transparent;
  }

  /* ✅ Winner indicator (subtle) */
  .player-row.winner {
    outline: 1px solid rgba(255, 255, 255, 0.22);
    box-shadow: inset 0 0 0 9999px rgba(255, 255, 255, 0.06);
  }

  .winner-mark {
    margin-left: 8px;
    font-size: 0.8rem;
    font-weight: 900;
    opacity: 0.9;
  }

  .player-name {
    white-space: normal;
    overflow-wrap: anywhere; 
    word-break: break-word;
    font-weight: 800;
    line-height: 1.15;
    min-width: 0;
  }

  .round-label {
    position: absolute;
    transform: translateX(-50%);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.7;
    pointer-events: none;
  }

  .player-score {
    margin-left: 0;
    font-weight: 900;
    opacity: 0.9;
    justify-self: end;
    white-space: nowrap;
  }
</style>