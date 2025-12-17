<script>
  import { leagueContext } from "../lib/leagueStore.js";

  $: ctx = $leagueContext;
  $: ready = !!ctx?.organization && !!ctx?.league;
</script>

{#if !ready}
  <div class="card muted">
    Pick an organization and league above to view league content.
  </div>
{:else}
  <div class="card">
    <div class="title">League: {ctx.league.name}</div>
    <div class="muted">This is a placeholder. Next we’ll load “current season” here.</div>
  </div>
{/if}

<style>
  .card {
    border-radius: 16px;
    padding: 1rem;
    background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.08);
  }
  .title {
    font-weight: 900;
    font-size: 1.1rem;
    margin-bottom: .25rem;
  }
  .muted { opacity: .75; }
</style>
