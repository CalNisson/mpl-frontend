<script>
  export let matches = [];
  export let matchGames = [];
  export let maxHeight = 0;

  // ✅ default: only show regular-season matches (playoffs are shown elsewhere)
  export let showPostseason = false;

  function truthyFlag(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (v == null) return false;
    if (typeof v === "number") return v !== 0;
    const s = String(v).trim().toLowerCase();
    if (s === "true" || s === "t" || s === "1" || s === "yes" || s === "y") return true;
    if (s === "false" || s === "f" || s === "0" || s === "no" || s === "n" || s === "") return false;
    return !!v;
  }

  // Attach games to matches by match_id
  $: gamesByMatchId = (matchGames ?? []).reduce((acc, g) => {
    const mid = Number(g.match_id);
    if (!acc[mid]) acc[mid] = [];
    acc[mid].push(g);
    return acc;
  }, {});

  // Build enriched matches with a `games` array
  $: enrichedMatches = (matches ?? []).map((m) => ({
    ...m,
    games: gamesByMatchId[Number(m.id)] ?? [],
  }));

  // Split into regular season, play-ins, playoffs
  $: regularSeasonMatches = enrichedMatches.filter(
    (m) => !truthyFlag(m.is_playoff) && !truthyFlag(m.is_playins)
  );

  $: playinsMatches = enrichedMatches.filter((m) => truthyFlag(m.is_playins));
  $: playoffMatches = enrichedMatches.filter((m) => truthyFlag(m.is_playoff));

  // Group regular season by week
  $: matchesByWeek = regularSeasonMatches.reduce((acc, m) => {
    const week = m.week ?? "-";
    if (!acc[week]) acc[week] = [];
    acc[week].push(m);
    return acc;
  }, {});

  // Group playoff matches by playoff_round (Quarterfinals, Semifinals, etc.)
  $: playoffsByRound = playoffMatches.reduce((acc, m) => {
    const round = m.playoff_round ?? "Playoffs";
    if (!acc[round]) acc[round] = [];
    acc[round].push(m);
    return acc;
  }, {});

  // Helper to get vertically aligned per-game scores
  function getGameScores(match) {
    if (match.games && match.games.length > 0) {
      return [...match.games]
        .sort((a, b) => (a.game_number ?? 0) - (b.game_number ?? 0))
        .map((g, idx) => ({
          label: `G${g.game_number || idx + 1}`,
          score: `${g.team1_score}-${g.team2_score}`,
        }));
    }

    return [{ label: "Score", score: `${match.team1_score} - ${match.team2_score}` }];
  }
</script>

<div
  class="card matches-card"
  style={maxHeight
    ? `max-height:${maxHeight}px; overflow-y:auto; overflow-x:hidden;`
    : 'overflow-x:hidden;'}
>
  <div class="card-header">
    <div class="card-title">Matches</div>
  </div>

  {#if matches.length === 0}
    <div class="muted">No matches recorded for this season.</div>
  {:else}
    <!-- Regular Season (by week) -->
    {#if regularSeasonMatches.length > 0}
      <div style="margin-bottom: 1rem;">
        {#each Object.keys(matchesByWeek).sort((a, b) => Number(a) - Number(b)) as week}
          <div style="margin-bottom: 0.5rem;">
            <div class="section-title">Week {week}</div>
            <table class="table matches-table">
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

    {#if showPostseason}
      <!-- Play-ins section -->
      {#if playinsMatches.length > 0}
        <div style="margin-bottom: 1rem;">
          <div class="section-title">Play-ins</div>
          <table class="table matches-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Score</th>
                <th>Winner</th>
              </tr>
            </thead>
            <tbody>
              {#each playinsMatches as m}
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
      {/if}
    {/if}

    {#if showPostseason}
      <!-- Playoffs section (by round) -->
      {#if playoffMatches.length > 0}
        <div style="margin-bottom: 0.5rem;">
          {#each Object.keys(playoffsByRound) as round}
            <div style="margin-bottom: 0.5rem;">
              <div class="section-title">{round}</div>
              <table class="table matches-table">
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Score</th>
                    <th>Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {#each playoffsByRound[round] as m}
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
  {/if}
</div>

<style>
  .matches-card {
    box-sizing: border-box;
    /* vertical scroll only on this card; no horizontal scrollbar */
    overflow-x: hidden;
  }

  .matches-table {
    width: 100%;
    border-collapse: collapse;
  }

  .matches-table th,
  .matches-table td {
    white-space: normal;
  }
</style>
