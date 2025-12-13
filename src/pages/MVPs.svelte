<script>
  import { onMount } from "svelte";
  import { getMvps } from "../lib/api.js";

  let loading = true;
  let error = null;

  let major = [];
  let intermediate = [];
  let minor = [];

  let spriteCache = {}; // { [pokemon_name]: url }

  function extractSpeciesName(raw) {
    if (!raw) return null;
    return raw.split('(')[0].trim();
  }

  function toPokeApiSlug(rawName) {
    if (!rawName) return null;

    const raw = rawName
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/['"]/g, '')
      .trim();

    if (raw.includes('urshifu')) {
      if (raw.includes('single')) return 'urshifu-single-strike';
      if (raw.includes('rapid'))  return 'urshifu-rapid-strike';
      return 'urshifu-single-strike';
    }

    let n = extractSpeciesName(rawName)
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/['"]/g, '')
      .trim();

    if (n.startsWith('minior')) return 'minior-red-meteor';
    if (n.endsWith('keldeo')) return 'keldeo-ordinary';
    if (n.startsWith('aegislash')) return 'aegislash-shield';

    if (n.startsWith('mega ')) {
      let rest = n.replace('mega ', '').trim();

      if (/ x$| y$/.test(rest)) {
        const suffix = rest.slice(-1);
        const base = rest.slice(0, -2).trim();
        return `${base}-mega-${suffix}`;
      }
      return `${rest}-mega`;
    }

    const regionalForms = [
      ['alolan ',  '-alola'],
      ['galarian ', '-galar'],
      ['hisuian ', '-hisui'],
      ['paldean ', '-paldea']
    ];

    for (const [prefix, suffix] of regionalForms) {
      if (n.startsWith(prefix)) {
        const base = n.slice(prefix.length).trim();
        return `${base}${suffix}`;
      }
    }

    return n.replace(/\s+/g, '-');
  }

  function seasonNumber(seasonName) {
    if (!seasonName) return 0;

    // Extract first number found (e.g. "Season 15" → 15)
    const match = seasonName.match(/\d+/);
    return match ? Number(match[0]) : 0;
}


  async function preloadSprites(rows) {
    const names = Array.from(new Set((rows ?? []).map(r => r?.pokemon_name).filter(Boolean)));

    for (const name of names) {
      if (spriteCache[name]) continue;

      const slug = toPokeApiSlug(name);
      if (!slug) continue;

      try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
        if (!res.ok) {
          console.error('Sprite fetch failed for', slug, res.status);
          continue;
        }
        const data = await res.json();
        const url =
          data.sprites?.other?.['official-artwork']?.front_default ||
          data.sprites?.front_default ||
          null;

        if (url) spriteCache = { ...spriteCache, [name]: url };
      } catch (err) {
        console.error('Error fetching sprite for', slug, err);
      }
    }
  }

  async function load() {
    loading = true;
    error = null;

    try {
        const [a, b, c] = await Promise.all([
        getMvps("major"),
        getMvps("intermediate"),
        getMvps("minor"),
        ]);

        major = (a ?? []).slice().sort((x, y) => (x.season_id ?? 0) - (y.season_id ?? 0));
        intermediate = (b ?? []).slice().sort((x, y) => (x.season_id ?? 0) - (y.season_id ?? 0));
        minor = (c ?? []).slice().sort((x, y) => (x.season_id ?? 0) - (y.season_id ?? 0));

        await preloadSprites([...major, ...intermediate, ...minor]);
    } catch (e) {
        error = e?.message ?? String(e);
    } finally {
        loading = false;
    }
}


  onMount(load);
</script>


<div class="card">
  <div class="card-header">
    <div class="card-title">MVPs</div>
    <div class="muted">Per-season MVP Pokémon by league type.</div>
  </div>

  {#if loading}
    <div class="muted">Loading…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <div class="mvp-grid">
  <!-- Major -->
    <div class="section">
        <h3 class="section-title">Major</h3>
        {#if !major.length}
        <div class="muted">No MVPs yet.</div>
        {:else}
        <div class="table-wrap">
            <table class="table sticky">
            <thead>
                <tr>
                <th>Pokémon</th>
                <th>Coach</th>
                <th>Team</th>
                <th>K/D</th>
                <th>Season</th>
                </tr>
            </thead>
            <tbody>
                {#each major as r (r.season_id + "-" + r.pokemon_id + "-" + r.coach_id)}
                <tr>
                    <td class="poke">
                    {#if spriteCache[r.pokemon_name]}
                        <img
                        class="sprite"
                        src={spriteCache[r.pokemon_name]}
                        alt={r.pokemon_name}
                        loading="lazy"
                        />
                    {/if}
                    <div class="poke-name">{r.pokemon_name}</div>
                    </td>
                    <td>{r.coach_name}</td>
                    <td>{r.team_name}</td>
                    <td>{r.kills}-{r.deaths}</td>
                    <td>{r.season_name.replace("Season", "")}</td>
                </tr>
                {/each}
            </tbody>
            </table>
        </div>
        {/if}
    </div>

    <!-- Intermediate -->
    <div class="section">
        <h3 class="section-title">Intermediate</h3>
        {#if !intermediate.length}
        <div class="muted">No MVPs yet.</div>
        {:else}
        <!-- table identical to above -->
        {/if}
    </div>

    <!-- Minor -->
    <div class="section">
        <h3 class="section-title">Minor</h3>
        {#if !minor.length}
        <div class="muted">No MVPs yet.</div>
        {:else}
        <!-- table identical to above -->
        {/if}
    </div>
    </div>

  {/if}
</div>

<style>
  .error { color: #ff6b6b; font-weight: 700; }
  .section { margin-top: 1rem; min-width: 0; }
  .section-title { margin: .5rem 0 .75rem; }

  /* Layout: give each table panel a MIN width and let panels WRAP */
  .mvp-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 1rem;
    align-items: flex-start;
  }

  /* Each panel gets a sensible minimum so the table isn't crushed */
  .section {
    flex: 1 1 520px; /* grow, shrink, basis */
    min-width: 520px; /* key: prevents "arbitrary box" squish */
  }

  /* On very small screens, allow full-width stacking */
  @media (max-width: 600px) {
    .section {
      min-width: 0;
      flex-basis: 100%;
    }
  }

  /* Table: do NOT use fixed layout if you want natural column sizing */
  .table {
    width: 100%;
    table-layout: auto; /* important: lets columns size to content */
    border-collapse: separate;
    border-spacing: 0;
  }

  .table-wrap{
    overflow-y: auto;
    overflow-x: hidden; /* no horizontal scrollbar */
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,.08);
  }

  .sticky thead th{
    position: sticky;
    top: 0;
    background: rgba(14,16,20,.92);
    backdrop-filter: blur(6px);
    z-index: 2;
  }

  td, th{
    padding: .5rem .6rem;
    border-bottom: 1px solid rgba(255,255,255,.06);
    border-right: 1px solid rgba(255,255,255,.06);
    vertical-align: middle;
    text-align: center;

    /* allow wrapping at spaces (NOT mid-word) */
    white-space: normal;
    word-break: normal;
    overflow-wrap: normal;
    hyphens: none;
  }

  /* Numbers should stay neat */
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Pokémon cell: allow name to wrap by words */
  .poke{
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: .6rem;
    max-width: 100%;
    min-width: 0;
  }

  .sprite{
    width: 44px;
    height: 44px;
    image-rendering: default;
    flex: 0 0 auto;
  }

  .poke-name{
    font-weight: 600;
    line-height: 1.1;
    text-align: center;

    /* wrap only at spaces */
    white-space: normal;
    word-break: normal;
    overflow-wrap: normal;
    hyphens: none;
  }
</style>

