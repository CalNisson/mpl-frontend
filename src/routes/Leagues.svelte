<script>
  import { onMount, tick } from "svelte";
  import { leagueContext, setLeague } from "../lib/leagueStore.js";
  import {
    getMe,
    getLeagueMe,
    getSeasons,
    getSeasonDashboard,
    createSeason,
    getCoachSeasonDetails,
    getCoaches,
    getSeasonTeams,
    updateLeagueRules
  } from "../lib/api.js";

  import StandingsTable from "../components/StandingsTable.svelte";
  import PokemonLeaderboard from "../components/PokemonLeaderboard.svelte";
  import TierListEditor from "../components/TierListEditor.svelte";
  import DraftManager from "../components/DraftManager.svelte";
  import TransactionsManager from "../components/TransactionsManager.svelte";
  import SeasonTeamsManager from "../components/SeasonTeamsManager.svelte";
  import MatchReporting from "../components/MatchReporting.svelte";
  import PlayoffsPlanner from "../components/PlayoffsPlanner.svelte";
  import SeasonSchedule from "../components/SeasonSchedule.svelte";
  import { clearApiCache } from "../lib/api.js";

  // ----------------------------
  // League Rules
  // ----------------------------
  let rulesMd = "";
  let rulesDraft = "";
  let editingRules = false;
  let savingRules = false;
  let rulesMsg = "";
  let rulesError = "";

  function loadLeagueRules() {
    rulesMd = (ctx?.league?.rules ?? "").toString();
    rulesDraft = rulesMd;
    editingRules = false;
    rulesMsg = "";
    rulesError = "";
  }

  async function saveLeagueRules() {
    rulesMsg = "";
    rulesError = "";
    const leagueId = ctx?.league?.id ?? null;
    if (!leagueId) {
      rulesError = "No league selected.";
      return;
    }

    savingRules = true;
    try {
      const updated = await updateLeagueRules(leagueId, rulesDraft ?? "");
      rulesMd = updated?.rules ?? (rulesDraft ?? "");
      rulesDraft = rulesMd;
      // Keep leagueContext in sync so it persists & other pages see updated rules
      setLeague({ ...(ctx?.league ?? {}), rules: rulesMd });
      editingRules = false;
      rulesMsg = "Rules saved.";
    } catch (e) {
      rulesError = e?.message || String(e);
    } finally {
      savingRules = false;
    }
  }

  function escapeHtml(s) {
    return (s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Minimal markdown renderer for PoC (headings, bold/italic, links, lists, inline code)
  function renderMarkdown(md) {
    const src = (md ?? "").toString().replace(/\r\n/g, "\n");
    if (!src.trim()) return '<div class="muted">No rules yet.</div>';

    const lines = src.split("\n");
    let html = "";

    // list nesting depth (0 = not in list)
    let listDepth = 0;

    const escapeHtml = (s) =>
      (s ?? "")
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const inline = (t) => {
      let out = escapeHtml(t);
      out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      out = out.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
      );
      return out;
    };

    function closeLists(toDepth = 0) {
      while (listDepth > toDepth) {
        html += "</ul>";
        listDepth -= 1;
      }
    }

    function openLists(toDepth) {
      while (listDepth < toDepth) {
        html += "<ul>";
        listDepth += 1;
      }
    }

    // 2 spaces == 1 nesting level (common markdown behavior)
    function indentToDepth(indentStr) {
      const expanded = indentStr.replace(/\t/g, "  ");
      const spaces = expanded.length;
      return Math.floor(spaces / 2) + 1; // +1 because depth=1 means "inside a <ul>"
    }

    for (const rawLine of lines) {
      const line = rawLine ?? "";
      const trimmed = line.trim();

      const h3 = trimmed.match(/^###\s+(.+)$/);
      const h2 = trimmed.match(/^##\s+(.+)$/);
      const h1 = trimmed.match(/^#\s+(.+)$/);

      // capture indent BEFORE the bullet
      const li = line.match(/^(\s*)[-*]\s+(.+)$/);

      if (h1 || h2 || h3) {
        closeLists(0);
        const tag = h1 ? "h2" : h2 ? "h3" : "h4";
        const text = (h1 ?? h2 ?? h3)[1];
        html += `<${tag}>${inline(text)}</${tag}>`;
        continue;
      }

      if (li) {
        const indent = li[1] ?? "";
        const text = li[2] ?? "";

        const targetDepth = indentToDepth(indent);

        // If we were in a list and depth decreases/increases, adjust
        if (listDepth > targetDepth) closeLists(targetDepth);
        if (listDepth < targetDepth) openLists(targetDepth);

        // Ensure we have at least one list open for any list item
        if (listDepth === 0) openLists(1);

        html += `<li>${inline(text)}</li>`;
        continue;
      }

      if (!trimmed) {
        closeLists(0);
        html += '<div class="md-spacer"></div>';
        continue;
      }

      closeLists(0);
      html += `<p>${inline(line)}</p>`;
    }

    closeLists(0);
    return html;
  }


  $: ctx = $leagueContext;
  $: hasOrg = !!ctx?.organization;
  $: hasLeague = !!ctx?.league;

  // ---- user / permissions ----
  let me = null;
  let leagueMe = null;
  let loadingMe = false;
  let loadingLeagueMe = false;

  $: globalRoles = me?.roles ?? [];
  $: isAdmin = globalRoles.includes("admin");

  $: leagueRoles = leagueMe?.league_roles ?? [];
  $: isLeagueMaster = isAdmin || leagueRoles.includes("league_master");

  let error = "";
  let success = "";

  function resetMessages() {
    error = "";
    success = "";
  }

  async function loadMe() {
    loadingMe = true;
    try {
      me = await getMe();
    } catch {
      me = null;
    } finally {
      loadingMe = false;
    }
  }

  async function loadLeagueMe() {
    leagueMe = null;
    if (!hasLeague) return;

    loadingLeagueMe = true;
    try {
      leagueMe = await getLeagueMe();
    } catch {
      leagueMe = null;
    } finally {
      loadingLeagueMe = false;
    }
  }

  // ---- Seasons + Active season + dashboard ----
  let seasons = [];
  let loadingSeason = false;
  let activeSeason = null;
  let dashboard = null;
  let loadingDashboard = false;

  $: activeSeason =
    seasons.find((s) => (s?.status ?? "").toLowerCase() === "active") ?? null;

  async function refreshSeasonsAndMaybeDashboard() {
    if (!hasLeague) {
      seasons = [];
      dashboard = null;
      return;
    }

    resetMessages();

    loadingSeason = true;
    try {
      clearApiCache("seasons:");
      seasons = await getSeasons();

      // ✅ let reactive `$: activeSeason = ...` recompute before we read it
      await tick();
    } catch (e) {
      seasons = [];
      dashboard = null;
      error = e?.message ?? String(e);
      return;
    } finally {
      loadingSeason = false;
    }

    dashboard = null;
    if (!activeSeason?.id) return;

    loadingDashboard = true;
    try {
      dashboard = await getSeasonDashboard(activeSeason.id);
    } catch (e) {
      dashboard = null;
      error = e?.message ?? String(e);
    } finally {
      loadingDashboard = false;
    }
  }

  // ---- Tabs ----
  const BASE_TABS = [
    "Overview",
    "Leaderboard",
    "Teams",
    "Tier List",
    "Draft",
    "Schedule",
    "Transactions",
    "Playoffs"
  ];

  // Tabs that depend on permissions (avoid referencing `tabs` from any reactive block that also triggers `loadLeagueMe()`)
  $: tabs = BASE_TABS.concat(isLeagueMaster ? ["Match Reporting"] : []);

  // Tabs that can legitimately be missing until permissions finish loading.
  // This prevents a refresh on a protected tab from briefly failing `tabs.includes(tab)`
  // and resetting the tab + URL back to Overview.
  const PROTECTED_TABS = new Set(["Match Reporting"]);
  $: permissionsReady = hasLeague && !loadingMe && !loadingLeagueMe;

  let tab = "Overview";

  // ---- URL query param (hash router) ----
  function getHashPathAndParams() {
    if (typeof window === "undefined") return { path: "", params: new URLSearchParams() };

    const rawHash = window.location.hash || "";
    const withoutHash = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;

    const qIdx = withoutHash.indexOf("?");
    const path = qIdx === -1 ? withoutHash : withoutHash.slice(0, qIdx);
    const query = qIdx === -1 ? "" : withoutHash.slice(qIdx + 1);

    return { path, params: new URLSearchParams(query) };
  }

  function getHashQueryParam(key) {
    const { params } = getHashPathAndParams();
    return params.get(key);
  }

  function setHashQueryParam(key, value) {
    if (typeof window === "undefined") return;

    const { path, params } = getHashPathAndParams();

    if (value == null || value === "") params.delete(key);
    else params.set(key, value);

    const qs = params.toString();
    const nextHash = qs ? `${path}?${qs}` : path;

    // Replace hash without pushing history entries
    const base = window.location.href.split("#")[0];
    window.history.replaceState(null, "", `${base}#${nextHash}`);
  }

  let suppressTabUrlWrite = false;

  function syncTabFromUrl() {
    const t = getHashQueryParam("tab");
    if (!t) return;

    // Avoid immediately writing the same value back while we're applying it
    suppressTabUrlWrite = true;
    tab = t;
    suppressTabUrlWrite = false;
  }

  function setTab(next) {
    tab = next;

    if (!suppressTabUrlWrite) {
      setHashQueryParam("tab", next);
    }
  }

  // Keep tab valid if permissions change (e.g., Match Reporting appears/disappears)
  $: if (tab && tabs.length && !tabs.includes(tab)) {
    const permsReady = !loadingMe && !loadingLeagueMe;
    const isProtected = PROTECTED_TABS.has(tab);

    // If the tab is protected and permissions are still loading, don't "correct"
    // it yet. Otherwise, a refresh on Match Reporting will briefly see tabs without
    // Match Reporting, force tab=Overview, and then overwrite the URL.
    if (!(isProtected && !permsReady)) {
      tab = "Overview";
      if (!suppressTabUrlWrite) setHashQueryParam("tab", tab);
    }
  }

  let showCreateSeason = false;
  let seasonName = "";
  let seasonStartDate = "";
  let seasonFormat = "";
  let creatingSeason = false;

  async function submitCreateSeason() {
    resetMessages();

    if (!hasLeague) {
      error = "Select a league first.";
      return;
    }
    if (!seasonName.trim()) {
      error = "Season name is required.";
      return;
    }
    if (!seasonStartDate) {
      error = "Start date is required.";
      return;
    }
    if (!seasonFormat.trim()) {
      error = "Format is required.";
      return;
    }

    creatingSeason = true;
    try {
      await createSeason({
        league_id: ctx.league.id,
        name: seasonName.trim(),
        start_date: seasonStartDate,
        format: seasonFormat.trim()
      });

      success = "Season created.";
      showCreateSeason = false;
      seasonName = "";
      seasonStartDate = "";
      seasonFormat = "";

      await refreshSeasonsAndMaybeDashboard();
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      creatingSeason = false;
    }
  }

  // ---- Teams accordion state ----
  let openTeamId = null;
  async function toggleTeam(teamId) {
    openTeamId = openTeamId === teamId ? null : teamId;

    if (!openTeamId) return;

    // wait for DOM + reactive derived data (teamsMerged / seasonTeams / coachesByName)
    await tick();

    const team = (teamsMerged ?? []).find((t) => t.id === openTeamId);
    if (!team) return;

    // Try immediately
    await loadTeamDetails(team);

    // If coachId wasn’t available yet, try once more next tick (when seasonTeams/coaches might finish)
    if (!teamDetails?.[openTeamId] || teamDetails[openTeamId]?.error === "__MISSING_COACH__") {
      await tick();
      await loadTeamDetails(team);
    }
  }

  function getRosterForTeamId(teamId) {
    const det = teamDetails?.[teamId];
    const roster = det?.roster ?? [];

    return roster
      .slice()
      .sort((a, b) => (b?.differential ?? 0) - (a?.differential ?? 0));
  }

  // ---- Team details cache (fetched via getCoachSeasonDetails) ----
  // { [teamId]: { loading, error, roster: [], transactions: [], summary: { rank, diff, wins, losses } } }
  let teamDetails = {};

  // reset per-season
  $: if (activeSeason?.id == null) {
    teamDetails = {};
    openTeamId = null;
  }

  // Derived roster per team (reactive in Svelte 4)
  $: rosterByTeamId = Object.keys(teamDetails ?? {}).reduce((acc, k) => {
    const det = teamDetails[k];
    const roster = Array.isArray(det?.roster) ? det.roster : [];
    acc[k] = roster.slice().sort((a, b) => (b?.differential ?? 0) - (a?.differential ?? 0));
    return acc;
  }, {});

  // Derived roster length (optional convenience)
  $: rosterLenByTeamId = Object.keys(rosterByTeamId ?? {}).reduce((acc, k) => {
    acc[k] = rosterByTeamId[k]?.length ?? 0;
    return acc;
  }, {});

  // ---- Coaches list (league-scoped) ----
  let coaches = [];
  let loadingCoaches = false;

  function normName(s) {
    return (s ?? "").toString().trim().toLowerCase();
  }

  function addCoachKey(acc, coach, rawName) {
    const k = normName(rawName);
    if (!k) return;
    if (acc[k] == null) acc[k] = coach?.id; // don’t overwrite if duplicate names
  }

  function spriteCacheKey(p) {
    if (Number.isInteger(p?.pokemon_id)) return `id:${p.pokemon_id}`;
    if (Number.isInteger(p?.dex_number)) return `dex:${p.dex_number}`;
    if (p?.pokemon_name) return `name:${p.pokemon_name}`;
    return null;
  }

  $: coachesByName = (coaches ?? []).reduce((acc, c) => {
    addCoachKey(acc, c, c?.coach_name);
    addCoachKey(acc, c, c?.name);
    addCoachKey(acc, c, c?.display_name);
    addCoachKey(acc, c, c?.full_name);
    return acc;
  }, {});

  async function loadCoachesList() {
    coaches = [];
    if (!hasLeague) return;

    loadingCoaches = true;
    try {
      coaches = await getCoaches();
    } catch {
      coaches = [];
    } finally {
      loadingCoaches = false;
    }
  }

  // ensure coaches load once league is selected (onMount can run before hasLeague=true)
  let lastCoachesLeagueId = null;
  $: if (hasLeague) {
    const lid = ctx?.league?.id ?? null;
    if (lid && lid !== lastCoachesLeagueId) {
      lastCoachesLeagueId = lid;
      loadCoachesList();
    }
  } else {
    lastCoachesLeagueId = null;
    coaches = [];
  }

  function getTeamCoachId(team) {
    const direct =
      team?.coach_id ??
      team?.coachId ??
      team?.coach?.id ??
      team?.coach?.coach_id ??
      team?.coach?.coachId ??
      team?.coach_user_id ??
      team?.coachUserId ??
      null;

    if (direct != null) return direct;

    const name =
      team?.coach_name ??
      team?.coachName ??
      team?.coach?.coach_name ??
      team?.coach?.name ??
      team?.coach?.display_name ??
      null;

    const key = normName(name);

    if (!key) return null;
    return coachesByName[key] ?? null;
  }

  async function loadTeamDetails(team) {
    const teamId = team?.id;
    const seasonId = activeSeason?.id;

    if (!teamId || !seasonId) return;

    const coachId = getTeamCoachId(team);

    // If we can’t resolve coach yet, put a sentinel error so UI shows *something*
    if (!coachId) {
      teamDetails = {
        ...teamDetails,
        [teamId]: {
          loading: false,
          error: "__MISSING_COACH__",
          details: null,
          roster: [],
          transactions: [],
          summary: null
        }
      };
      return;
    }

    // don’t refetch if already have it (or currently loading)
    if (teamDetails?.[teamId]?.loading) return;
    if (teamDetails?.[teamId] && !teamDetails[teamId].error) return;

    teamDetails = {
      ...teamDetails,
      [teamId]: {
        ...(teamDetails[teamId] ?? {}),
        loading: true,
        error: "",
        // important: keep these keys present from the start
        roster: teamDetails?.[teamId]?.roster ?? [],
        transactions: teamDetails?.[teamId]?.transactions ?? [],
        summary: teamDetails?.[teamId]?.summary ?? null,
        details: teamDetails?.[teamId]?.details ?? null
      }
    };

    try {
      const details = await getCoachSeasonDetails(coachId, seasonId, ctx?.league?.id);

      // Arrays
      const roster = details?.roster ?? details?.pokemon ?? details?.team_roster ?? [];
      const tx = details?.transactions ?? details?.team_transactions ?? [];

      // Summary
      const rank =
        details?.regular_season_rank ??
        details?.rank ??
        details?.current_rank ??
        details?.season_rank ??
        details?.team?.regular_season_rank ??
        details?.team?.rank ??
        null;

      const diff =
        details?.differential ??
        details?.diff ??
        details?.season_differential ??
        details?.team?.differential ??
        0;

      const wins =
        details?.season_wins ??
        details?.wins ??
        details?.team?.season_wins ??
        details?.team?.wins ??
        team?.season_wins ??
        team?.wins ??
        0;

      const losses =
        details?.season_losses ??
        details?.losses ??
        details?.team?.season_losses ??
        details?.team?.losses ??
        team?.season_losses ??
        team?.losses ??
        0;

      teamDetails = {
        ...teamDetails,
        [teamId]: {
          loading: false,
          error: "",
          details,
          roster: Array.isArray(roster) ? roster : [],
          transactions: Array.isArray(tx) ? tx : [],
          summary: { rank, diff, wins, losses }
        }
      };
    } catch (e) {
      teamDetails = {
        ...teamDetails,
        [teamId]: {
          loading: false,
          error: e?.message ?? String(e),
          details: null,
          roster: [],
          transactions: [],
          summary: null
        }
      };
    }
  }

  let playoffsPublished = false;

  // keep rules in sync with selected league (frontend-only PoC)
  let lastRulesLeagueId = null;
  $: {
    const lid = ctx?.league?.id ?? null;
    if (lid !== lastRulesLeagueId) {
      lastRulesLeagueId = lid;
      loadLeagueRules();
    }
  }

  // localStorage key should match the component
  function playoffsKey() {
    const sid = activeSeason?.id ?? "none";
    const lid = ctx?.league?.id ?? "none";
    return `mpl.playoffs.${lid}.${sid}.published`;
  }

  function readPlayoffsPublished() {
    try {
      playoffsPublished = JSON.parse(localStorage.getItem(playoffsKey()) || "false");
    } catch {
      playoffsPublished = false;
    }
  }

  // refresh when league/season changes
  $: if (hasLeague && activeSeason?.id) {
    readPlayoffsPublished();
  } else {
    playoffsPublished = false;
  }

  // ---- lifecycle ----
  onMount(() => {
    // Initialize tab from URL on first mount and keep it in sync with back/forward.
    syncTabFromUrl();

    const onHashChange = () => {
      syncTabFromUrl();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("hashchange", onHashChange);
    }

    (async () => {
      await loadMe();
      await loadLeagueMe();
      await refreshSeasonsAndMaybeDashboard();
    })();

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("hashchange", onHashChange);
      }
    };
  });

  let lastLeagueId = null;
  $: if (hasLeague) {
    const nextId = ctx.league.id;
    if (nextId !== lastLeagueId) {
      lastLeagueId = nextId;

      // Initialize tab from URL (e.g. #/leagues?tab=Teams). If absent, default to Overview.
      syncTabFromUrl();
      if (!tab) tab = "Overview";
      if (!getHashQueryParam("tab")) setHashQueryParam("tab", tab);

      showCreateSeason = false;
      seasonName = "";
      seasonStartDate = "";
      seasonFormat = "";

      openTeamId = null;
      teamDetails = {};

      loadLeagueMe();
      refreshSeasonsAndMaybeDashboard();
    }
  } else {
    lastLeagueId = null;
    leagueMe = null;
    seasons = [];
    activeSeason = null;
    dashboard = null;
    openTeamId = null;
    teamDetails = {};
  }

  // Convenient extracts
  $: season = dashboard?.season ?? activeSeason ?? null;

  $: teams = dashboard?.teams ?? [];

  // --- NEW: Season teams (admin fields) loaded independently so Teams tab updates immediately ---
  let seasonTeams = [];
  let loadingSeasonTeams = false;
  let seasonTeamsError = "";

  async function refreshSeasonTeams() {
    seasonTeamsError = "";
    if (!hasLeague || !activeSeason?.id) {
      seasonTeams = [];
      return;
    }

    loadingSeasonTeams = true;
    try {
      // if your api cache keys use "seasonTeams:" feel free to clear it too
      // clearApiCache(`seasonTeams:${activeSeason.id}`);
      seasonTeams = await getSeasonTeams(activeSeason.id);
    } catch (e) {
      seasonTeams = [];
      seasonTeamsError = e?.message ?? String(e);
    } finally {
      loadingSeasonTeams = false;
    }
  }

  // When active season changes, load seasonTeams once (and keep it fresh)
  let lastSeasonTeamsSeasonId = null;
  $: if (hasLeague && activeSeason?.id) {
    if (activeSeason.id !== lastSeasonTeamsSeasonId) {
      lastSeasonTeamsSeasonId = activeSeason.id;
      refreshSeasonTeams();
    }
  } else {
    lastSeasonTeamsSeasonId = null;
    seasonTeams = [];
  }

  // If the dashboard has teams, we STILL prefer seasonTeams (because it’s what the manager updates)
  $: teamsForTeamsTab = (seasonTeams?.length ? seasonTeams : teams);

  // ---- NEW: Merge dashboard teams with seasonTeams admin fields ----
  $: seasonTeamsById = (seasonTeams ?? []).reduce((acc, t) => {
    acc[t.id] = t;
    return acc;
  }, {});

  $: teamsMerged = (teamsForTeamsTab ?? []).map((t) => {
    const extra = seasonTeamsById[t.id] ?? {};
    return {
      ...t,
      abbrev: t.abbrev ?? extra.abbrev ?? null,
      conference: t.conference ?? extra.conference ?? null,
      division: t.division ?? extra.division ?? null,
      color_primary: t.color_primary ?? extra.color_primary ?? null,
      color_secondary: t.color_secondary ?? extra.color_secondary ?? null,
      coach_id: t.coach_id ?? extra.coach_id ?? null,
      coach_name: t.coach_name ?? extra.coach_name ?? null
    };
  });

  // ---- NEW: edit request bridge from list -> SeasonTeamsManager ----
  let editTeamRequest = null; // { team } | null

  $: matches = dashboard?.matches ?? [];
  $: matchGames = dashboard?.matchGames ?? dashboard?.match_games ?? [];
  $: pokemonStats = dashboard?.pokemonStats ?? dashboard?.pokemon_stats ?? [];

  // Transactions may or may not be in the dashboard payload
  $: transactions =
    dashboard?.transactions ??
    dashboard?.teamTransactions ??
    dashboard?.team_transactions ??
    [];

  // ---- Styling helpers ----
  const diffClass = (d) => (d > 0 ? "pos" : d < 0 ? "neg" : "neu");

  // ---- Sprite helpers (same logic pattern as CoachProfile) ----
  let spriteCache = {}; // { [pokemon_name]: url }

  function extractSpeciesName(raw) {
    if (!raw) return null;
    return raw.split("(")[0].trim();
  }

  function toPokeApiSlug(rawName) {
    if (!rawName) return null;

    const raw = rawName
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/['"]/g, "")
      .trim();

    if (raw.includes("urshifu")) {
      if (raw.includes("single")) return "urshifu-single-strike";
      if (raw.includes("rapid")) return "urshifu-rapid-strike";
      return "urshifu-single-strike";
    }

    let n = extractSpeciesName(rawName)
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/['"]/g, "")
      .trim();

    if (n.startsWith("minior")) return "minior-red-meteor";
    if (n.endsWith("keldeo")) return "keldeo-ordinary";
    if (n.startsWith("aegislash")) return "aegislash-shield";

    if (n.startsWith("mega ")) {
      let rest = n.replace("mega ", "").trim();
      if (/ x$| y$/.test(rest)) {
        const suffix = rest.slice(-1);
        const base = rest.slice(0, -2).trim();
        return `${base}-mega-${suffix}`;
      }
      return `${rest}-mega`;
    }

    const regionalForms = [
      ["alolan ", "-alola"],
      ["galarian ", "-galar"],
      ["hisuian ", "-hisui"],
      ["paldean ", "-paldea"]
    ];

    for (const [prefix, suffix] of regionalForms) {
      if (n.startsWith(prefix)) {
        const base = n.slice(prefix.length).trim();
        return `${base}${suffix}`;
      }
    }

    return n.replace(/\s+/g, "-");
  }

  function pokeApiKeyForPokemon(p) {
    // Prefer dex_number if backend provides it
    const dex = p?.dex_number;
    if (Number.isInteger(dex) && dex > 0) return String(dex);

    // If your backend pokemon_id is actually natdex, you can use it too:
    const pid = p?.pokemon_id;
    if (Number.isInteger(pid) && pid > 0) return String(pid);

    // Fallback: name slug logic
    const name = p?.pokemon_name ?? p?.name ?? null;
    return toPokeApiSlug(name);
  }

  async function preloadSprites(pokemonList) {
    const list = (pokemonList ?? []).filter(Boolean);

    for (const p of list) {
      const cacheKey = spriteCacheKey(p);
      if (!cacheKey) continue;
      if (spriteCache[cacheKey]) continue;

      const key = pokeApiKeyForPokemon(p);
      if (!key) continue;

      try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${key}`);
        if (!res.ok) continue;
        const data = await res.json();

        const url =
          data.sprites?.other?.["official-artwork"]?.front_default ||
          data.sprites?.front_default ||
          null;

        if (url) spriteCache = { ...spriteCache, [cacheKey]: url };
      } catch {
        // ignore
      }
    }
  }

  // Whenever team accordion opens AND teamDetails has loaded, preload sprites for roster + tx
  $: if (openTeamId && teamDetails?.[openTeamId] && !teamDetails[openTeamId].loading) {
    const roster = teamDetails[openTeamId].roster ?? [];
    const tx = teamDetails[openTeamId].transactions ?? [];
    preloadSprites([...roster, ...tx]);
  }

  // roster for a team:
  // Prefer fetched teamDetails roster (even if empty); else fallback to pokemonStats
  function getTeamRoster(team) {
    const teamId = team?.id;
    const det = teamDetails?.[teamId];

    if (det && "roster" in det) {
      return (det.roster ?? [])
        .slice()
        .sort((a, b) => (b?.differential ?? 0) - (a?.differential ?? 0));
    }

    const name = team?.team_name;
    if (!name) return [];
    return (pokemonStats ?? [])
      .filter((p) => (p?.team_name ?? "") === name)
      .slice()
      .sort((a, b) => (b?.differential ?? 0) - (a?.differential ?? 0));
  }

  // Team summary: prefer teamDetails summary (even if rank is null); else fallback to teams payload
  function getTeamSummary(team) {
    const teamId = team?.id;
    const det = teamDetails?.[teamId];

    let wins = 0;
    let losses = 0;
    let diff = 0;
    let rank = null;

    if (det?.summary) {
      wins = det.summary.wins ?? 0;
      losses = det.summary.losses ?? 0;
      diff = det.summary.diff ?? 0;
      rank = det.summary.rank ?? null;
    } else {
      const raw = det?.details ?? null;
      if (raw) {
        wins = raw?.season_wins ?? raw?.wins ?? 0;
        losses = raw?.season_losses ?? raw?.losses ?? 0;
        diff = raw?.differential ?? raw?.diff ?? 0;
        rank = raw?.regular_season_rank ?? raw?.rank ?? null;
      } else {
        wins = team?.season_wins ?? team?.wins ?? team?.w ?? team?.win_count ?? 0;
        losses = team?.season_losses ?? team?.losses ?? team?.l ?? team?.loss_count ?? 0;
        diff = team?.differential ?? team?.diff ?? team?.season_differential ?? 0;
        rank = team?.regular_season_rank ?? team?.current_rank ?? team?.rank ?? null;
      }
    }

    // 🔥 OVERRIDE wins/losses using schedule (this includes DL)
    if ((matches ?? []).length) {
      const rec = computeRegularSeasonRecord(team);
      wins = rec.wins;
      losses = rec.losses;
    }

    return { wins, losses, diff, rank };
  }


  // Match tags (same idea as CoachProfile)
  const matchTag = (m) => {
    if (!m) return null;
    // ✅ NEW: show double loss explicitly
    if (m.is_double_loss) return "Double Loss";

    if (m.is_playoff) return m.playoff_round ? `Playoffs • ${m.playoff_round}` : "Playoffs";
    if (m.is_playins) return m.playins_round ? `Play-ins • ${m.playins_round}` : "Play-ins";
    return null;
  };

  // If match objects don’t contain scores, compute from matchGames
  function computeScoreFromMatchGames(match_id, team_id) {
    const mid = match_id;
    const tid = Number(team_id);

    const games = (matchGames ?? []).filter((g) => {
      const gid = g.match_id ?? g.matchId;
      return gid === mid;
    });

    if (!games.length) return null;

    let my = 0;
    let opp = 0;

    for (const g of games) {
      const winnerId = Number(g.winner_team_id ?? g.winnerTeamId ?? g.winner_id ?? g.winner_team);
      if (!Number.isFinite(winnerId)) continue;
      if (winnerId === tid) my += 1;
      else opp += 1;
    }

    if (my === 0 && opp === 0) return null;
    return { my, opp };
  }

  function toNumId(x) {
    if (x == null) return null;
    const n = Number(x);
    return Number.isNaN(n) ? null : n;
  }

  function pick(obj, keys) {
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null) return v;
    }
    return null;
  }

  function normalizeMatchForTeam(m, team) {
    if (!m || !team) return null;

    const tid = toNumId(team.id);

    // --- identify the two participants (A/B) in the match ---
    const aId = toNumId(pick(m, ["home_team_id", "team1_id", "team_a_id", "team_id_1", "teamAId"]));
    const bId = toNumId(pick(m, ["away_team_id", "team2_id", "team_b_id", "team_id_2", "teamBId"]));

    const aName = pick(m, ["home_team_name", "team1_name", "team_a_name", "team_name_1", "teamAName"]);
    const bName = pick(m, ["away_team_name", "team2_name", "team_b_name", "team_name_2", "teamBName"]);

    const aScoreRaw = pick(m, ["home_score", "team1_score", "team_a_score", "score_home", "scoreA"]);
    const bScoreRaw = pick(m, ["away_score", "team2_score", "team_b_score", "score_away", "scoreB"]);

    // ✅ NEW: carry is_double_loss through (supports a few key variants)
    const isDoubleLoss = !!pick(m, ["is_double_loss", "double_loss", "isDoubleLoss"]);

    // If we can't confidently tell which side team is on, fallback by name (last resort)
    let side = null; // "A" | "B"
    if (aId != null && bId != null) {
      if (aId === tid) side = "A";
      if (bId === tid) side = "B";
      if (!side) return null; // not this team
    } else {
      const myName = team?.team_name ?? null;
      if (!myName) return null;

      const nA = aName ?? null;
      const nB = bName ?? null;
      if (nA === myName) side = "A";
      else if (nB === myName) side = "B";
      else return null;
    }

    const opponentName = side === "A" ? (bName ?? "—") : (aName ?? "—");

    const match_id = pick(m, ["id", "match_id", "matchId"]) ?? `${m.week ?? "?"}-${opponentName}`;

    // --- assign scores by side (NOT by “home” semantics) ---
    let myScore = side === "A" ? aScoreRaw : bScoreRaw;
    let oppScore = side === "A" ? bScoreRaw : aScoreRaw;

    // If scores missing, compute BoX from matchGames by winner_team_id
    if ((myScore == null || oppScore == null) && (matchGames ?? []).length) {
      const computed = computeScoreFromMatchGames(match_id, tid);
      if (computed) {
        myScore = myScore ?? computed.my;
        oppScore = oppScore ?? computed.opp;
      }
    }

    // Normalize result if needed
    let result = pick(m, ["result", "outcome"]);

    // ✅ NEW: double loss overrides the normal W/L/T inference
    if (isDoubleLoss) {
      result = "DL";
    } else if (!result && myScore != null && oppScore != null && myScore !== "—" && oppScore !== "—") {
      const a = Number(myScore);
      const b = Number(oppScore);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        result = a > b ? "W" : a < b ? "L" : "T";
      }
    }

    return {
      match_id,
      week: pick(m, ["week", "match_week"]),
      opponent_team_name: opponentName,
      my_score: myScore ?? "—",
      opp_score: oppScore ?? "—",
      result: result ?? "",
      is_playoff: !!m.is_playoff,
      is_playins: !!m.is_playins,
      playoff_round: m.playoff_round ?? null,
      playins_round: m.playins_round ?? null,
      // ✅ NEW: needed so matchTag() can show it too
      is_double_loss: isDoubleLoss
    };
  }

  function getTeamSchedule(team) {
    const arr = (matches ?? [])
      .map((m) => normalizeMatchForTeam(m, team))
      .filter(Boolean);

    arr.sort((a, b) => {
      const aw = a.week ?? 9999;
      const bw = b.week ?? 9999;
      return aw - bw;
    });

    return arr;
  }

  function computeRegularSeasonRecord(team) {
    const rows = getTeamSchedule(team)
      .filter((m) => !m.is_playoff && !m.is_playins); // regular season only

    let wins = 0;
    let losses = 0;
    let ties = 0;

    for (const m of rows) {
      const r = (m?.result ?? "").toString().toUpperCase();

      if (r === "W") wins += 1;
      else if (r === "L") losses += 1;
      else if (r === "DL") losses += 1; // ← Double Loss counts as a loss
      else if (r === "T") ties += 1;
    }

    return { wins, losses, ties };
  }


  // ---- Transactions (CoachProfile-like) ----
  const normalizeTxType = (t) => {
    const s = (t ?? "").toString().trim().toLowerCase();
    if (s === "drop") return "Drop";
    if (s === "pickup" || s === "pick up") return "Pickup";
    if (s === "trade") return "Trade";
    return t ?? "";
  };

  const txKind = (t) => {
    const s = (t ?? "").toString().trim().toLowerCase();
    if (s === "drop") return "drop";
    if (s === "pickup" || s === "pick up") return "pickup";
    if (s === "trade") return "trade";
    return "other";
  };

  const txIcon = (t) => {
    switch (txKind(t)) {
      case "drop": return "↓";
      case "pickup": return "↑";
      case "trade": return "⇄";
      default: return "•";
    }
  };

  // Prefer fetched teamDetails transactions (even if empty); else fallback to dashboard transactions filter
  function getTeamTransactions(team) {
    const teamId = team?.id;
    const det = teamDetails?.[teamId];

    const fromDetails =
      det?.transactions ??
      det?.details?.transactions ??
      det?.details?.team_transactions ??
      [];

    if (Array.isArray(fromDetails) && fromDetails.length) {
      return fromDetails
        .slice()
        .sort((a, b) => (a.week ?? 9999) - (b.week ?? 9999));
    }

    // fallback to dashboard payload filter if present
    if (!transactions?.length) return [];

    const tid = team?.id;
    const tname = team?.team_name;

    return (transactions ?? [])
      .filter((tr) => {
        const fromId = tr.team_from_id ?? tr.from_team_id ?? tr.teamFromId ?? null;
        const toId = tr.team_to_id ?? tr.to_team_id ?? tr.teamToId ?? null;

        if (fromId != null || toId != null) return fromId === tid || toId === tid;

        const fromName = tr.team_from_name ?? tr.from_team_name ?? tr.teamFromName ?? null;
        const toName = tr.team_to_name ?? tr.to_team_name ?? tr.teamToName ?? null;

        return fromName === tname || toName === tname;
      })
      .slice()
      .sort((a, b) => (a.week ?? 9999) - (b.week ?? 9999));
  }
</script>

{#if error}
  <div class="card error">{error}</div>
{/if}

{#if success}
  <div class="card success">{success}</div>
{/if}

{#if !hasOrg}
  <div class="card muted">Pick an organization above.</div>

{:else if hasOrg && !hasLeague}
  <div class="card">
    <div class="title">Organization: {ctx.organization.name}</div>
    <div class="muted">Select a league above.</div>
  </div>

{:else}
  <div class="card">
    <div class="title">League: {ctx.league.name}</div>

    {#if loadingSeason}
      <div class="muted" style="margin-top:.75rem;">Checking active season…</div>

    {:else if !activeSeason}
      <div class="muted">There is currently no active season for this league.</div>

      {#if loadingLeagueMe}
        <div class="muted" style="margin-top:.75rem;">Checking league role…</div>
      {:else if isLeagueMaster}
        <div class="divider"></div>

        <button class="btn" on:click={() => (showCreateSeason = !showCreateSeason)}>
          {showCreateSeason ? "Cancel" : "Create New Season"}
        </button>

        {#if showCreateSeason}
          <form class="form" on:submit|preventDefault={submitCreateSeason}>
            <label class="label" for="seasonName">Season Name</label>
            <input id="seasonName" class="input" bind:value={seasonName} placeholder="e.g. Season 16" />

            <label class="label" for="seasonStart">Start Date</label>
            <input id="seasonStart" class="input" type="date" bind:value={seasonStartDate} />

            <label class="label" for="seasonFormat">Format</label>
            <input id="seasonFormat" class="input" bind:value={seasonFormat} placeholder="e.g. SV Draft, NatDex Draft, etc." />

            <button class="btn primary" type="submit" disabled={creatingSeason}>
              {creatingSeason ? "Creating…" : "Create Season"}
            </button>
          </form>
        {/if}
      {/if}

    {:else}
      <div class="subhead">
        <div class="pill">
          <span class="pill-k">Active</span>
          <span class="pill-v">{activeSeason?.name ?? `Season ${activeSeason?.id}`}</span>
        </div>
        {#if season?.format}
          <div class="pill">
            <span class="pill-k">Format</span>
            <span class="pill-v">{season.format}</span>
          </div>
        {/if}
      </div>

      <div class="tabs">
        {#each tabs as t}
          <button class="tab {tab === t ? 'active' : ''}" on:click={() => setTab(t)}>
            {t}
          </button>
        {/each}
      </div>

      {#if loadingDashboard}
        <div class="card muted" style="margin-top:.75rem;">Loading season dashboard…</div>
      {:else if !dashboard}
        <div class="card muted" style="margin-top:.75rem;">No dashboard data returned for the active season.</div>
      {:else}
        {#if tab === "Overview"}
          <div class="overview-grid" style="margin-top:.75rem;">
            <div class="card">
              <div class="card-header">
                <div class="card-title">Season Overview</div>
              </div>

              <div class="season-layout">
                <div class="season-left">
                  <div class="season-row">
                    <span class="muted">Name:</span>
                    <span>{season?.name ?? activeSeason?.name ?? "—"}</span>
                  </div>

                  <div class="season-row">
                    <span class="muted">Dates:</span>
                    <span>{season?.start_date ?? "—"} – {season?.end_date ?? "—"}</span>
                  </div>

                  <div class="season-row">
                    <span class="muted">Format:</span>
                    <span>{season?.format ?? "—"}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-title">League Rules</div>
              </div>

              {#if isLeagueMaster}
                <div class="rules-actions">
                  {#if editingRules}
                    <button
                      class="btn primary"
                      on:click={() => {
                        const next = (rulesDraft ?? "").toString();
                        rulesMd = next;
                        saveLeagueRules(next);
                        editingRules = false;
                      }}
                    >
                      Save
                    </button>
                    <button
                      class="btn"
                      on:click={() => {
                        rulesDraft = rulesMd;
                        editingRules = false;
                      }}
                    >
                      Cancel
                    </button>
                  {:else}
                    <button class="btn" on:click={() => (editingRules = true)}>Edit</button>
                  {/if}
                </div>
              {/if}

              {#if editingRules && isLeagueMaster}
                <textarea
                  class="rules-editor"
                  bind:value={rulesDraft}
                  placeholder="# Rules\n\n- Be nice\n- Submit replays by Tuesday\n"
                />
                <div class="muted" style="margin-top: 8px; font-size: .9rem;">
                  Preview
                </div>
                <div class="rules-md" style="margin-top: 8px;">{@html renderMarkdown(rulesDraft)}</div>
              {:else}
                <div class="rules-md">{@html renderMarkdown(rulesMd)}</div>
              {/if}
            </div>
          </div>

        {:else if tab === "Leaderboard"}
          <div class="leaderboard-panels" style="margin-top:.75rem;">
            <StandingsTable teams={teams} seasonTeams={teamsMerged} {matches} {matchGames} />
            <PokemonLeaderboard stats={pokemonStats} seasonTeams={teamsMerged} />
          </div>

        {:else if tab === "Schedule"}
          <div style="margin-top:.75rem;">
            {#if !activeSeason?.id}
              <div class="card muted">No active season selected.</div>
            {:else}
              <SeasonSchedule
                seasonId={activeSeason.id}
                teams={teamsMerged}
                canEdit={isLeagueMaster}
              />
            {/if}
          </div>

        {:else if tab === "Teams"}
          {#if activeSeason?.id && isLeagueMaster}
            <SeasonTeamsManager
              seasonId={activeSeason.id}
              canEdit={isLeagueMaster}
              editRequest={editTeamRequest}
              on:closeEdit={() => (editTeamRequest = null)}
              on:changed={(e) => {
                seasonTeams = e.detail.teams ?? [];
              }}
            />
          {/if}

          <div class="season-list" style="margin-top:.75rem;">
            {#if loadingSeasonTeams}
              <div class="card muted">Loading teams…</div>
            {:else if seasonTeamsError}
              <div class="card muted">Couldn’t load season teams: {seasonTeamsError}</div>
            {:else if !teamsMerged?.length}
              <div class="card muted">No teams for this season yet.</div>
            {:else}
              {#each teamsMerged as t (t.id)}
                <article class="season-card {openTeamId === t.id ? 'open' : ''}">
                  <button class="season-head" on:click={() => toggleTeam(t.id)}>
                    <div class="left">
                      <div class="season-name">{t.team_name}</div>

                      <div class="season-meta muted">
                        {t.coach_name ?? "—"}
                        {#if t.conference || t.division || (t.abbrev ?? "").trim()}
                          <span>•</span>
                          <span>
                            {#if t.conference}{t.conference}{/if}
                            {#if t.conference && t.division} / {/if}
                            {#if t.division}{t.division}{/if}
                            {#if (t.abbrev ?? "").trim()} ({t.abbrev}){/if}
                          </span>
                        {/if}
                      </div>
                    </div>

                    <div class="right">
                      {#if isLeagueMaster}
                        <button
                          class="btn"
                          on:click|stopPropagation={() => (editTeamRequest = { team: t })}
                        >
                          Edit
                        </button>
                      {/if}
                      <div class="chev">{openTeamId === t.id ? "▲" : "▼"}</div>
                    </div>
                  </button>

                  {#if openTeamId === t.id}
                    <div class="season-body">
                      {#if teamDetails?.[t.id]?.loading}
                        <div class="muted" style="margin-top: 6px;">Loading team details…</div>
                      {:else if teamDetails?.[t.id]?.error}
                        <div class="muted" style="margin-top: 6px;">
                          Couldn’t load team details: {teamDetails[t.id].error}
                        </div>
                      {/if}

                      {#if teamDetails?.[t.id]?.summary}
                        <div class="summary-strip">
                          <div class="stat">
                            <div class="k">Record</div>
                            <div class="v">
                              {getTeamSummary(t).wins}-{getTeamSummary(t).losses}
                            </div>
                          </div>

                          <div class="stat">
                            <div class="k">Differential</div>
                            <div class="v {diffClass(teamDetails[t.id].summary.diff)}">
                              {teamDetails[t.id].summary.diff}
                            </div>
                          </div>

                          <div class="stat">
                            <div class="k">Current Season Rank</div>
                            <div class="v">#{teamDetails[t.id].summary.rank ?? "—"}</div>
                          </div>
                        </div>
                      {:else}
                        <div class="summary-strip">
                          <div class="stat">
                            <div class="k">Record</div>
                            <div class="v">
                              {getTeamSummary(t).wins}-{getTeamSummary(t).losses}
                            </div>
                          </div>

                          <div class="stat">
                            <div class="k">Differential</div>
                            <div class="v {diffClass(t.differential ?? 0)}">{t.differential ?? 0}</div>
                          </div>

                          <div class="stat">
                            <div class="k">Current Season Rank</div>
                            <div class="v">#{t.regular_season_rank ?? t.rank ?? "—"}</div>
                          </div>
                        </div>
                      {/if}

                      <div class="panels">
                        <section class="panel">
                          <div class="panel-title">Roster</div>
                          <div class="panel-sub muted">Season totals for this team.</div>

                          <table class="pretty-table">
                            <thead>
                              <tr>
                                <th></th>
                                <th>Pokémon</th>
                                <th class="num">K</th>
                                <th class="num">D</th>
                                <th class="num">Diff</th>
                                <th class="num">GP</th>
                              </tr>
                            </thead>
                            <tbody>
                              {#each (rosterByTeamId[t.id] ?? []) as r, i (spriteCacheKey(r) ?? `${t.id}-${i}`)}
                                <tr>
                                  <td class="sprite-cell">
                                    {#if spriteCache[spriteCacheKey(r)]}
                                      <img class="pokemon-sprite" src={spriteCache[spriteCacheKey(r)]} alt={`Sprite of ${r.pokemon_name}`} />
                                    {:else}
                                      <!-- optional: show dex as fallback text/icon -->
                                      <span class="muted" style="font-size:.75rem;">#{r.dex_number ?? "—"}</span>
                                    {/if}
                                  </td>
                                  <td class="name">{r.pokemon_name}</td>
                                  <td class="num">{r.kills}</td>
                                  <td class="num">{r.deaths}</td>
                                  <td class="num {diffClass(r.differential)}">{r.differential}</td>
                                  <td class="num">{r.games_played}</td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </section>

                        <section class="panel">
                          <div class="panel-title">Schedule</div>
                          <div class="panel-sub muted">Includes postseason markers (if present).</div>

                          {#if getTeamSchedule(t).length === 0}
                            <div class="muted">
                              No matches found for this team in the dashboard payload.
                            </div>
                          {:else}
                            <div class="schedule">
                              {#each getTeamSchedule(t) as m (m.match_id)}
                                <div class="match-row">
                                  <div class="wk">
                                    <div class="wk-top">Week</div>
                                    <div class="wk-val">{m.week ?? "—"}</div>
                                  </div>

                                  <div class="mid">
                                    <div class="opp">
                                      <span class="muted">vs</span>
                                      <span class="opp-name">{m.opponent_team_name}</span>
                                    </div>
                                    {#if matchTag(m)}
                                      <div class="tag">{matchTag(m)}</div>
                                    {/if}
                                  </div>

                                  <div class="righty">
                                    <div class="score">{m.my_score}-{m.opp_score}</div>
                                    <div
                                      class="result {m.result === 'W'
                                        ? 'win'
                                        : m.result === 'L'
                                          ? 'loss'
                                          : m.result === 'DL'
                                            ? 'doubleloss'
                                            : m.result === 'T'
                                              ? 'tie'
                                              : 'none'}"
                                    >
                                      {m.result}
                                    </div>
                                  </div>
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </section>

                        <section class="panel">
                          <div class="panel-title">Transactions</div>
                          <div class="panel-sub muted">Moves affecting this team this season.</div>

                          {#if (teamDetails?.[t.id]?.transactions ?? []).length === 0}
                            <div class="muted">No transactions recorded for this team.</div>
                          {:else}
                            <div class="tx-list">
                              {#each (teamDetails[t.id].transactions ?? []) as tr (tr.id ?? `${tr.week}-${tr.pokemon_name}-${tr.transaction_type}`)}
                                <div class="tx">
                                  <div class="tx-left">
                                    <div class="tx-week-out">W{tr.week ?? "—"}</div>

                                    <div class="tx-badge {txKind(tr.transaction_type)}">
                                      <div class="tx-icon" aria-hidden="true">{txIcon(tr.transaction_type)}</div>
                                      <div class="tx-type">{normalizeTxType(tr.transaction_type)}</div>
                                    </div>
                                  </div>

                                  <div class="tx-mid">
                                    <div class="tx-poke">
                                      <span class="poke-sprite">
                                        {#if spriteCache[spriteCacheKey(tr)]}
                                          <img
                                            class="pokemon-sprite"
                                            src={spriteCache[spriteCacheKey(tr)]}
                                            alt={`Sprite of ${tr.pokemon_name}`}
                                          />
                                        {/if}
                                      </span>
                                      <span>{tr.pokemon_name}</span>
                                    </div>

                                    <div class="tx-flow muted">
                                      <span class="from">{tr.team_from_name ?? "Free Agency"}</span>
                                      <span class="arrow">→</span>
                                      <span class="to">{tr.team_to_name ?? "Free Agency"}</span>
                                    </div>
                                  </div>
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </section>
                      </div>
                    </div>
                  {/if}
                </article>
              {/each}
            {/if}
          </div>

        {:else if tab === "Transactions"}
          <TransactionsManager seasonId={activeSeason.id} leagueId={ctx?.league?.id} canEdit={isLeagueMaster} />

        {:else if tab === "Tier List"}
          <div style="margin-top:.75rem;">
            {#if !activeSeason?.id}
              <div class="card muted">No active season selected.</div>
            {:else}
              <TierListEditor seasonId={activeSeason.id} canEdit={isLeagueMaster} />
            {/if}
          </div>

        {:else if tab === "Draft"}
          <div style="margin-top:.75rem;">
            {#if !activeSeason?.id}
              <div class="card muted">No active season selected.</div>
            {:else}
              <DraftManager seasonId={activeSeason.id} canEdit={isLeagueMaster} />
            {/if}
          </div>

        {:else if tab === "Match Reporting"}
          <div style="margin-top:.75rem;">
            {#if !isLeagueMaster}
              <div class="card muted">You do not have permission to view this tab.</div>
            {:else if !activeSeason?.id}
              <div class="card muted">No active season selected.</div>
            {:else}
              <MatchReporting seasonId={activeSeason.id} canEdit={isLeagueMaster} />
            {/if}
          </div>

        {:else if tab === "Playoffs"}
          <div style="margin-top:.75rem;">
            <PlayoffsPlanner
              seasonId={activeSeason.id}
              leagueId={ctx?.league?.id}
              canEdit={isLeagueMaster}
              teams={teamsMerged}
              on:publishedChanged={(e) => {
                playoffsPublished = !!e.detail.published;
              }}
            />
          </div>
        {/if}
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* ---------- base cards + controls (your original) ---------- */
  .card {
    border-radius: 16px;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 1rem;
  }
  .title {
    font-weight: 900;
    font-size: 1.1rem;
    margin-bottom: 0.25rem;
  }
  .muted {
    opacity: 0.75;
  }

  .divider {
    margin: 0.9rem 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
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
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .primary {
    background: rgba(255, 107, 107, 0.18);
    border-color: rgba(255, 107, 107, 0.35);
  }
  .primary:hover {
    background: rgba(255, 107, 107, 0.24);
  }

  .form {
    margin-top: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 520px;
  }
  .label {
    font-weight: 900;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.86);
    margin-top: 0.25rem;
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
  .input:focus {
    border-color: rgba(255, 107, 107, 0.35);
    box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.12);
  }

  .error {
    border-color: #f97373;
    color: #fecaca;
  }
  .success {
    border-color: rgba(34, 197, 94, 0.45);
    color: rgba(187, 247, 208, 0.95);
  }

  .card-header {
    margin-bottom: 0.5rem;
  }
  .card-title {
    font-weight: 900;
    font-size: 1.05rem;
  }

  .subhead {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }
  .pill {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.18);
    border-radius: 999px;
    padding: 0.35rem 0.65rem;
  }
  .pill-k {
    opacity: 0.75;
    font-weight: 800;
  }
  .pill-v {
    font-weight: 900;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }
  .tab {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.88);
    border-radius: 12px;
    padding: 0.45rem 0.75rem;
    font-weight: 900;
    cursor: pointer;
  }
  .tab.active {
    background: rgba(255, 107, 107, 0.22);
    border-color: rgba(255, 107, 107, 0.35);
    color: white;
  }

  .season-layout {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1.5rem;
    font-size: 1.05rem;
    padding: 0.5rem 0;
  }
  .season-left {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .season-row {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }

  /* ---------- Overview: side-by-side cards ---------- */
  .overview-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  @media (min-width: 980px) {
    .overview-grid {
      grid-template-columns: 1fr 1fr;
      align-items: start;
    }
  }

  .rules-actions {
    margin-top: 8px;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .rules-editor {
    width: 100%;
    min-height: 240px;
    resize: vertical;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.18);
    color: rgba(255, 255, 255, 0.92);
    padding: 0.75rem;
    outline: none;
    font: inherit;
    line-height: 1.35;
  }
  .rules-editor:focus {
    border-color: rgba(255, 107, 107, 0.35);
    box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.12);
  }

  .rules-md {
    font-size: 0.98rem;
    line-height: 1.45;
  }
  .rules-md :global(h2),
  .rules-md :global(h3),
  .rules-md :global(h4) {
    margin: 0.6rem 0 0.35rem;
    font-weight: 900;
  }
  .rules-md :global(p) {
    margin: 0.4rem 0;
  }
  .rules-md :global(ul) {
    margin: 0.4rem 0 0.6rem;
    padding-left: 1.15rem;
  }
  .rules-md :global(li) {
    margin: 0.15rem 0;
  }
  .rules-md :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.95em;
    padding: 0.15rem 0.35rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.22);
  }
  .rules-md :global(a) {
    color: #7dd3fc;
    text-decoration: none;
  }
  .rules-md :global(a:hover) {
    text-decoration: underline;
  }
  .md-spacer {
    height: 0.45rem;
  }

  /* ---------- CoachProfile-style accordion + panels ---------- */
  .season-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .season-card {
    border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    background: rgba(255, 255, 255, 0.04);
  }
  .season-card.open {
    border-color: rgba(255, 107, 107, 0.35);
    box-shadow: 0 0 0 1px rgba(255, 107, 107, 0.1) inset;
  }

  .season-head {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 14px 14px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: rgba(255, 255, 255, 0.92);
  }

  .season-name {
    font-weight: 800;
    font-size: 1.05rem;
    color: #ffffff;
  }

  .season-meta {
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.8);
    flex-wrap: wrap;
  }

  .chev {
    opacity: 0.8;
    font-weight: 900;
    padding-left: 4px;
  }

  .season-body {
    padding: 0 14px 14px 14px;
  }

  .summary-strip {
    margin-top: 10px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    padding: 12px;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.18);
  }
  .stat .k {
    font-size: 0.75rem;
    opacity: 0.75;
  }
  .stat .v {
    font-size: 1.05rem;
    font-weight: 900;
    margin-top: 2px;
  }

  .panels {
    margin-top: 12px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 980px) {
    .leaderboard-panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      align-items: start;
    }
    .panels {
      grid-template-columns: 1.05fr 0.95fr;
    }
    .panels > :nth-child(3) {
      grid-column: 1 / -1;
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

  /* ---- tables ---- */
  .pretty-table {
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
    border-radius: 14px;
  }
  .pretty-table thead th {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.75;
    padding: 10px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .pretty-table tbody td {
    padding: 10px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .pretty-table tbody tr:nth-child(2n) {
    background: rgba(255, 255, 255, 0.03);
  }
  .pretty-table .name {
    font-weight: 750;
  }
  .num {
    text-align: right;
  }

  .sprite-cell {
    width: 42px;
    text-align: center;
  }
  .pokemon-sprite {
    width: 28px;
    height: 28px;
    display: inline-block;
  }

  /* ---- schedule ---- */
  .schedule {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .match-row {
    display: grid;
    grid-template-columns: 80px 1fr 110px;
    gap: 10px;
    align-items: center;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.14);
    padding: 10px;
  }
  .wk-top {
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .wk-val {
    font-weight: 900;
    font-size: 1rem;
  }
  .opp-name {
    font-weight: 800;
  }
  .tag {
    display: inline-block;
    margin-top: 6px;
    font-size: 0.78rem;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid rgba(255, 107, 107, 0.25);
    background: rgba(255, 107, 107, 0.14);
  }
  .righty {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .score {
    font-weight: 900;
  }
  .result {
    width: 34px;
    height: 26px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.06);
  }
  .result.win {
    border-color: rgba(46, 204, 113, 0.35);
    background: rgba(46, 204, 113, 0.12);
  }
  .result.loss {
    border-color: rgba(231, 76, 60, 0.35);
    background: rgba(231, 76, 60, 0.12);
  }
  .result.tie {
    border-color: rgba(241, 196, 15, 0.35);
    background: rgba(241, 196, 15, 0.12);
  }
  .result.doubleloss {
    border-color: rgba(255, 107, 107, 0.5);
    background: rgba(255, 107, 107, 0.12);
    color: #ffd6d6;
  }

  /* ---- transactions ---- */
  .tx-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tx {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 10px;
    align-items: center;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.14);
    padding: 10px;
  }

  .tx-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .tx-week-out {
    font-weight: 900;
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.85);
    min-width: 44px;
  }

  .tx-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;

    padding: 6px 8px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    min-width: 64px;
  }

  .tx-icon {
    font-size: 0.95rem;
    font-weight: 900;
    line-height: 1;
  }

  .tx-type {
    font-weight: 800;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    opacity: 0.9;
  }

  .tx-badge.drop {
    border-color: rgba(231, 76, 60, 0.35);
    background: rgba(231, 76, 60, 0.1);
  }
  .tx-badge.drop .tx-icon {
    color: rgba(231, 76, 60, 0.95);
  }

  .tx-badge.pickup {
    border-color: rgba(46, 204, 113, 0.35);
    background: rgba(46, 204, 113, 0.1);
  }
  .tx-badge.pickup .tx-icon {
    color: rgba(46, 204, 113, 0.95);
  }

  .tx-badge.trade {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.06);
  }
  .tx-badge.trade .tx-icon {
    color: rgba(255, 255, 255, 0.92);
  }

  .tx-poke {
    font-weight: 900;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .poke-sprite {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .tx-flow {
    margin-top: 2px;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .arrow {
    opacity: 0.65;
  }

  /* diff coloring */
  .pos {
    color: rgba(46, 204, 113, 0.95);
  }
  .neg {
    color: rgba(231, 76, 60, 0.95);
  }
  .neu {
    color: rgba(255, 255, 255, 0.85);
  }
</style>
