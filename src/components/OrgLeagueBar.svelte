<script>
  import { onMount } from "svelte";
  import { auth } from "../lib/authStore.js";
  import { leagueContext, setOrganization, setLeague } from "../lib/leagueStore.js";
  import { getMyOrganizations, getOrganizationLeagues } from "../lib/api.js";

  const tokenStore = auth.token;

  let orgs = [];
  let leagues = [];

  let loadingOrgs = false;
  let loadingLeagues = false;
  let error = "";

  // ✅ reactive token
  $: token = $tokenStore;

  // ✅ store shape: { organization, league }
  $: ctx = $leagueContext;
  $: selectedOrgSlug = ctx?.organization?.slug ?? "";
  $: selectedLeagueSlug = ctx?.league?.slug ?? "";

  async function loadOrgs() {
    loadingOrgs = true;
    error = "";
    try {
      orgs = await getMyOrganizations();
    } catch (e) {
      error = e?.message || String(e);
      orgs = [];
    } finally {
      loadingOrgs = false;
    }
  }

  async function loadLeaguesForOrg(orgSlug) {
    loadingLeagues = true;
    error = "";
    try {
      leagues = await getOrganizationLeagues(orgSlug);
      leagues = [...leagues].sort((a, b) => a.id - b.id);
    } catch (e) {
      error = e?.message || String(e);
      leagues = [];
    } finally {
      loadingLeagues = false;
    }
  }

  async function onOrgChange() {
    const org = orgs.find((o) => o.slug === selectedOrgSlug) || null;

    setOrganization(org);
    setLeague(null);
    leagues = [];

    if (!org) return;
    await loadLeaguesForOrg(org.slug);
  }


  function onLeagueChange(e) {
    const slug = e.target.value;
    const league = leagues.find((l) => l.slug === slug) || null;
    setLeague(league);
  }

  onMount(async () => {
    if (!token) return;

    await loadOrgs();

    // ✅ if org already selected (persisted), refresh leagues list
    if (ctx?.organization?.slug) {
      await loadLeaguesForOrg(ctx.organization.slug);
    }
  });
</script>


<div class="bar">
  <div class="bar-title">Select Organization & League</div>

  {#if !token}
    <div class="muted">Log in to select an organization and league.</div>
  {:else if !loadingOrgs && orgs.length === 0}
    <div class="empty">
      <div class="empty-title">You are not currently part of any Organizations/Leagues.</div>
      <div class="muted">
        Please reach out to your League Master to get added.
      </div>
    </div>
  {:else}
    <div class="row">
      <div class="field">
        <label>Organization</label>
        <select class="select" bind:value={selectedOrgSlug} on:change={onOrgChange}>
            <option value="">-- Pick an organization --</option>
            {#each orgs as o}
                <option value={o.slug}>{o.name}</option>
            {/each}
        </select>
      </div>

      <div class="field">
        <label>League</label>
        <select
            class="select"
            bind:value={selectedLeagueSlug}
            on:change={onLeagueChange}
            disabled={!selectedOrgSlug || loadingLeagues}
            >
            <option value="">
                {#if !selectedOrgSlug}
                -- Pick an organization first --
                {:else if loadingLeagues}
                Loading leagues…
                {:else}
                -- Pick a league --
                {/if}
            </option>

            {#each leagues as l}
                <option value={l.slug}>{l.name}</option>
            {/each}
            </select>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="error">⚠ {error}</div>
  {/if}
</div>

<style>
  .bar {
    margin-top: .75rem;
    padding: .9rem 1rem;
    border-radius: 16px;
    background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.08);
  }
  .bar-title {
    font-weight: 800;
    margin-bottom: .5rem;
    opacity: .95;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: .75rem;
    align-items: end;
  }
  @media (max-width: 900px) {
    .row { grid-template-columns: 1fr; }
  }
  .field label {
    display: block;
    font-size: .85rem;
    opacity: .8;
    margin-bottom: .3rem;
  }
  .select:disabled {
    opacity: .55;
    cursor: not-allowed;
  }
  .muted { opacity: .75; }
  .empty {
    padding: .75rem;
    border-radius: 14px;
    border: 1px dashed rgba(255,255,255,.18);
    background: rgba(255,255,255,.03);
  }
  .empty-title {
    font-weight: 800;
    margin-bottom: .25rem;
  }
  .error {
    margin-top: .6rem;
    color: #fecaca;
  }
</style>
