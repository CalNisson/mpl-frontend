<script>
  export let matches = [];
  export let matchGames = [];
  export let maxHeight = 0;

  // Attach games to matches by match_id
  $: gamesByMatchId = matchGames.reduce((acc, g) => {
    if (!acc[g.match_id]) acc[g.match_id] = [];
    acc[g.match_id].push(g);
    return acc;
  }, {});

  // Build enriched matches with a `games` array
  $: enrichedMatches = matches.map((m) => ({
    ...m,
    games: gamesByMatchId[m.id] ?? [],
  }));

  // Split regular season vs playoffs
  $: regularSeasonMatches = enrichedMatches.filter(
    (m) => !m.is_playoff && !m.is_playins
  );

  // Group regular season by week
  $: matchesByWeek = regularSeasonMatches.reduce((acc, m) => {
    const week = m.week ?? '-';
    if (!acc[week]) acc[week] = [];
    acc[week].push(m);
    return acc;
  }, {});

  // Helper to get vertically aligned per-game scores
  function getGameScores(match) {
    if (match.games && match.games.length > 0) {
      return [...match.games]
        .sort((a, b) => a.game_number - b.game_number)
        .map((g, idx) => ({
          label: `G${g.game_number || idx + 1}`,
          score: `${g.team1_score}-${g.team2_score}`,
        }));
    }

    return [{ label: 'Score', score: `${match.team1_score} - ${match.team2_score}` }];
  }
</script>

<div
  class="card matches-card"
  style={maxHeight ? `max-height:${maxHeight}px; overflow-y:auto;` : ''}
>
  <div class="card-header">
    <div class="card-title">Matches</div>
  </div>

  {#if matches.length === 0}
    <div class="muted">No matches recorded for this season.</div>
  {:else}
    {#if regularSeasonMatches.length > 0}
      <div style="margin-bottom: 1rem;">
        {#each Object.keys(matchesByWeek).sort((a, b) => Number(a) - Number(b)) as week}
          <div style="margin-bottom: 0.5rem;">
            <div class="section-title">Week {week}</div>
            <table class="table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Score</th>
                  <th>Winner</th>
                </tr>
              </thead>
              <tbody>
                {#each matchesByWeek[week] as m}
                  <tr>
                    <td>{m.team1_name} vs {m.team2_name}</td>
                    <td>
                      {#each getGameScores(m) as g}
                        <div>
                          {#if m.games && m.games.length > 0}
                            <span class="muted" style="margin-right: 0.25rem;">{g.label}</span>
                          {/if}
                          <span>{g.score}</span>
                        </div>
                      {/each}
                    </td>
                    <td>{m.winner_team_name}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .matches-card {
    /* ensure padding doesn’t get cropped weirdly at bottom */
    box-sizing: border-box;
  }
</style>
