<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { getSeasonDashboard, getSeasonSchedule } from "../lib/api.js";

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
  // Published gate (local only)
  // ----------------------------
  let published = false;

  $: {
    const k = `${keyBase()}.published`;
    published = loadJson(k, false);
    dispatch("publishedChanged", { published });
  }

  function setPublished(next) {
    if (!canEdit) return;
    const k = `${keyBase()}.published`;
    saveJson(k, !!next);
    published = !!next;
    dispatch("publishedChanged", { published });
  }

  // ----------------------------
  // Settings (local only)
  // ----------------------------
  const DEFAULTS = {
    allQualify: true,
    qualifyCount: 0, // used when allQualify=false
    hasPlayins: false,
    playinsQualify: 0,
    playinsAdvance: 0,
    seeding: "league", // "league" | "conference" | "division"
    bracketType: "standard" // "standard" | "weighted_byes"
  };

  let settings = { ...DEFAULTS };
  let previewVersion = 0;

  function clampInt(x, lo, hi) {
    const n = Number(x);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, Math.trunc(n)));
  }

  function persistSettings(next) {
    const normalized = normalizeSettings(next, (teams ?? []).length);
    settings = normalized;

    const k = `${keyBase()}.settings`;
    saveJson(k, normalized);

    // force preview remount + recompute
    previewVersion++;
  }

  function normalizeSettings(raw, teamsCount) {
    const base = { ...DEFAULTS, ...(raw ?? {}) };

    const nTeams = teamsCount ?? 0;

    if (base.allQualify) {
      return {
        ...base,
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
        qualifyCount,
        playinsQualify: 0,
        playinsAdvance: 0
      };
    }

    const playinsQualify = clampInt(base.playinsQualify || 4, 2, qualifyCount - 1);
    const playinsAdvance = clampInt(base.playinsAdvance || 2, 1, playinsQualify - 1);

    return {
      ...base,
      qualifyCount,
      playinsQualify,
      playinsAdvance
    };
  }

  $: settingsKey = `${keyBase()}.settings`;

  $: {
    // only re-hydrate when the *key* changes (league/season swap) or teams count changes
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

  // “Dim” a team color by blending it toward the panel background and keeping it subtle.
  // t=0 => original, t=1 => background
  function dimHex(hex, t = 0.15) {
    const c = hexToRgb(hex);
    if (!c) return null;
    const bg = { r: 22, g: 32, b: 64 }; // roughly your app bg (#0b1020)
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
    const bg = dimHex(base, 0.74) ?? base; // a touch more muted
    const fg = textColorForBg(bg) ?? "#ffffff";
    // lower-contrast border + slight transparency to soften
    return `background:${bg}; color:${fg}; border-color: rgba(255,255,255,0.14);`;
  }

  // ----------------------------
  // Standings source (season dashboard)
  // ----------------------------
  let dashboardStandings = null; // array or null
  let standingsError = "";

  async function loadDashboardStandings() {
    standingsError = "";
    dashboardStandings = null;
    if (!seasonId) return;

    try {
      const dash = await getSeasonDashboard(seasonId, leagueId);
      // Try common shapes:
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
    // reload when swapping seasons/leagues
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
      scheduleMatches = Array.isArray(out) ? out : (out?.matches ?? []);
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

  // Derived standings from schedule (regular season only)
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

      // Prefer IDs if present
      let t1Id = m.team1_id ?? null;
      let t2Id = m.team2_id ?? null;

      // Fallback: map by team name if needed
      if (t1Id == null || t2Id == null) {
        const t1 = (teams ?? []).find((t) => t?.team_name === m.team1_name);
        const t2 = (teams ?? []).find((t) => t?.team_name === m.team2_name);
        t1Id = t1?.id ?? null;
        t2Id = t2?.id ?? null;
      }

      if (t1Id == null || t2Id == null) continue;

      const s1 = m.team1_score ?? 0;
      const s2 = m.team2_score ?? 0;

      // Skip unplayed matches (treat null scores as unplayed).
      // If 0-0 can be a legit played result for you, tweak this.
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
    // ---- rank (lower is better) ----
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

    // ---- wins (higher is better) ----
    const wa =
      seasonWinsByTeamId[a?.id] ??
      firstNumOrNull(
        a?.season_wins,
        a?.wins,
        a?.standing?.wins,
        a?.standings?.wins,
        a?.record?.wins,
        a?.record?.w
      ) ??
      0;

    const wb =
      seasonWinsByTeamId[b?.id] ??
      firstNumOrNull(
        b?.season_wins,
        b?.wins,
        b?.standing?.wins,
        b?.standings?.wins,
        b?.record?.wins,
        b?.record?.w
      ) ??
      0;

    if (wb !== wa) return wb - wa;

    // ---- differential (higher is better) ----
    const da =
      seasonDiffByTeamId[a?.id] ??
      firstNumOrNull(
        a?.differential,
        a?.diff,
        a?.standing?.differential,
        a?.standing?.diff,
        a?.standings?.differential,
        a?.standings?.diff,
        a?.record?.diff
      ) ??
      0;

    const db =
      seasonDiffByTeamId[b?.id] ??
      firstNumOrNull(
        b?.differential,
        b?.diff,
        b?.standing?.differential,
        b?.standing?.diff,
        b?.standings?.differential,
        b?.standings?.diff,
        b?.record?.diff
      ) ??
      0;

    if (db !== da) return db - da;

    // ---- losses (lower is better) ----
    const la =
      seasonLossesByTeamId[a?.id] ??
      firstNumOrNull(
        a?.season_losses,
        a?.losses,
        a?.standing?.losses,
        a?.standings?.losses,
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
        b?.standings?.losses,
        b?.record?.losses,
        b?.record?.l
      ) ??
      0;

    if (la !== lb) return la - lb;

    return (a?.team_name ?? "").localeCompare(b?.team_name ?? "");
  }

  // Build a standings-ordered list by *joining* dashboard standings (rank/wins/etc)
  // onto the teams array you pass into this component.
  function mergeTeamsWithStandings(teamsList, standingsList) {
    const teamsSafe = (teamsList ?? []).filter((t) => t && t.id != null);

    if (!Array.isArray(standingsList) || standingsList.length === 0) {
      return teamsSafe.slice(); // fallback (we still have schedule-derived maps)
    }

    const byId = new Map(teamsSafe.map((t) => [Number(t.id), t]));

    const merged = [];
    for (const row of standingsList) {
      // dashboard rows might be { team_id, team_name, wins, ... } or nested
      const teamId = firstNumOrNull(row?.team_id, row?.teamId, row?.team?.id);
      if (teamId == null) continue;

      const base = byId.get(Number(teamId));
      if (!base) continue;

      // Overlay standings fields onto the team object so standingsSort can use them.
      merged.push({
        ...base,
        team_name: base.team_name ?? row?.team_name ?? row?.name ?? base.name,
        regular_season_rank: firstNumOrNull(row?.regular_season_rank, row?.rank, row?.place),
        season_wins: firstNumOrNull(row?.season_wins, row?.wins, row?.record?.wins, row?.record?.w),
        season_losses: firstNumOrNull(row?.season_losses, row?.losses, row?.record?.losses, row?.record?.l),
        differential: firstNumOrNull(row?.differential, row?.diff, row?.record?.diff)
      });
    }

    // include teams missing from standings (end of list)
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
      roundIndex: 0,
      slotIndex: idx,
      label: roundNames[0] ? `${roundNames[0]} M${idx + 1}` : `Match ${idx + 1}`,
      players: pair.map((t) => ({
        id: t?.id ?? `bye-${idx}`,
        teamId: t?.id ?? null,
        name: t ? teamLabel(t) : "BYE",
        score: ""
      })),
      nextMatchId: null
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
          roundIndex: roundIdx,
          slotIndex: i,
          label: roundNames[roundIdx]
            ? `${roundNames[roundIdx]} M${i + 1}`
            : `Round ${roundIdx + 1} M${i + 1}`,
          players: [
            { id: `tbd-${roundIdx}-${i}-a`, teamId: null, name: "TBD", score: "" },
            { id: `tbd-${roundIdx}-${i}-b`, teamId: null, name: "TBD", score: "" }
          ],
          nextMatchId: null
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
      }

      prevCount = count;
      roundIdx++;
    }

    return rounds;
  }

  function buildWeightedByesPlayoffs(qualified) {
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

    function mkMatch(roundIndex, slotIndex, label, slotA, slotB) {
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

      return {
        id,
        roundIndex,
        slotIndex,
        label,
        players: [
          { id: slotId(top, `tbd-${id}-a`), teamId: slotTeamId(top), name: slotLabel(top), score: "" },
          { id: slotId(bot, `tbd-${id}-b`), teamId: slotTeamId(bot), name: slotLabel(bot), score: "" }
        ],
        nextMatchId: null
      };
    }

    function playOrAdvance(roundIndex, slotIndex, label, slotA, slotB, roundBuckets) {
      if (slotA && !slotB) return slotA;
      if (!slotA && slotB) return slotB;
      if (!slotA && !slotB) return null;

      const m = mkMatch(roundIndex, slotIndex, label, slotA, slotB);
      roundBuckets[roundIndex].push(m);

      if (slotA?.kind === "match") slotA.match.nextMatchId = m.id;
      if (slotB?.kind === "match") slotB.match.nextMatchId = m.id;

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

  function buildPlayins(playinTeams, advanceCount) {
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
      roundIndex: 0,
      slotIndex: idx,
      label: `Play-ins M${idx + 1}`,
      players: pair.map((t) => ({
        id: t?.id ?? `bye-${idx}`,
        teamId: t?.id ?? null,
        name: t ? teamLabel(t) : "BYE",
        score: ""
      })),
      nextMatchId: null
    }));

    return [
      { name: "Play-ins", index: 0, matches: r0 },
      {
        name: "Advance",
        index: 1,
        matches: Array.from({ length: advanceCount }).map((_, i) => ({
          id: `I-ADV-${i + 1}`,
          roundIndex: 1,
          slotIndex: i,
          label: `Advances to Playoffs #${i + 1}`,
          players: [{ id: `adv-${i}-a`, teamId: null, name: "TBD", score: "" }],
          nextMatchId: null
        }))
      }
    ];
  }

  // ----------------------------
  // Preview model
  // ----------------------------
  let preview = {
    seededAll: [],
    qualified: [],
    playoffsRounds: [],
    playinsRounds: []
  };

  function rebuildPreview() {
    // IMPORTANT: order comes from dashboard standings if available,
    // otherwise from schedule-derived standings maps (wins/diff/losses).
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

      const advancers = Array.from({ length: pa }).map((_, i) => ({
        id: `playins-adv-${i}`,
        team_name: `Play-ins Winner ${i + 1}`,
        _seed: locked.length + i + 1
      }));

      playoffsInput = locked.concat(advancers);
      playinsRounds = buildPlayins(playinTeams, pa);
    }

    let playoffsRounds = [];
    if (settings.bracketType === "weighted_byes") {
      playoffsRounds = buildWeightedByesPlayoffs(playoffsInput);
    } else {
      playoffsRounds = buildStandardPlayoffs(playoffsInput);
    }

    preview = { seededAll, qualified, playoffsRounds, playinsRounds };
    previewVersion++;
  }

  // UI state
  let previewMode = "playoffs"; // "playoffs" | "playins"

  $: {
    settings;
    teams;
    previewMode;
    dashboardStandings;
    scheduleMatches;
    rebuildPreview();
  }

  $: teamById = new Map((preview.seededAll ?? []).map((t) => [t.id, t]));

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
    if (!rounds.length) return positions;

    const all = rounds.flatMap((r) => r.matches);
    const byId = new Map(all.map((m) => [m.id, m]));

    const childrenByParentId = new Map();
    const childIds = new Set();

    for (const m of all) {
      if (!m.nextMatchId) continue;
      if (!byId.has(m.nextMatchId)) continue;
      const arr = childrenByParentId.get(m.nextMatchId) ?? [];
      arr.push(m);
      childrenByParentId.set(m.nextMatchId, arr);
      childIds.add(m.id);
    }

    const roots = all.filter((m) => !childIds.has(m.id));

    const step = MATCH_HEIGHT_EST + MATCH_GAP_Y;
    let nextLeafIndex = 0;

    function assignY(match) {
      const existing = positions[match.id];
      if (existing && typeof existing.y === "number") return existing.y;

      const children = childrenByParentId.get(match.id) ?? [];
      if (!children.length) {
        const y = TOP_MARGIN + MATCH_HEIGHT_EST / 2 + nextLeafIndex * step;
        nextLeafIndex++;
        positions[match.id] = positions[match.id] || {};
        positions[match.id].y = y;
        return y;
      } else {
        const childYs = children.map(assignY);
        const y = childYs.reduce((a, b) => a + b, 0) / childYs.length;
        positions[match.id] = positions[match.id] || {};
        positions[match.id].y = y;
        return y;
      }
    }

    roots.forEach((root, idx) => {
      assignY(root);
      if (idx < roots.length - 1) nextLeafIndex++;
    });

    for (const m of all) {
      const x = LEFT_MARGIN + (m.roundIndex ?? 0) * ROUND_GAP_X + MATCH_WIDTH / 2;
      const y = positions[m.id]?.y ?? TOP_MARGIN + MATCH_HEIGHT_EST / 2;
      positions[m.id] = { x, y };
    }

    return positions;
  }

  function buildConnections(rounds, pos) {
    const all = rounds.flatMap((r) => r.matches);
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
    const w =
      LEFT_MARGIN * 2 +
      (rounds.length ? rounds.length - 1 : 0) * ROUND_GAP_X +
      MATCH_WIDTH;

    const h = ys.length ? Math.max(...ys) + MATCH_HEIGHT_EST / 2 + TOP_MARGIN : 220;
    return { w, h };
  }

  function styleForMatch(m, pos) {
    const c = pos[m.id];
    if (!c) return "";
    return `left:${c.x - MATCH_WIDTH / 2}px; top:${c.y - MATCH_HEIGHT_EST / 2}px; width:${MATCH_WIDTH}px;`;
  }

  $: roundsToRender = previewMode === "playins" ? preview.playinsRounds : preview.playoffsRounds;
  $: matchPositions = computeMatchPositions(roundsToRender ?? []);
  $: connectionLines = buildConnections(roundsToRender ?? [], matchPositions);
  $: dims = bracketDims(roundsToRender ?? [], matchPositions);
</script>

{#if !canEdit && !published}
  <div class="card muted">
    <div class="title">Playoffs</div>
    <div class="muted">
      The league master has not published the Playoffs page yet.
    </div>
  </div>
{:else}
  <div class="card" style="margin-top:.75rem;">
    <div class="row topbar">
      <div>
        <div class="title">Playoffs</div>
        <div class="muted">Frontend-only preview (no backend writes yet).</div>

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
      </div>

      {#if canEdit}
        <label class="publish">
          <input
            type="checkbox"
            checked={published}
            on:change={(e) => setPublished(e.currentTarget.checked)}
          />
          <span>Published</span>
        </label>
      {/if}
    </div>

    <div class="divider"></div>

    <div class="grid">
      <section class="panel">
        <div class="panel-title">Settings</div>
        <div class="panel-sub muted">These are stored locally for now.</div>

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
              disabled={!canEdit}
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
                disabled={!canEdit || settings.allQualify}
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
                disabled={!canEdit}
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
                disabled={!canEdit}
                on:change={(e) => persistSettings({ ...settings, bracketType: e.currentTarget.value })}
              >
                <option value="standard">Standard</option>
                <option value="weighted_byes">Weighted Byes (Preview)</option>
              </select>
              <div class="hint muted">
                Weighted Byes preview uses a simple “staggered entry” ladder-style structure.
              </div>
            </div>

            <div class="field">
              <div class="label">Play-ins</div>
              <label class="line" style="margin-top:.35rem;">
                <input
                  type="checkbox"
                  checked={settings.hasPlayins}
                  disabled={!canEdit || settings.allQualify}
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
                      disabled={!canEdit}
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
                      disabled={!canEdit}
                      on:input={(e) => {
                        const pa = clampInt(e.currentTarget.value, 1, (settings.playinsQualify ?? 2) - 1);
                        persistSettings({ ...settings, playinsAdvance: pa });
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
              disabled={!preview.playinsRounds.length}
              on:click={() => (previewMode = "playins")}
            >
              Play-ins Preview
            </button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">Qualified Teams</div>
        <div class="panel-sub muted">Based on the current standings + your seeding rules.</div>

        {#if !preview.qualified.length}
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
        This is a <b>structure preview</b>.
      </div>

      {#if previewMode === "playins" && !preview.playinsRounds.length}
        <div class="muted">Play-ins are not enabled (or not valid) with current settings.</div>
      {:else}
        {#key `${previewMode}:${previewVersion}`}
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
                    <div class="match-box" style={styleForMatch(match, matchPositions)}>
                      <div class="match-header">
                        <span class="match-label">{match.label}</span>
                        <span class="match-meta muted">Preview</span>
                      </div>

                      <div class="players">
                        {#each match.players as p (p.id)}
                          <div
                            class="player-row"
                            style={p.teamId ? teamPillStyle(teamById.get(p.teamId)) : ""}
                          >
                            <span class="player-name">{p.name}</span>
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
  </div>
{/if}

<style>
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
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
    /* background color is injected inline per team */
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
    opacity: 0.85; /* soften the meta over colored bg */
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

  /* bracket visuals */
  .bracket-shell {
    overflow: auto;
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
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    padding: 0.15rem 0.25rem;
    border-radius: 0.4rem;
    border-left: 3px solid transparent;
    /* background color injected inline when we know teamId */
  }

  .player-name {
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
    font-weight: 800;
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
</style>
