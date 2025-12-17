<script>
  import { createOrganization } from "../lib/api";
  import { push } from "svelte-spa-router";

  let name = "";
  let slug = "";
  let description = "";

  let loading = false;
  let error = "";
  let success = "";

  function normalizeSlug(s) {
    return (s || "")
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  $: if (!slug && name.trim()) {
    // auto-suggest slug from name (user can override)
    slug = normalizeSlug(name);
  }

  async function onSubmit() {
    error = "";
    success = "";

    const n = name.trim();
    const s = normalizeSlug(slug);
    const d = description.trim() || null;

    if (!n) {
      error = "Organization name is required.";
      return;
    }
    if (!s) {
      error = "Slug is required (letters/numbers/dashes).";
      return;
    }

    loading = true;
    try {
      const out = await createOrganization({
        name: n,
        slug: s,
        description: d,
      });

      success = `Created organization: ${out?.name ?? n}`;
      // go back to league selection so you can pick/create league
      push("/league");
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="page">
  <h1>Create Organization</h1>

  {#if error}
    <div class="error">{error}</div>
  {/if}
  {#if success}
    <div class="success">{success}</div>
  {/if}

  <form on:submit|preventDefault={onSubmit} class="form">
    <label>
      Name
      <input
        type="text"
        bind:value={name}
        placeholder="Mason Pokémon League"
        autocomplete="off"
      />
    </label>

    <label>
      Slug
      <input
        type="text"
        bind:value={slug}
        placeholder="mason-pokemon-league"
        autocomplete="off"
      />
      <div class="hint">Used in URLs. Lowercase, dashes only.</div>
    </label>

    <label>
      Description (optional)
      <textarea
        rows="4"
        bind:value={description}
        placeholder="Short description of the org…"
      />
    </label>

    <div class="actions">
      <button type="submit" disabled={loading}>
        {#if loading}Creating…{:else}Create Organization{/if}
      </button>

      <button type="button" class="secondary" on:click={() => push("/league")} disabled={loading}>
        Cancel
      </button>
    </div>
  </form>
</div>

<style>
  .page { max-width: 720px; margin: 0 auto; padding: 16px; }
  .form { display: grid; gap: 12px; }
  label { display: grid; gap: 6px; font-weight: 600; }
  input, textarea {
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
