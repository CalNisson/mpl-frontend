<script>
  import { onMount } from "svelte";
  import { createLeague, getMyOrganizations } from "../lib/api";
  import { push } from "svelte-spa-router";

  let loading = true;
  let saving = false;
  let error = "";
  let success = "";

  let orgs = [];
  let organization_slug = "";

  let name = "";
  let slug = "";
  let description = "";

  function normalizeSlug(s) {
    return (s || "")
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  $: if (!slug && name.trim()) {
    slug = normalizeSlug(name);
  }

  onMount(async () => {
    loading = true;
    error = "";
    try {
      orgs = await getMyOrganizations();
      organization_slug = orgs?.[0]?.slug ?? "";
      if (!organization_slug) {
        error = "No organizations found. Create an organization first.";
      }
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  });

  async function onSubmit() {
    error = "";
    success = "";

    const orgSlug = (organization_slug || "").trim();
    const n = name.trim();
    const s = normalizeSlug(slug);
    const d = description.trim() || null;

    if (!orgSlug) {
      error = "Organization is required.";
      return;
    }
    if (!n) {
      error = "League name is required.";
      return;
    }
    if (!s) {
      error = "League slug is required (letters/numbers/dashes).";
      return;
    }

    saving = true;
    try {
      const out = await createLeague({
        organization_slug: orgSlug,
        name: n,
        slug: s,
        description: d,
      });

      success = `Created league: ${out?.name ?? n}`;
      push("/league");
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      saving = false;
    }
  }
</script>

<div class="page">
  <h1>Create League</h1>

  {#if loading}
    <div>Loading…</div>
  {:else}
    {#if error}
      <div class="error">{error}</div>
    {/if}
    {#if success}
      <div class="success">{success}</div>
    {/if}

    <form on:submit|preventDefault={onSubmit} class="form">
      <label>
        Organization
        <select class="select" bind:value={organization_slug} disabled={saving || orgs.length === 0}>
          {#each orgs as o}
            <option value={o.slug}>{o.name} ({o.slug})</option>
          {/each}
        </select>
      </label>

      <label>
        Name
        <input
          type="text"
          bind:value={name}
          placeholder="Major League"
          autocomplete="off"
          disabled={saving || !organization_slug}
        />
      </label>

      <label>
        Slug
        <input
          type="text"
          bind:value={slug}
          placeholder="major"
          autocomplete="off"
          disabled={saving || !organization_slug}
        />
        <div class="hint">Used in URLs. Lowercase, dashes only.</div>
      </label>

      <label>
        Description (optional)
        <textarea
          rows="4"
          bind:value={description}
          placeholder="Short description of the league…"
          disabled={saving || !organization_slug}
        />
      </label>

      <div class="actions">
        <button type="submit" disabled={saving || !organization_slug}>
          {#if saving}Creating…{:else}Create League{/if}
        </button>

        <button type="button" class="secondary" on:click={() => push("/league")} disabled={saving}>
          Cancel
        </button>
      </div>

      {#if !organization_slug}
        <div class="hint" style="margin-top: 10px;">
          Don’t have an organization yet? <a href="#/orgs/new">Create one</a>.
        </div>
      {/if}
    </form>
  {/if}
</div>

<style>
  .page { max-width: 720px; margin: 0 auto; padding: 16px; }
  .form { display: grid; gap: 12px; }
  label { display: grid; gap: 6px; font-weight: 600; }
  input, textarea, select {
    font-weight: 400;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(0,0,0,0.15);
    color: inherit;
  }
  .actions { display: flex; gap: 10px; margin-top: 8px; }
  button {
    padding: 10px 14px;
    border-radius: 12px;
    border: 0;
    cursor: pointer;
  }
  .secondary {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.2);
  }
  .error {
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(255, 0, 0, 0.12);
    border: 1px solid rgba(255, 0, 0, 0.25);
    margin-bottom: 12px;
  }
  .success {
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(0, 255, 0, 0.10);
    border: 1px solid rgba(0, 255, 0, 0.20);
    margin-bottom: 12px;
  }
  .hint { font-weight: 400; opacity: 0.75; font-size: 0.9rem; }
</style>
