<script>
  export let stats = [];

  $: sorted = [...stats].sort((a, b) => {
    if (a.kos !== b.kos) return b.kos - a.kos;
    return b.differential - a.differential;
  }).slice(0, 8);
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
          <th>Pokémon</th>
          <th>Team</th>
          <th>KOs</th>
          <th>Faints</th>
          <th>Diff</th>
          <th>GP</th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as p}
          <tr>
            <td>{p.pokemon_name}</td>
            <td>{p.team_name}</td>
            <td>{p.kos}</td>
            <td>{p.faints}</td>
            <td>{p.differential}</td>
            <td>{p.games_played}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
