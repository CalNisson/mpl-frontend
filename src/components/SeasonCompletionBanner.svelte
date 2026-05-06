<script>
  import { onMount } from "svelte";
  import { leagueContext } from "../lib/leagueStore.js";
  import {
    clearApiCache,
    completeSeason,
    getLeagueMe,
    getSeasonMatchesForReporting,
    getSeasons
  } from "../lib/api.js";

  const ctxStore = leagueContext;
  $: ctx = $ctxStore;
  $: leagueId = ctx?.league?.id ?? null;

  let seasons = [];
  let leagueMe = null;
  let matches = [];
  let loading = false;
  let completing = false;
  let error = "";
  let success = "";
  let lastLeagueId = null;

  $: activeSeason =
    seasons.find((s) => (s?.status ?? "").toString().toLowerCase() === "active") ?? null;

  $: globalRoles = leagueMe?.global_roles ?? [];
  $: leagueRoles = leagueMe?.league_roles ?? [];
  $: canComplete = globalRoles.includes("admin") || leagueRoles.includes("league_master");

  function isMatchDecided(m) {
    return m?.winner_id != null || m?.winnerId != null || m?.is_double_loss === true || m?.isDoubleLoss === true;
  }

  $: undecidedCount = Array.isArray(matches) ? matches.filter((m) => !isMatchDecided(m)).length : 0;
  $: allMatchesComplete = Array.isArray(matches) && matches.length > 0 && undecidedCount === 0;
  $: showBanner = !!leagueId && !!activeSeason?.id && canComplete && allMatchesComplete;

  async function loadCompletionState() {
    if (!leagueId) {
      seasons = [];
      leagueMe = null;
      matches = [];
      return;
    }

    loading = true;
    error = "";
    success = "";

    try {
      clearApiCache("seasons:");
      seasons = await getSeasons(leagueId);
      leagueMe = await getLeagueMe(leagueId);

      const active =
        seasons.find((s) => (s?.status ?? "").toString().toLowerCase() === "active") ?? null;

      if (!active?.id) {
        matches = [];
        return;
      }

      clearApiCache(`season-matches-for-reporting:`);
      matches = await getSeasonMatchesForReporting(active.id, leagueId);
    } catch (e) {
      seasons = [];
      matches = [];
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  async function onCompleteSeason() {
    if (!activeSeason?.id || completing) return;

    const ok = window.confirm(
      `Complete ${activeSeason?.name ?? "this season"}? This locks the season, awards badges, and records the champion/MVP.`
    );
    if (!ok) return;

    completing = true;
    error = "";
    success = "";

    try {
      const result = await completeSeason(activeSeason.id, leagueId);
      await loadCompletionState();
      success = `Season completed. Champion: ${result?.champion_coach_name ?? "recorded"}.`;
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      completing = false;
    }
  }

  onMount(loadCompletionState);

  $: if (leagueId !== lastLeagueId) {
    lastLeagueId = leagueId;
    loadCompletionState();
  }
</script>

{#if error && leagueId}
  <div class="season-completion-banner error-banner">
    <div>
      <strong>Season completion check failed.</strong>
      <span>{error}</span>
    </div>
    <button class="banner-btn" on:click={loadCompletionState} disabled={loading}>Retry</button>
  </div>
{/if}

{#if success}
  <div class="season-completion-banner success-banner">
    <div>{success}</div>
  </div>
{/if}

{#if showBanner}
  <div class="season-completion-banner">
    <div>
      <strong>{activeSeason?.name ?? "Active season"} is ready to complete.</strong>
      <span>All {matches.length} scheduled matches, including playoffs, have a decided result.</span>
    </div>
    <button class="banner-btn primary" on:click={onCompleteSeason} disabled={completing}>
      {completing ? "Completing…" : "Complete Season"}
    </button>
  </div>
{/if}

<style>
  .season-completion-banner {
    max-width: 1180px;
    margin: 0 auto 0.75rem auto;
    padding: 0.85rem 1rem;
    border: 1px solid rgba(255, 107, 107, 0.35);
    border-radius: 14px;
    background: rgba(255, 107, 107, 0.08);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .season-completion-banner strong {
    display: block;
    margin-bottom: 0.15rem;
  }

  .season-completion-banner span {
    opacity: 0.8;
  }

  .banner-btn {
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 999px;
    padding: 0.5rem 0.85rem;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    white-space: nowrap;
  }

  .banner-btn.primary {
    background: #ff6b6b;
    border-color: #ff6b6b;
    color: white;
    font-weight: 700;
  }

  .banner-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error-banner {
    border-color: rgba(255, 80, 80, 0.4);
    background: rgba(255, 80, 80, 0.08);
  }

  .success-banner {
    border-color: rgba(80, 200, 120, 0.35);
    background: rgba(80, 200, 120, 0.08);
  }

  @media (max-width: 720px) {
    .season-completion-banner {
      align-items: stretch;
      flex-direction: column;
    }

    .banner-btn {
      width: 100%;
    }
  }
</style>
