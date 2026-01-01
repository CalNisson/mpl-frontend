<script>
  import { onMount } from "svelte";
  import { getMyOrganizations, getOrgLeagues } from "../lib/api";
  import { setOrganization, setLeague } from "../lib/leagueStore";
  import { push } from "svelte-spa-router";

  let loading = true;
  let error = "";

  let orgs = [];
  let selectedOrg = null;
  let leagues = [];
  let leaguesLoading = false;

  onMount(async () => {
    try {
      orgs = await getMyOrganizations();
      selectedOrg = orgs?.[0] ?? null;
      if (selectedOrg) await loadLeagues(selectedOrg.slug);
    } catch (e) {
      error = e.message ?? String(e);
    } finally {
      loading = false;
    }
  });

  async function loadLeagues(orgSlug) {
    leaguesLoading = true;
    leagues = [];
    try {
      leagues = await getOrgLeagues(orgSlug);
    } catch (e) {
      error = e.message ?? String(e);
    } finally {
      leaguesLoading = false;
    }
  }

  function pickLeague(league) {
    setOrganization(selectedOrg);
    setLeague(league);
    push("/hall-of-fame");
  }
</script>

<div class="page">
  <h1>Select a League</h1>

  {#if loading}
    <div>Loading…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <label>Organization</label>
    <select
        class="select"
        bind:value={selectedOrg}
        on:change={(e) => loadLeagues(e.target.value.slug)}
    >
      {#each orgs as o}
        <option value={o}>{o.name} ({o.slug})</option>
      {/each}
    </select>

    <h2>Leagues</h2>
    {#if leaguesLoading}
      <div>Loading leagues…</div>
    {:else if leagues.length === 0}
      <div>No leagues found for this org.</div>
    {:else}
      <ul>
        {#each leagues as l}
          <li>
            <button on:click={() => pickLeague(l)}>
              {l.name} ({l.slug})
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <div style="margin-top: 16px;">
      <a href="#/orgs/new">Create Organization</a>
      &nbsp;|&nbsp;
      <a href="#/leagues/new">Create League</a>
    </div>
  {/if}
</div>

