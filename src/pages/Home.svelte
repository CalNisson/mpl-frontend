<script>
  import { auth } from "../lib/authStore.js";
  import { link, push } from "svelte-spa-router";

  const tokenStore = auth.token;
  const meStore = auth.me;

  $: token = $tokenStore;
  $: me = $meStore;

  function go(path) {
    push(path);
  }
</script>

<div class="wrap">
  <div class="hero card">
    <div class="kicker">Draft League Viewer</div>
    <h1>Track seasons, standings, rosters, stats, and Hall of Fame history.</h1>

    {#if token}
      <div class="sub">
        You’re signed in as <span class="mono">{me?.username ?? me?.email ?? "your account"}</span>.
      </div>
      <div class="actions">
        <button class="primary" on:click={() => go("/leagues")}>Go to Leagues</button>
        <button class="ghost" on:click={() => go("/hall-of-fame")}>Go to Hall of Fame</button>
      </div>
      <div class="hint muted">
        Tip: On Leagues / Hall of Fame, use the Organization + League selector to choose where you want to view data.
      </div>
    {:else}
      <div class="sub">
        Sign in to access league tools and league-specific views.
      </div>
      <div class="actions">
        <a class="primary" href="#/login" use:link>Login</a>
        <a class="ghost" href="#/register" use:link>Create account</a>
      </div>
    {/if}
  </div>

  <div class="grid">
    <div class="card feature">
      <div class="feature-title">Leagues</div>
      <div class="muted">Active season dashboard, standings, teams/rosters, draft tools, transactions, schedule, playoffs.</div>
    </div>
    <div class="card feature">
      <div class="feature-title">Hall of Fame</div>
      <div class="muted">All-time leaders, medals, MVPs, badges, coach history all filtered by your selected league.</div>
    </div>
  </div>

  <div class="card footer">
    <div class="muted">
      Not seeing any organizations/leagues after you sign in? You may not be added to any yet. Please reach out to your League Master in order to be added.
    </div>
  </div>
</div>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .hero {
    padding: 1.25rem;
  }

  .kicker {
    font-weight: 900;
    opacity: .9;
    letter-spacing: .02em;
    margin-bottom: .25rem;
  }

  h1 {
    margin: 0;
    font-size: 1.65rem;
    line-height: 1.25;
  }

  .sub {
    margin-top: .65rem;
    opacity: .85;
  }

  .actions {
    margin-top: 1rem;
    display: flex;
    gap: .75rem;
    flex-wrap: wrap;
  }

  .primary,
  .ghost {
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: .6rem .9rem;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.12);
    font-weight: 800;
    cursor: pointer;
  }

  .primary {
    background: rgba(255, 107, 107, 0.22);
    border-color: rgba(255, 107, 107, 0.35);
    color: white;
  }

  .ghost {
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.88);
  }

  .hint {
    margin-top: .85rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; }
  }

  .feature-title {
    font-weight: 900;
    margin-bottom: .35rem;
  }

  .footer {
    padding: .9rem 1rem;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-weight: 700;
  }

  .muted { opacity: .75; }
</style>
