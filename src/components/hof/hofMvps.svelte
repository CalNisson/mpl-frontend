<script>
  import { onMount } from "svelte";
  import { getMvps } from "../../lib/api.js";

  let loading = true;
  let error = null;
  let rows = [];

  let spriteCache = {};

  function extractSpeciesName(raw) {
    if (!raw) return null;
    return raw.split("(")[0].trim();
  }

  function toPokeApiSlug(rawName) {
    if (!rawName) return null;

    const raw = rawName.toLowerCase().replace(/\./g, "").replace(/['"]/g, "").trim();

    if (raw.includes("urshifu")) {
      if (raw.includes("single")) return "urshifu-single-strike";
      if (raw.includes("rapid"))  return "urshifu-rapid-strike";
      return "urshifu-single-strike";
    }

    let n = extractSpeciesName(rawName).toLowerCase().replace(/\./g, "").replace(/['"]/g, "").trim();

    if (n.startsWith("minior")) return "minior-red-meteor";
    if (n.endsWith("keldeo")) return "keldeo-ordinary";
    if (n.startsWith("aegislash")) return "aegislash-shield";

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
      ["alolan ",  "-alola"],
      ["galarian ", "-galar"],
      ["hisuian ", "-hisui"],
      ["paldean ", "-paldea"]
    ];

    for (const [prefix, suffix] of regionalForms) {
      if (n.startsWith(prefix)) {
        const base = n.slice(prefix.length).trim();
        return `${base}${suffix}`;
      }
    }

    return n.replace(/\s+/g, "-");
  }

  function seasonNumber(seasonName) {
    const m = (seasonName ?? "").match(/\d+/);
    return m ? Number(m[0]) : 0;
  }

  async function preloadSprites(list) {
    const names = Array.from(new Set((list ?? []).map(r => r?.pokemon_name).filter(Boolean)));

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
        // ignore
      }
    }
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const out = await getMvps();
      rows = (out ?? []).slice().sort((a, b) => seasonNumber(a.season_name) - seasonNumber(b.season_name));
      await preloadSprites(rows);
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
    <div class="muted">Per-season MVP Pokémon for the selected league.</div>
  </div>

  {#if loading}
    <div class="muted">Loading…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if !rows.length}
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
          {#each rows as r (r.season_id + "-" + r.pokemon_id + "-" + r.coach_id)}
            <tr>
              <td class="poke">
                {#if spriteCache[r.pokemon_name]}
                  <img class="sprite" src={spriteCache[r.pokemon_name]} alt={r.pokemon_name} loading="lazy" />
                {/if}
                <div class="poke-name">{r.pokemon_name}</div>
              </td>
              <td>{r.coach_name}</td>
              <td>{r.team_name}</td>
              <td>{r.kills}-{r.deaths}</td>
              <td>{(r.season_name ?? "").replace("Season", "").trim()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .error { color: #ff6b6b; font-weight: 700; }
  .table { width: 100%; table-layout: auto; border-collapse: separate; border-spacing: 0; }
  .table-wrap{ margin-top:1rem; overflow-y:auto; overflow-x:hidden; border-radius:14px; border:1px solid rgba(255,255,255,.08); }
  .sticky thead th{ position:sticky; top:0; background: rgba(14,16,20,.92); backdrop-filter: blur(6px); z-index:2; }
  td, th{ padding:.5rem .6rem; border-bottom:1px solid rgba(255,255,255,.06); border-right:1px solid rgba(255,255,255,.06); text-align:center; }
  .poke{ display:flex; flex-direction:column; align-items:center; gap:.6rem; }
  .sprite{ width:44px; height:44px; }
  .poke-name{ font-weight:700; line-height:1.1; }
</style>
