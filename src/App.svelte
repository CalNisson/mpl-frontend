<script>
  import Router from "svelte-spa-router";
  import { link, location, push } from "svelte-spa-router";
  import { onMount } from "svelte";

  import routes from "./routes.js";

  import { auth } from "./lib/authStore.js";
  import { getMe, logout } from "./lib/api.js";

  import { leagueContext, clearLeagueContext } from "./lib/leagueStore.js";

  // ⬇️ You'll build this component next (org dropdown + league dropdown)
  // It should call setOrganization(org) / setLeague(league) from leagueStore.
  import OrgLeagueBar from "./components/OrgLeagueBar.svelte";

  // active path for tab styling
  $: path = $location;

  // auth stores
  const tokenStore = auth.token;
  const meStore = auth.me;
  $: token = $tokenStore;
  $: me = $meStore;

  // league context store
  const ctxStore = leagueContext;
  $: ctx = $ctxStore;

  // We only gate rendering on these two "top-level halves"
  $: inLeagues = path === "/leagues" || path.startsWith("/leagues/");
  $: inHall = path === "/hall-of-fame" || path.startsWith("/hall-of-fame/");
  $: needsLeagueContext = inLeagues || inHall;

  // ready only if both chosen
  $: hasOrg = !!ctx?.organization;
  $: hasLeague = !!ctx?.league;
  $: ready = hasOrg && hasLeague;

  onMount(async () => {
    // bootstrap session if token exists
    if (auth.getToken()) {
      try {
        await getMe();
      } catch {
        auth.clear();
      }
    }
  });

  function doLogout() {
    logout();
    auth.clear();
    clearLeagueContext();
    push("/login");
  }

  function clearSelection() {
    clearLeagueContext();
  }
</script>

<div class="app-shell">
  <header class="app-header">
    <div class="left">
      <div class="app-title">Draft League Viewer</div>
      <div class="muted">
        Pick an organization + league, then explore.
      </div>
    </div>

    <!-- Topmost navbar: two halves -->
    <nav class="tabs">
      <a href="#/leagues" use:link class:active={inLeagues}>Leagues</a>
      <a href="#/hall-of-fame" use:link class:active={inHall}>Hall of Fame</a>

      <div class="spacer"></div>

      {#if token}
        <span class="me">{me?.username ?? me?.email ?? "Logged in"}</span>
        <button class="tabbtn" on:click={doLogout}>Logout</button>
      {:else}
        <a href="#/login" use:link class:active={path === "/login"}>Login</a>
        <a href="#/register" use:link class:active={path === "/register"}>Register</a>
      {/if}
    </nav>
  </header>

  <!-- Context selection bar (only shown on Leagues / Hall of Fame) -->
  {#if needsLeagueContext}
    <div class="context-bar">
      <div class="context-inner">
        <OrgLeagueBar />

        {#if ready}
          <button class="ghost" on:click={clearSelection}>
            Change selection
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Route content gating -->
  {#if needsLeagueContext && !ready}
    <div class="gate card">
      <div class="gate-title">Select an Organization and League</div>
      <div class="muted">
        Choose an organization first, then pick a league. Once both are selected,
        this page will load the full dashboard.
      </div>
    </div>
  {:else}
    <Router {routes} />
  {/if}
</div>

<style>
  .app-shell {
    min-height: 100vh;
    padding: 1rem;
  }

  .app-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 0.75rem;
  }

  .left {
    min-width: 260px;
  }

  .app-title {
    font-size: 1.35rem;
    font-weight: 800;
    margin-bottom: 0.25rem;
  }

  .muted {
    opacity: 0.75;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .spacer {
    flex: 1;
  }

  .tabs a,
  .tabbtn {
    text-decoration: none;
    padding: 0.5rem 0.75rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-weight: 700;
  }

  .tabs a.active {
    background: rgba(255, 107, 107, 0.22);
    border-color: rgba(255, 107, 107, 0.35);
    color: white;
  }

  .tabbtn {
    cursor: pointer;
  }

  .me {
    opacity: 0.85;
    padding: 0.5rem 0.25rem;
    white-space: nowrap;
  }

  .context-bar {
    margin-bottom: 1rem;
  }

  .context-inner {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.75rem;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .ghost {
    padding: 0.5rem 0.75rem;
    border-radius: 12px;
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-weight: 700;
    cursor: pointer;
  }

  .card {
    padding: 1rem;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
  }

  .gate {
    max-width: 900px;
    margin: 0 auto;
  }

  .gate-title {
    font-size: 1.1rem;
    font-weight: 800;
    margin-bottom: 0.35rem;
  }
</style>
