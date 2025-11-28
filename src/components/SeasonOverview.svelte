<script>
  export let dashboard;

  $: season = dashboard?.season;

  let mvpSpriteUrl = null;
  let mvpSlugCache = null;

  function extractSpeciesName(raw) {
    if (!raw) return null;
    return raw.split('(')[0].trim();
  }

  function toPokeApiSlug(rawName) {
    if (!rawName) return null;

    let n = extractSpeciesName(rawName)
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/['"]/g, '');

    if (n.startsWith('mega ')) {
      let rest = n.slice(5).trim();
      if (/( x| y)$/.test(rest)) {
        const suffix = rest.slice(-1);
        const base = rest.slice(0, -2).trim();
        return `${base}-mega-${suffix}`;
      }
      return `${rest}-mega`;
    }

    const formPrefixes = [
      ['alolan ', '-alola'],
      ['galarian ', '-galar'],
      ['hisuian ', '-hisui'],
      ['paldean ', '-paldea']
    ];

    for (const [prefix, suffix] of formPrefixes) {
      if (n.startsWith(prefix)) {
        const base = n.slice(prefix.length).trim();
        return `${base}${suffix}`;
      }
    }

    return n.replace(/\s+/g, '-');
  }

  async function loadMvpSprite(rawName) {
    const slug = toPokeApiSlug(rawName);
    if (!slug) return;

    if (mvpSlugCache === slug && mvpSpriteUrl) return;

    mvpSlugCache = slug;
    mvpSpriteUrl = null;

    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
      if (!res.ok) return;

      const data = await res.json();

      mvpSpriteUrl =
        data.sprites?.other?.['official-artwork']?.front_default ||
        data.sprites?.front_default ||
        null;
    } catch (err) {
      console.error(err);
    }
  }

  $: if (season?.mvp) {
    loadMvpSprite(season.mvp);
  } else {
    mvpSpriteUrl = null;
    mvpSlugCache = null;
  }
</script>

<div class="card">
  <div class="card-header">
    <div class="card-title">Season Overview</div>
  </div>

  {#if season}
    <div class="season-layout">
      <!-- LEFT SIDE -->
      <div class="season-left">
        <div class="season-row">
          <span class="muted">Dates:</span>
          <span>{season.start_date} – {season.end_date}</span>
        </div>
        <div class="season-row">
          <span class="muted">Champion:</span>
          <span>{season.champion}</span>
        </div>
      </div>

      <!-- RIGHT SIDE: MVP BOX -->
      {#if season.mvp}
        <div class="season-right">
          <div class="mvp-label">MVP</div>

          {#if mvpSpriteUrl}
            <img
              class="mvp-sprite"
              src={mvpSpriteUrl}
              alt={`Sprite of ${season.mvp}`}
            />
          {/if}

          <div class="mvp-name">{season.mvp}</div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="muted">No season selected.</div>
  {/if}
</div>

<style>
  .season-layout {
    display: flex;
    justify-content: space-between;
    align-items: center;          /* centers vertically on both sides */
    gap: 1.5rem;
    font-size: 1.05rem;           /* larger base size */
    padding: 0.5rem 0;
  }

  .season-left {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;                  /* more spacing between rows */
  }

  .season-row {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }

  .season-right {
    min-width: 180px;
    padding: 1rem 1.25rem;        /* more internal padding */
    border-radius: 1rem;
    background: rgba(0, 0, 0, 0.04);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .mvp-label {
    font-weight: 900;
    font-size: 1.15rem;           /* bigger MVP title */
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #d4af37;
    margin-bottom: 0.5rem;
  }

  .mvp-sprite {
    width: 96px;                  /* bigger sprite */
    height: 96px;
    image-rendering: pixelated;
    margin: 0.5rem 0 0.5rem;
  }

  .mvp-name {
    font-size: 1rem;
    font-weight: 700;
    text-align: center;
  }

  @media (max-width: 500px) {
    .season-layout {
      flex-direction: column;
      gap: 1rem;
    }
    .season-right {
      align-self: center;
    }
  }
</style>
