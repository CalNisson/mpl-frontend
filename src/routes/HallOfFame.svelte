<script>
  import { onMount, afterUpdate } from "svelte";
  import { leagueContext } from "../lib/leagueStore.js";
  import { getMe, getLeagueMe, getSeasons, getSeasonDashboard, getSeasonBadges, recomputeLeagueElo } from "../lib/api.js";

  import SeasonOverview from "../components/SeasonOverview.svelte";
  import StandingsTable from "../components/StandingsTable.svelte";
  import MatchesByWeek from "../components/MatchesByWeek.svelte";
  import PokemonLeaderboard from "../components/PokemonLeaderboard.svelte";
  import PlayoffsBracket from "../components/PlayoffsBracket.svelte";
  import Badges from "../components/Badges.svelte";

  // ✅ HoF tab panels (components)
  import HofMvps from "../components/hof/hofMvps.svelte";
  import HofBadges from "../components/hof/hofBadges.svelte";
  import HofCoaches from "../components/hof/hofCoaches.svelte";
  import HofMedals from "../components/hof/hofMedals.svelte";

  // ✅ Restored tabs (existing pages)
  import PokemonCareerStats from "../pages/PokemonCareerStats.svelte";
  import CoachCrosstable from "../pages/CoachCrosstable.svelte";

  // ✅ reactive league selection
  $: leagueId = $leagueContext?.league?.id ?? null;


// -------------------------
// Permissions (league_master)
// -------------------------
let me = null;
let leagueMe = null;
let eloBusy = false;
let eloMsg = "";
let eloErr = "";

$: globalRoles = me?.roles ?? [];
$: isAdmin = globalRoles.includes("admin");
$: leagueRoles = leagueMe?.league_roles ?? [];
$: isLeagueMaster = isAdmin || leagueRoles.includes("league_master");

async function loadMe() {
  try {
    me = await getMe();
  } catch {
    me = null;
  }
}

async function loadLeagueMe() {
  if (!leagueId) {
    leagueMe = null;
    return;
  }
  try {
    leagueMe = await getLeagueMe(leagueId);
  } catch {
    leagueMe = null;
  }
}

async function runElo(reset = true) {
  if (!leagueId) return;
  const msg = reset
    ? "Reset all coach ELO to 1000 and recompute from all matches for this league?"
    : "Recompute ELO from the current checkpoint (no reset)?";
  if (typeof window !== "undefined" && !confirm(msg)) return;

  eloBusy = true;
  eloMsg = "";
  eloErr = "";
  try {
    await recomputeLeagueElo(leagueId, reset);
    eloMsg = reset ? "ELO recomputed from scratch." : "ELO recompute catch-up complete.";
  } catch (e) {
    eloErr = "Failed to recompute ELO.";
    console.error(e);
  } finally {
    eloBusy = false;
  }
}
  // -------------------------
  // Tab routing via ?tab=
  // -------------------------
  const VALID_TABS = new Set([
    "seasons",
    "pokemon",
    "crosstable",
    "mvps",
    "badges",
    "coaches",
    "medals"
  ]);

  function getTabFromUrl() {
    if (typeof window === "undefined") return "seasons";
    const url = new URL(window.location.href);
    const t = (url.searchParams.get("tab") || "seasons").toLowerCase();
    return VALID_TABS.has(t) ? t : "seasons";
  }

  let tab = "seasons";
  let kickedSeasonsTabForLeagueId = null;

  function setTab(next) {
    tab = next;
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);

    // Only the Seasons tab uses ?season=
    if (next !== "seasons") {
      url.searchParams.delete("season");
    }

    window.history.replaceState({}, "", url);
  }

  function syncTabFromUrl() {
    tab = getTabFromUrl();
  }

  // -------------------------
  // Seasons dashboard state
  // (only used when tab=seasons)
  // -------------------------
  let seasons = [];
  let selectedSeasonId = null;
  let loading = false;
  let dashboard = null;
  let error = "";
  let seasonBadges = [];

  let standingsContainer;
  let matchesMaxHeight = 0;

  $: hasPlayins =
    !!dashboard &&
    Array.isArray(dashboard.matches) &&
    dashboard.matches.some((m) => m.is_playins);

  $: hasPlayoffs =
    !!dashboard &&
    Array.isArray(dashboard.matches) &&
    dashboard.matches.some((m) => m.is_playoff);

  function syncUrlSeason(id) {
    if (typeof window === "undefined") return;

    const hash = window.location.hash || "#/";
    const onHoF = hash.startsWith("#/hall-of-fame");
    const url = new URL(window.location.href);

    if (!onHoF) {
      url.searchParams.delete("season");
      window.history.replaceState({}, "", url);
      return;
    }

    if (id != null) url.searchParams.set("season", id);
    else url.searchParams.delete("season");
    window.history.replaceState({}, "", url);
  }

  async function loadDashboard(id) {
    loading = true;
    error = "";
    dashboard = null;
    seasonBadges = [];
    try {
      const [dash, badges] = await Promise.all([
        getSeasonDashboard(id),
        getSeasonBadges(id),
      ]);
      dashboard = dash;
      seasonBadges = badges;
    } catch (e) {
      console.error(e);
      error = "Failed to load season data: " + (e?.message || String(e));
    } finally {
      loading = false;
    }
  }

  function handleSeasonChange(event) {
    const id = Number(event.target.value);
    selectedSeasonId = id;
    syncUrlSeason(id);
    loadDashboard(id);
  }

  function updateMatchesHeight() {
    if (standingsContainer) matchesMaxHeight = standingsContainer.offsetHeight;
  }

  afterUpdate(updateMatchesHeight);

  // ✅ load seasons when league becomes available (and when it changes)
  let loadedForLeagueId = null;

  $: (async () => {
    if (!leagueId) return;
    if (loadedForLeagueId === leagueId) return;

    loadedForLeagueId = leagueId;

    // Only pre-load the seasons dashboard when we're on seasons tab
    // (but it's fine to load seasons list regardless; leaving as-is for now)
    loading = true;
    error = "";
    dashboard = null;
    seasonBadges = [];
    seasons = [];
    selectedSeasonId = null;

    try {
      seasons = await getSeasons();

      if (seasons.length > 0) {
        let initialId = seasons[0].id;

        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          const seasonParam = url.searchParams.get("season");
          if (seasonParam) {
            const parsed = Number(seasonParam);
            if (seasons.some((s) => s.id === parsed)) initialId = parsed;
          }
        }

        selectedSeasonId = initialId;

        // only load dashboard if we're on seasons tab
        if (tab === "seasons") {
          syncUrlSeason(initialId);
          await loadDashboard(initialId);
        } else {
          // if not on seasons, ensure season param doesn't linger
          syncUrlSeason(null);
        }
      }
    } catch (e) {
      console.error(e);
      error = "Failed to load seasons: " + (e?.message || String(e));
    } finally {
      loading = false;
    }
  })();

  onMount(() => {
    loadMe();
    loadLeagueMe();
    syncTabFromUrl();
    window.addEventListener("hashchange", syncTabFromUrl);
    window.addEventListener("popstate", syncTabFromUrl);
    return () => {
      window.removeEventListener("hashchange", syncTabFromUrl);
      window.removeEventListener("popstate", syncTabFromUrl);
    };
  });

  // If the user switches back to Seasons, ensure the dashboard is loaded once
  $: if (
    leagueId &&
    tab === "seasons" &&
    loadedForLeagueId === leagueId &&
    !dashboard &&
    !loading &&
    kickedSeasonsTabForLeagueId !== leagueId
  ) {
    kickedSeasonsTabForLeagueId = leagueId;

    (async () => {
      try {
        seasons = await getSeasons();
        if (seasons.length > 0) {
          let initialId = seasons[0].id;
          const url = new URL(window.location.href);
          const seasonParam = url.searchParams.get("season");
          if (seasonParam) {
            const parsed = Number(seasonParam);
            if (seasons.some((s) => s.id === parsed)) initialId = parsed;
          }
          selectedSeasonId = initialId;
          syncUrlSeason(initialId);
          await loadDashboard(initialId);
        }
      } catch (e) {
        error = "Failed to load seasons: " + (e?.message || String(e));
      }
    })();
  }

  // When leaving seasons tab, ensure ?season= doesn't linger
  $: if (typeof window !== "undefined" && tab !== "seasons") {
    const url = new URL(window.location.href);
    if (url.searchParams.has("season")) {
      url.searchParams.delete("season");
      window.history.replaceState({}, "", url);
    }
  }
</script>

{#if !leagueId}
  <div class="card">
    Pick an organization + league above to view Hall of Fame.
  </div>
{:else}
  <div class="hof-nav card" aria-label="Hall of Fame navigation">
    <a
      class="hof-link"
      class:is-active={tab === "seasons"}
      href="#/hall-of-fame?tab=seasons"
      on:click|preventDefault={() => setTab("seasons")}
    >Seasons</a>

    <a
      class="hof-link"
      class:is-active={tab === "pokemon"}
      href="#/hall-of-fame?tab=pokemon"
      on:click|preventDefault={() => setTab("pokemon")}
    >Pokémon</a>

    <a
      class="hof-link"
      class:is-active={tab === "crosstable"}
      href="#/hall-of-fame?tab=crosstable"
      on:click|preventDefault={() => setTab("crosstable")}
    >Crosstable</a>

    <a
      class="hof-link"
      class:is-active={tab === "mvps"}
      href="#/hall-of-fame?tab=mvps"
      on:click|preventDefault={() => setTab("mvps")}
    >MVPs</a>

    <a
      class="hof-link"
      class:is-active={tab === "badges"}
      href="#/hall-of-fame?tab=badges"
      on:click|preventDefault={() => setTab("badges")}
    >Badges</a>

    <a
      class="hof-link"
      class:is-active={tab === "coaches"}
      href="#/hall-of-fame?tab=coaches"
      on:click|preventDefault={() => setTab("coaches")}
    >Coaches</a>

    <a
      class="hof-link"
      class:is-active={tab === "medals"}
      href="#/hall-of-fame?tab=medals"
      on:click|preventDefault={() => setTab("medals")}
    >Medals</a>
  </div>

{#if isLeagueMaster}
  <div class="card hof-maint">
    <div class="hof-maint-title">Maintenance</div>

    {#if eloErr}
      <div class="hof-maint-err">{eloErr}</div>
    {/if}
    {#if eloMsg}
      <div class="hof-maint-msg">{eloMsg}</div>
    {/if}

    <div class="hof-maint-actions">
      <button class="hof-btn hof-btn-danger" disabled={eloBusy} on:click={() => runElo(true)}>
        {eloBusy ? "Working..." : "Recompute ELO (Full Reset)"}
      </button>
      <button class="hof-btn" disabled={eloBusy} on:click={() => runElo(false)}>
        {eloBusy ? "Working..." : "Recompute ELO (Catch Up)"}
      </button>
    </div>

    <div class="hof-maint-note">
      Full Reset sets everyone to 1000 and replays all completed matches in the league. Catch Up only processes matches after the checkpoint.
    </div>
  </div>
{/if}


  {#if tab === "seasons"}
    <div class="card" style="display:flex; justify-content: space-between; align-items:center; gap: 1rem; margin-bottom: 1rem;">
      <div>
        <div style="font-weight:800;">Hall of Fame</div>
        <div class="muted">Select a season to view standings, matches, stats, and awards.</div>
      </div>

      {#if seasons.length > 0}
        <select class="select" bind:value={selectedSeasonId} on:change={handleSeasonChange}>
          {#each seasons as season}
            <option value={season.id}>{season.name}</option>
          {/each}
        </select>
      {:else}
        <span class="muted">No seasons found</span>
      {/if}
    </div>

    {#if error}
      <div class="card" style="border-color: #f97373; color: #fecaca;">
        {error}
      </div>
    {/if}

    {#if loading}
      <div class="card">Loading season data…</div>
    {:else if dashboard}
      <div class="grid-2" style="margin-bottom: 1rem;">
        <SeasonOverview {dashboard} />
        <PokemonLeaderboard stats={dashboard?.pokemonStats} />
      </div>

      <div class="grid-1" style="margin-bottom: 1rem;">
        <Badges badges={seasonBadges} />
      </div>

      <div class="grid-2" style="margin-bottom: 1.5rem;">
        <div bind:this={standingsContainer}>
          <StandingsTable teams={dashboard.teams} matches={dashboard.matches} matchGames={dashboard.matchGames} />
        </div>

        <div class="matches-wrap" style={`max-height:${matchesMaxHeight || 0}px;`}>
          <MatchesByWeek matches={dashboard.matches} matchGames={dashboard.matchGames} />
        </div>
      </div>

      {#if hasPlayins || hasPlayoffs}
        <div class="playoffs-section">
          {#if hasPlayins}
            <PlayoffsBracket phase="playins" matches={dashboard.matches} matchGames={dashboard.matchGames} teams={dashboard.teams} />
          {/if}
          {#if hasPlayoffs}
            <PlayoffsBracket phase="playoffs" matches={dashboard.matches} matchGames={dashboard.matchGames} teams={dashboard.teams} />
          {/if}
        </div>
      {/if}
    {:else}
      <div class="card muted">
        {#if error}
          {error}
        {:else}
          No Hall of Fame data is available for this league yet.
        {/if}
      </div>
    {/if}

  {:else if tab === "pokemon"}
    <PokemonCareerStats />

  {:else if tab === "crosstable"}
    <CoachCrosstable />

  {:else if tab === "mvps"}
    <HofMvps />

  {:else if tab === "badges"}
    <HofBadges />

  {:else if tab === "coaches"}
    <HofCoaches />

  {:else if tab === "medals"}
    <HofMedals />
  {/if}
{/if}

<style>
  .playoffs-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 1.5rem;
    margin-bottom: 1.5rem;
    width: 100%;
  }
  .playoffs-section > * {
    max-width: 1200px;
    width: 100%;
  }

  /* HoF navbar */
  .hof-nav {
    display: flex;
    gap: .5rem;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    padding: .6rem .7rem;
    margin-bottom: 1rem;
  }
  .hof-link {
    display: inline-flex;
    align-items: center;
    padding: .4rem .75rem;
    border-radius: 999px;
    text-decoration: none;
    font-weight: 800;
    color: rgba(255,255,255,.85);
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.10);
  }
  .hof-link:hover {
    background: rgba(255,255,255,.10);
    color: rgba(255,255,255,.95);
  }
  .hof-link.is-active {
    background: rgba(255,107,107,.16);
    border-color: rgba(255,107,107,.35);
    color: rgba(255,255,255,.97);
  }
  .matches-wrap{
    overflow-y: auto;
    overflow-x: hidden;
  }


/* HoF maintenance card */
.hof-maint {
  padding: .9rem 1rem;
  margin-bottom: 1rem;
}
.hof-maint-title {
  font-weight: 900;
  margin-bottom: .6rem;
}
.hof-maint-actions {
  display: flex;
  gap: .6rem;
  flex-wrap: wrap;
  margin-top: .5rem;
}
.hof-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: .45rem .9rem;
  border-radius: 999px;
  font-weight: 900;
  cursor: pointer;
  color: rgba(255,255,255,.9);
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.14);
}
.hof-btn:hover {
  background: rgba(255,255,255,.12);
}
.hof-btn:disabled {
  opacity: .55;
  cursor: not-allowed;
}
.hof-btn-danger {
  background: rgba(255, 107, 107, 0.18);
  border-color: rgba(255, 107, 107, 0.32);
}
.hof-btn-danger:hover {
  background: rgba(255, 107, 107, 0.24);
}
.hof-maint-err {
  margin-top: .25rem;
  color: #ff9a9a;
  font-weight: 700;
}
.hof-maint-msg {
  margin-top: .25rem;
  color: #9fffb2;
  font-weight: 700;
}
.hof-maint-note {
  margin-top: .55rem;
  color: rgba(255,255,255,.65);
  font-size: .95rem;
}

</style>
