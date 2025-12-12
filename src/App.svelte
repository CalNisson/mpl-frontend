<script>
  import { onMount, afterUpdate } from 'svelte';
  import { getSeasons, getSeasonDashboard, getSeasonBadges } from './lib/api.js';
  import SeasonOverview from './components/SeasonOverview.svelte';
  import StandingsTable from './components/StandingsTable.svelte';
  import MatchesByWeek from './components/MatchesByWeek.svelte';
  import PokemonLeaderboard from './components/PokemonLeaderboard.svelte';
  import PlayoffsBracket from './components/PlayoffsBracket.svelte';
  import Badges from './components/Badges.svelte';

  let seasons = [];
  let selectedSeasonId = null;
  let loading = false;
  let dashboard = null;
  let error = '';
  let seasonBadges = [];

  $: hasPlayins =
    !!dashboard &&
    Array.isArray(dashboard.matches) &&
    dashboard.matches.some((m) => m.is_playins);

  $: hasPlayoffs =
    !!dashboard &&
    Array.isArray(dashboard.matches) &&
    dashboard.matches.some((m) => m.is_playoff);

  // 👇 ref and height for the standings card
  let standingsContainer;
  let matchesMaxHeight = 0;

  // --- NEW: helper to sync the URL with the selected season ---
  function syncUrlSeason(id) {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);

    if (id != null) {
      url.searchParams.set('season', id);
    } else {
      url.searchParams.delete('season');
    }

    // Use replaceState so we don't add history entries on every change
    window.history.replaceState({}, '', url);
  }

  onMount(async () => {
    try {
      seasons = await getSeasons();

      if (seasons.length > 0) {
        let initialId = null;

        // --- NEW: look for ?season=<id> in URL ---
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          const seasonParam = url.searchParams.get('season');

          if (seasonParam) {
            const parsed = Number(seasonParam);
            // Only use it if it matches a real season
            if (seasons.some((s) => s.id === parsed)) {
              initialId = parsed;
            }
          }
        }

        // Fallback to first season if URL param is missing/invalid
        if (initialId === null) {
          initialId = seasons[0].id;
        }

        selectedSeasonId = initialId;
        syncUrlSeason(initialId); // keep URL in sync
        await loadDashboard(initialId);
      }
    } catch (e) {
      console.error(e);
      error = 'Failed to load seasons: ' + e.message;
    }
  });

  async function loadDashboard(id) {
    loading = true;
    error = '';
    dashboard = null;
    seasonBadges = [];
    try {
      const [dash, badges] = await Promise.all([
        getSeasonDashboard(id),
        getSeasonBadges(id)
      ]);
      dashboard = dash;
      seasonBadges = badges;
    } catch (e) {
      console.error(e);
      error = 'Failed to load season data: ' + e.message;
    } finally {
      loading = false;
    }
  }

  function handleSeasonChange(event) {
    const id = Number(event.target.value);
    selectedSeasonId = id;
    syncUrlSeason(id);   // NEW: update URL when dropdown changes
    loadDashboard(id);
  }

  // 🔍 keep matchesMaxHeight in sync with the standings card
  function updateMatchesHeight() {
    if (standingsContainer) {
      matchesMaxHeight = standingsContainer.offsetHeight;
    }
  }

  // runs after every DOM update where relevant state might have changed
  afterUpdate(() => {
    updateMatchesHeight();
  });
</script>

<div class="app-shell">
  <header class="app-header">
    <div>
      <div class="app-title">Draft League Viewer</div>
      <div class="muted">Explore seasons, standings, matches, and Pokémon stats.</div>
    </div>

    <div>
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
  </header>

  {#if error}
    <div class="card" style="border-color: #f97373; color: #fecaca;">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="card">
      Loading season data…
    </div>
  {:else if dashboard}
    <div class="grid-2" style="margin-bottom: 1rem;">
      <SeasonOverview {dashboard} />
      <PokemonLeaderboard stats={dashboard?.pokemonStats} />
    </div>

    {#if !loading && dashboard}
      <div class="grid-1" style="margin-bottom: 1rem;">
        <Badges badges={seasonBadges} />
      </div>
    {/if}

    <div class="grid-2" style="margin-bottom: 1.5rem;">
      <div bind:this={standingsContainer}>
        <StandingsTable
          teams={dashboard.teams}
          matches={dashboard.matches}
          matchGames={dashboard.matchGames}
        />
      </div>

      <MatchesByWeek
        matches={dashboard.matches}
        matchGames={dashboard.matchGames}
        maxHeight={matchesMaxHeight}
      />
    </div>

    {#if hasPlayins || hasPlayoffs}
      <div class="playoffs-section">
        {#if hasPlayins}
          <PlayoffsBracket
            phase="playins"
            matches={dashboard.matches}
            matchGames={dashboard.matchGames}
            teams={dashboard.teams}
            style="margin-bottom: 1.5rem;"
          />
        {/if}

        {#if hasPlayoffs}
          <PlayoffsBracket
            phase="playoffs"
            matches={dashboard.matches}
            matchGames={dashboard.matchGames}
            teams={dashboard.teams}
          />
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  main {
    min-height: 100vh;
    margin: 0;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    background: #050813;
  }

  .grid-2 {
    align-items: flex-start;
  }

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
</style>
