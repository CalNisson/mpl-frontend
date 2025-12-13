<script>
  import Router from "svelte-spa-router";
  import { link, location } from "svelte-spa-router";
  import { onMount } from "svelte";
  import routes from "./routes.js";

  // Prefetch targets (warm the cache)
  import {
    getSeasons,
    getBadges,
    getCoaches,
    getPokemonCareerStats,
    getMvps
  } from "./lib/api.js";

  // active path for tab styling
  $: path = $location;

  onMount(() => {
    // Fire-and-forget prefetch. Cache in api.js will store results.
    // Keep this lightweight; just warm the common pages.
    getSeasons().catch(() => {});
    getBadges("major").catch(() => {});
    getCoaches("major").catch(() => {});
    getPokemonCareerStats().catch(() => {});
    getMvps("major").catch(() => {});
  });
</script>

<div class="app-shell">
  <header class="app-header">
    <div>
      <div class="app-title">Draft League Viewer</div>
      <div class="muted">Explore seasons, standings, matches, Pokémon stats, and coaches.</div>
    </div>

    <!-- Nav tabs -->
    <nav class="tabs">
      <a href="#/" use:link class:active={path === "/"}>Seasons</a>
      <a href="#/coaches" use:link class:active={path === "/coaches"}>Coaches</a>
      <a href="#/pokemon" use:link class:active={path === "/pokemon"}>Pokémon</a>
      <a href="#/crosstable" use:link class:active={path === "/crosstable"}>Crosstable</a>
      <a href="#/mvps" use:link class:active={path === "/mvps"}>MVPs</a>
      <a href="#/medals" use:link class:active={path === "/medals"}>Medals</a>
      <a href="#/badges" use:link class:active={path === "/badges"}>Badges</a>
    </nav>
  </header>

  <Router {routes} />
</div>

<style>
  .tabs{
    display:flex;
    gap:.5rem;
    align-items:center;
  }
  .tabs a{
    text-decoration:none;
    padding:.5rem .75rem;
    border-radius: 12px;
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.85);
    border: 1px solid rgba(255,255,255,.08);
    font-weight: 600;
  }
  .tabs a.active{
    background: rgba(255,107,107,.22);
    border-color: rgba(255,107,107,.35);
    color: white;
  }
</style>
