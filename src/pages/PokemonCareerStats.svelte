<script>
  import { onMount } from "svelte";
  import { getPokemonCareerStats, runPokemonStatsRollup } from "../lib/api.js";

  let rows = [];
  let loading = true;
  let error = null;

  // UI state
  let search = "";
  let page = 1;
  const PAGE_SIZE = 100;

  // sorting
  // null = use the default "career ranking" order:
  // Titles ↓, MVPs ↓, Finals ↓, Medals ↓, Top8s ↓, Diff ↓, Kills ↓, GP ↑, Name ↑
  let sortKey = null; // pokemon_name | kills | deaths | differential | games_played | titles | finals | medals | top8s | mvps | null
  let sortDir = "desc"; // asc | desc

  // sprite cache
  let spriteCache = {}; // { [pokemon_name]: url }

  function extractSpeciesName(raw) {
    if (!raw) return null;
    return raw.split("(")[0].trim();
  }

  function toPokeApiSlug(rawName) {
    if (!rawName) return null;

    const raw = rawName
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/['"]/g, "")
      .trim();

    if (raw.includes("urshifu")) {
      if (raw.includes("single")) return "urshifu-single-strike";
      if (raw.includes("rapid")) return "urshifu-rapid-strike";
      return "urshifu-single-strike";
    }

    let n = extractSpeciesName(rawName)
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/['"]/g, "")
      .trim();

    if (n.startsWith("minior")) {
      return "minior-red-meteor";
    } else if (n.endsWith("keldeo")) {
      return "keldeo-ordinary";
    } else if (n.startsWith("aegislash")) {
      return "aegislash-shield";
    }

    if (n.startsWith("mega ")) {
      let rest = n.replace("mega ", "").trim();

      if (/ x$| y$/.test(rest)) {
        const suffix = rest.slice(-1);
        const base = rest.slice(0, -2).trim();
        return `${base}-mega-${suffix}`;
      }
      return `${rest}-mega`;
    }

    const regionalForms = [
      ["alolan ", "-alola"],
      ["galarian ", "-galar"],
      ["hisuian ", "-hisui"],
      ["paldean ", "-paldea"],
    ];

    for (const [prefix, suffix] of regionalForms) {
      if (n.startsWith(prefix)) {
        const base = n.slice(prefix.length).trim();
        return `${base}${suffix}`;
      }
    }

    return n.replace(/\s+/g, "-");
  }

  async function preloadSprites(pokemonRows) {
    const names = Array.from(
      new Set(
        pokemonRows
          .map((p) => p.pokemon_name)
          .filter(Boolean)
      )
    );

    for (const name of names) {
      if (spriteCache[name]) continue;

      const slug = toPokeApiSlug(name);
      if (!slug) continue;

      try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
        if (!res.ok) continue;

        const data = await res.json();
        const url =
          data.sprites?.other?.["official-artwork"]?.front_default ||
          data.sprites?.front_default ||
          null;

        if (url) spriteCache = { ...spriteCache, [name]: url };
      } catch {
        // ignore sprite errors
      }
    }
  }

  function setSort(key) {
    // clicking a header switches into "manual sort" mode
    if (sortKey === key) {
      sortDir = sortDir === "desc" ? "asc" : "desc";
    } else {
      sortKey = key;
      // default direction: name asc, numbers desc
      sortDir = key === "pokemon_name" ? "asc" : "desc";
    }
    page = 1;
  }

  function defaultCompare(a, b) {
    return (
      (b.titles ?? 0) - (a.titles ?? 0) ||
      (b.mvps ?? 0) - (a.mvps ?? 0) ||
      (b.finals ?? 0) - (a.finals ?? 0) ||
      (b.medals ?? 0) - (a.medals ?? 0) ||
      (b.top8s ?? 0) - (a.top8s ?? 0) ||
      (b.differential ?? 0) - (a.differential ?? 0) ||
      (b.kills ?? 0) - (a.kills ?? 0) ||
      (a.games_played ?? 0) - (b.games_played ?? 0) ||
      (a.pokemon_name ?? "").localeCompare(b.pokemon_name ?? "")
    );
  }

  function cmp(a, b) {
    // Default: your requested career ranking order
    if (!sortKey) return defaultCompare(a, b);

    const dir = sortDir === "asc" ? 1 : -1;

    if (sortKey === "pokemon_name") {
      return (
        (a.pokemon_name ?? "")
          .toLowerCase()
          .localeCompare((b.pokemon_name ?? "").toLowerCase()) * dir
      );
    }

    const av = Number(a?.[sortKey] ?? 0);
    const bv = Number(b?.[sortKey] ?? 0);

    if (av !== bv) return (av - bv) * dir;

    // tie-breaks fall back to the career ranking order
    return defaultCompare(a, b);
  }

  $: searchNorm = search.trim().toLowerCase();

  $: filtered = [...(rows ?? [])]
    .filter((r) => r != null)
    .filter((r) => {
      if (!searchNorm) return true;
      return (r.pokemon_name ?? "").toLowerCase().includes(searchNorm);
    })
    .sort(cmp);

  $: total = filtered.length;
  $: totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  $: page = Math.min(Math.max(1, page), totalPages);

  $: start = (page - 1) * PAGE_SIZE;
  $: pageRows = filtered.slice(start, start + PAGE_SIZE);

  // preload only what's visible (fast)
  $: if (pageRows.length) preloadSprites(pageRows);

  async function load() {
    loading = true;
    error = null;
    try {
      rows = await getPokemonCareerStats();
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  async function runRollup() {
    error = null;
    try {
      loading = true;
      await runPokemonStatsRollup();
      await load();
    } catch (e) {
      error = e?.message ?? String(e);
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="card">
  <div class="card-header header-row">
    <div>
      <div class="card-title">Pokémon Career Stats</div>
      <div class="muted">Totals from the <code>pokemon</code> table (run rollup to refresh).</div>
    </div>

    <div class="actions">
      <input
        class="search"
        type="text"
        placeholder="Search (e.g., Mega)…"
        bind:value={search}
      />

      <button class="btn" on:click={runRollup} disabled={loading}>
        Run Rollup
      </button>
    </div>
  </div>

  {#if loading}
    <div class="muted">Loading…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if total === 0}
    <div class="muted">No Pokémon stats yet (did you run the rollup?).</div>
  {:else}
    <div class="meta">
      <div class="muted">
        Showing <b>{start + 1}</b>–<b>{Math.min(start + PAGE_SIZE, total)}</b> of <b>{total}</b>
      </div>

      <div class="pager">
        <button class="btn ghost" on:click={() => (page = 1)} disabled={page === 1}>
          « First
        </button>
        <button class="btn ghost" on:click={() => (page = page - 1)} disabled={page === 1}>
          ‹ Prev
        </button>

        <span class="muted">Page <b>{page}</b> / <b>{totalPages}</b></span>

        <button class="btn ghost" on:click={() => (page = page + 1)} disabled={page === totalPages}>
          Next ›
        </button>
        <button class="btn ghost" on:click={() => (page = totalPages)} disabled={page === totalPages}>
          Last »
        </button>
      </div>
    </div>

    <table class="table sticky">
      <thead>
        <tr>
          <th>#</th>
          <th></th>

          <th class="clickable" on:click={() => setSort("pokemon_name")}>
            Pokémon
            {#if sortKey === "pokemon_name"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>

          <th class="clickable num" on:click={() => setSort("titles")}>
            Titles
            {#if sortKey === "titles"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>

          <th class="clickable num" on:click={() => setSort("mvps")}>
            MVPs
            {#if sortKey === "mvps"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>

          <th class="clickable num" on:click={() => setSort("finals")}>
            Finals
            {#if sortKey === "finals"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>

          <th class="clickable num" on:click={() => setSort("medals")}>
            Medals
            {#if sortKey === "medals"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>

          <th class="clickable num" on:click={() => setSort("top8s")}>
            Top 8s
            {#if sortKey === "top8s"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>

          <th class="clickable num" on:click={() => setSort("kills")}>
            Kills
            {#if sortKey === "kills"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>

          <th class="clickable num" on:click={() => setSort("deaths")}>
            Deaths
            {#if sortKey === "deaths"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>

          <th class="clickable num" on:click={() => setSort("differential")}>
            Diff
            {#if sortKey === "differential"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>

          <th class="clickable num" on:click={() => setSort("games_played")}>
            GP
            {#if sortKey === "games_played"}<span class="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>{/if}
          </th>
        </tr>
      </thead>

      <tbody>
        {#each pageRows as p, i}
          <tr>
            <td>{start + i + 1}</td>
            <td class="sprite-cell">
              {#if spriteCache[p.pokemon_name]}
                <img
                  class="pokemon-sprite"
                  src={spriteCache[p.pokemon_name]}
                  alt={`Sprite of ${p.pokemon_name}`}
                  loading="lazy"
                />
              {/if}
            </td>

            <td>{p.pokemon_name}</td>

            <td class="num">{p.titles ?? 0}</td>
            <td class="num">{p.mvps ?? 0}</td>
            <td class="num">{p.finals ?? 0}</td>
            <td class="num">{p.medals ?? 0}</td>
            <td class="num">{p.top8s ?? 0}</td>

            <td class="num">{p.kills}</td>
            <td class="num">{p.deaths}</td>
            <td class="num">{p.differential}</td>
            <td class="num">{p.games_played}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .header-row{
    display:flex;
    align-items:flex-end;
    justify-content:space-between;
    gap:1rem;
  }

  .actions{
    display:flex;
    gap:.5rem;
    align-items:center;
  }

  .search{
    width: 260px;
    max-width: 45vw;
    padding: .55rem .7rem;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.10);
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.9);
    outline: none;
  }

  .search::placeholder{
    color: rgba(255,255,255,.45);
  }

  .btn{
    padding: .55rem .75rem;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.10);
    background: rgba(255,255,255,.08);
    color: rgba(255,255,255,.9);
    font-weight: 700;
    cursor: pointer;
  }

  .btn:disabled{
    opacity: .55;
    cursor: not-allowed;
  }

  .btn.ghost{
    background: transparent;
  }

  .error{
    color: #ff6b6b;
    font-weight: 700;
  }

  .meta{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap: 1rem;
    margin: .5rem 0 1rem;
  }

  .pager{
    display:flex;
    align-items:center;
    gap: .5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .sticky thead th{
    position: sticky;
    top: 0;
    background: rgba(14,16,20,.92);
    backdrop-filter: blur(6px);
    z-index: 2;
  }

  .clickable{
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }

  .arrow{
    margin-left: .35rem;
    opacity: .8;
    font-size: .85em;
  }

  .num{
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .sprite-cell{
    width: 40px;
    text-align: center;
  }

  .pokemon-sprite{
    width: 32px;
    height: 32px;
    image-rendering: pixelated;
    display: inline-block;
  }
</style>
