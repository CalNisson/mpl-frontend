<script>
  export let teams = [];
  export let matches = [];      // needed so we know which matches are playoffs
  export let matchGames = [];   // individual game results

  // 1) Filter teams that have a placement (only show finalized standings)
  $: filteredTeams = teams.filter(
    (t) => t.placement !== null && t.placement !== undefined
  );

  // 2) Build a Set of playoff match_ids to EXCLUDE from diff calc
  $: playoffMatchIds = new Set(
    matches.filter((m) => m.is_playoff).map((m) => m.id)
  );

  // 3) Compute running differential for each team (regular season only)
  //    This mirrors your "previous working counts" logic, just skipping playoffs.
  $: differentialMap = (() => {
    const diff = {};

    // IMPORTANT: initialize ALL teams, not just filteredTeams.
    // That way games vs non-placed teams still contribute to placed teams’ diff.
    for (const team of teams) {
      diff[team.id] = 0;
    }

    for (const g of matchGames) {
      // ignore playoff games
      if (playoffMatchIds.has(g.match_id)) continue;

      // find the match so we know which team was team1 / team2
      const match = matches.find((m) => m.id === g.match_id);
      if (!match) continue;

      const t1 = teams.find((t) => t.team_name === match.team1_name);
      const t2 = teams.find((t) => t.team_name === match.team2_name);
      if (!t1 || !t2) continue;

      // scoring:
      // winner gains their score, loser loses winner's score
      if (g.team1_score > g.team2_score) {
        diff[t1.id] += g.team1_score;       // winner
        diff[t2.id] -= g.team1_score;       // loser loses winner's score
      } else if (g.team2_score > g.team1_score) {
        diff[t2.id] += g.team2_score;       // winner
        diff[t1.id] -= g.team2_score;       // loser loses winner's score
      }
      // ties: no change
    }

    return diff;
  })();

  // 4) Sort by:
  //    - wins (desc)
  //    - differential (desc)
  //    - losses (asc)
  //    - team_name (asc)
  $: sortedTeams = [...filteredTeams].sort((a, b) => {
    const winsA = a.season_wins ?? 0;
    const winsB = b.season_wins ?? 0;
    const winsDiff = winsB - winsA;
    if (winsDiff !== 0) return winsDiff;

    const diffA = differentialMap[a.id] ?? 0;
    const diffB = differentialMap[b.id] ?? 0;
    const diffDiff = diffB - diffA;
    if (diffDiff !== 0) return diffDiff;

    const lossesA = a.season_losses ?? 0;
    const lossesB = b.season_losses ?? 0;
    const lossesDiff = lossesA - lossesB; // fewer losses is better
    if (lossesDiff !== 0) return lossesDiff;

    return a.team_name.localeCompare(b.team_name);
  });
</script>

<div class="card">
  <div class="card-header">
    <div class="card-title">Regular Season Standings</div>
  </div>

  {#if sortedTeams.length === 0}
    <div class="muted">No finalized standings for this season.</div>
  {:else}
    <table class="table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>Coach</th>
          <th>Conf</th>
          <th>Div</th>
          <th>W</th>
          <th>L</th>
          <th>Differential</th>
        </tr>
      </thead>
      <tbody>
        {#each sortedTeams as t, i}
          <tr>
            <!-- rank based on sorted order -->
            <td>{i + 1}</td>
            <td>{t.team_name}</td>
            <td>{t.coach_name}</td>
            <td>{t.conference}</td>
            <td>{t.division}</td>
            <td>{t.season_wins}</td>
            <td>{t.season_losses}</td>
            <td>{differentialMap[t.id]}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
