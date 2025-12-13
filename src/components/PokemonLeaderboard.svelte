<script>
  // Expect an array like dashboard.pokemonStats
  export let stats = [];

  // ----- Sorting: Diff → Kills → lowest GP -----
  $: sorted = [...(stats ?? [])]
    .filter((p) => p != null)
    .sort((a, b) => {
      if (a.differential !== b.differential) {
        return b.differential - a.differential; // higher diff first
      }
      if (a.kills !== b.kills) {
        return b.kills - a.kills;               // higher kills next
      }
      return a.games_played - b.games_played;   // fewer games first
    })
    .slice(0, 10);

  // ----- Sprite helpers -----

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

    if (n.startsWith('minior')) {
      return 'minior-red-meteor';
    } else if (n.endsWith('keldeo')) {
      return 'keldeo-ordinary';
    } else if (n.startsWith('aegislash')) {
      return 'aegislash-shield';
    }

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



  async function preloadSprites(pokemonRows) {
    const names = Array.from(
      new Set(
        pokemonRows
          .map((p) => p.pokemon_name)
          .filter(Boolean)
      )
    );

    for (const name of names) {
      if (spriteCache[name]) continue; // already loaded

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

        if (url) {
          spriteCache = { ...spriteCache, [name]: url };
        }
      } catch (err) {
        console.error('Error fetching sprite for', slug, err);
      }
    }
  }

  // Whenever the sorted list changes, try to preload sprites for them
  $: if (sorted.length) {
    preloadSprites(sorted);
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
          <th></th> <!-- sprite column, intentionally blank -->
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
            <td>{p.team_name}</td>
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
</style>
