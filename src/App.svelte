<script>
  import Router from "svelte-spa-router";
  import { link } from "svelte-spa-router";
  import routes from "./routes.js";

  // active path for tab styling
  import { location } from "svelte-spa-router";
  $: path = $location;
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
