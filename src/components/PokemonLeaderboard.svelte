<script>
  // Expect an array like dashboard.pokemonStats
  export let stats = [];
  export let seasonTeams = []; // colors live here

  // ----- Sorting: Diff → Kills → lowest GP -----
  $: sorted = [...(stats ?? [])]
    .filter((p) => p != null)
    .sort((a, b) => {
      if (a.differential !== b.differential) return b.differential - a.differential;
      if (a.kills !== b.kills) return b.kills - a.kills;
      return a.games_played - b.games_played;
    })
    .slice(0, 10);

  // ----- Sprite helpers -----
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
      ["alolan ", "-alola"],
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

  async function preloadSprites(pokemonRows) {
    const names = Array.from(new Set(pokemonRows.map((p) => p.pokemon_name).filter(Boolean)));

    for (const name of names) {
      if (spriteCache[name]) continue;

      const slug = toPokeApiSlug(name);
      if (!slug) continue;

      try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
        if (!res.ok) {
          console.error("Sprite fetch failed for", slug, res.status);
          continue;
        }
        const data = await res.json();
        const url =
          data.sprites?.other?.["official-artwork"]?.front_default ||
          data.sprites?.front_default ||
          null;

        if (url) spriteCache = { ...spriteCache, [name]: url };
      } catch (err) {
        console.error("Error fetching sprite for", slug, err);
      }
    }
  }

  $: if (sorted.length) preloadSprites(sorted);

  // ----------------------------
  // Team color helpers (pill)
  // ----------------------------
  function normalizeHex(c) {
    if (!c) return null;
    const s = String(c).trim();
    if (!s) return null;
    if (s.startsWith("#")) return s;
    if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
    return null;
  }

  function hexToRgb(hex) {
    if (!hex) return null;
    const h = hex.replace("#", "");
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return { r, g, b };
  }

  function mixRgb(a, b, t) {
    return {
      r: Math.round(a.r * (1 - t) + b.r * t),
      g: Math.round(a.g * (1 - t) + b.g * t),
      b: Math.round(a.b * (1 - t) + b.b * t)
    };
  }

  function rgbToHex(rgb) {
    const to = (n) => n.toString(16).padStart(2, "0");
    return `#${to(rgb.r)}${to(rgb.g)}${to(rgb.b)}`;
  }

  function dimHex(hex, t = 0.72) {
    const c = hexToRgb(hex);
    if (!c) return null;
    const bg = { r: 11, g: 16, b: 32 };
    return rgbToHex(mixRgb(c, bg, Math.max(0, Math.min(1, t))));
  }

  function textColorForBg(hex) {
    const c = hexToRgb(hex);
    if (!c) return null;
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return luminance > 155 ? "#0b1020" : "#ffffff";
  }

  function normName(s) {
    return String(s ?? "").trim().toLowerCase();
  }

  $: teamById = new Map(
    (seasonTeams ?? [])
      .filter((t) => t?.id != null)
      .map((t) => [Number(t.id), t])
  );

  $: teamByName = new Map(
    (seasonTeams ?? [])
      .filter((t) => t?.team_name)
      .map((t) => [normName(t.team_name), t])
  );

  function teamPillStyleFromRow(p) {
    // Prefer team_id if your stats rows include it
    const byId = p?.team_id != null ? teamById.get(Number(p.team_id)) : null;
    const byName = teamByName.get(normName(p?.team_name));
    const t = byId ?? byName ?? null;

    const base = normalizeHex(t?.color_primary);
    if (!base) return "";

    const fg = textColorForBg(base) ?? "#ffffff";
    return `background:${base}; color:${fg}; border-color: rgba(255,255,255,0.14);`;
  }
</script>

<div class="card">
  <div class="card-header">
    <div class="card-title">Top Pokémon</div>
  </div>

  {#if sorted.length === 0}
    <div class="muted">No Pokémon stats for this season.</div>
  {:else}
    <table class="table">
      <thead>
        <tr>
          <th>#</th>
          <th></th>
          <th>Pokémon</th>
          <th>Team</th>
          <th>Kills</th>
          <th>Deaths</th>
          <th>Diff</th>
          <th>GP</th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as p, i}
          <tr>
            <td>{i + 1}</td>
            <td class="sprite-cell">
              {#if spriteCache[p.pokemon_name]}
                <img
                  class="pokemon-sprite"
                  src={spriteCache[p.pokemon_name]}
                  alt={`Sprite of ${p.pokemon_name}`}
                />
              {/if}
            </td>
            <td>{p.pokemon_name}</td>
            <td>
              <span class="team-pill" style={teamPillStyleFromRow(p)}>
                {p.team_name}
              </span>
            </td>
            <td>{p.kills}</td>
            <td>{p.deaths}</td>
            <td>{p.differential}</td>
            <td>{p.games_played}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .sprite-cell {
    width: 40px;
    text-align: center;
  }

  .pokemon-sprite {
    width: 32px;
    height: 32px;
    image-rendering: default;
    display: inline-block;
  }

  .team-pill{
    display:inline-block;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.12);
    font-weight: 900;
    line-height: 1.2;
    background: rgba(255,255,255,0.06); /* fallback */
  }
</style>
