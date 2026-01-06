<script>
  export let teams = [];
  export let matches = [];      // needed so we know which matches are playoffs/playins
  export let matchGames = [];   // individual game results

  // 1) Filter teams that have a placement (only show finalized standings)
  $: filteredTeams = teams;

  // ✅ Show/hide Conf/Div columns if season uses them
  function hasNonEmpty(v) {
    return v !== null && v !== undefined && String(v).trim() !== "";
  }

  $: showConference = (teams ?? []).some((t) => hasNonEmpty(t.conference));
  $: showDivision   = (teams ?? []).some((t) => hasNonEmpty(t.division));

  // 2) Build a Set of *postseason* match_ids (playoffs + playins) to EXCLUDE from diff/kills calc
  $: excludedMatchIds = new Set(
    matches
      .filter((m) => m.is_playoff || m.is_playins)
      .map((m) => m.id)
  );

  // Helper: does this season actually have any matchGames rows?
  $: hasMatchGames = Array.isArray(matchGames) && matchGames.length > 0;

  // Maps we keep updated
  let differentialMap = {};
  let killsMap = {};

  // 3) Compute running differential AND kills for each team (regular season only)
  //    - If we have matchGames → use per-game logic (Bo3)
  //    - If we don't → fall back to the matches table (Bo1)
  $: {
    const diff = {};
    const kills = {};

    // Initialize ALL teams (so games vs non-placed teams still count)
    for (const team of teams) {
      diff[team.id] = 0;
      kills[team.id] = 0;
    }

    // Set of double-loss matches
    const doubleLossMatchIds = new Set(
      matches
        .filter((m) => m.is_double_loss)
        .map((m) => m.id)
    );

    if (hasMatchGames) {
      // ---- CASE A: Use matchGames (per-game differential & kills) ----
      for (const g of matchGames) {
        // ignore postseason games (playoffs + playins)
        if (excludedMatchIds.has(g.match_id)) continue;

        // find the match so we know which team was team1 / team2
        const match = matches.find((m) => m.id === g.match_id);
        if (!match) continue;

        const t1 = teams.find((t) => t.team_name === match.team1_name);
        const t2 = teams.find((t) => t.team_name === match.team2_name);
        if (!t1 || !t2) continue;

        const s1 = g.team1_score ?? 0;
        const s2 = g.team2_score ?? 0;

        if (doubleLossMatchIds.has(g.match_id)) {
          // Double loss: both teams "lose" by opponent's score; no one gains
          diff[t1.id] -= s2;
          diff[t2.id] -= s1;
        } else {
          // Normal per-game differential: winner gains, loser loses winner's score
          if (s1 > s2) {
            diff[t1.id] += s1;
            diff[t2.id] -= s1;
          } else if (s2 > s1) {
            diff[t2.id] += s2;
            diff[t1.id] -= s2;
          }
          // ties: no diff change
        }

        // Kills (Bo3): each team gets (4 - opponent_score)
        // This still applies for double loss: they got those KOs.
        kills[t1.id] += (4 - s2);
        kills[t2.id] += (4 - s1);
      }
    } else {
      // ---- CASE B: No matchGames → use matches table directly (Bo1) ----
      for (const m of matches) {
        // ignore postseason (playoffs + playins)
        if (excludedMatchIds.has(m.id)) continue;

        const t1 = teams.find((t) => t.team_name === m.team1_name);
        const t2 = teams.find((t) => t.team_name === m.team2_name);
        if (!t1 || !t2) continue;

        const s1 = m.team1_score ?? 0;
        const s2 = m.team2_score ?? 0;

        if (m.is_double_loss) {
          // Double loss: each team loses by the opponent's score
          diff[t1.id] -= s2;
          diff[t2.id] -= s1;
        } else {
          // Normal Bo1 differential: winner gains, loser loses winner's score
          if (s1 > s2) {
            diff[t1.id] += s1;   // winner
            diff[t2.id] -= s1;   // loser loses winner's score
          } else if (s2 > s1) {
            diff[t2.id] += s2;   // winner
            diff[t1.id] -= s2;   // loser loses winner's score
          }
          // ties: no change
        }

        // Kills (Bo1): each team gets (6 - opponent_score)
        // Again, we still award kills in a double loss.
        kills[t1.id] += (6 - s2);
        kills[t2.id] += (6 - s1);
      }
    }

    differentialMap = diff;
    killsMap = kills;
  }

  // 4) Sort by:
  //    - wins (desc)
  //    - differential (desc)
  //    - kills (desc)
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

    const killsA = killsMap[a.id] ?? 0;
    const killsB = killsMap[b.id] ?? 0;
    const killsDiff = killsB - killsA; // more kills is better
    if (killsDiff !== 0) return killsDiff;

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
          {#if showConference}<th>Conf</th>{/if}
          {#if showDivision}<th>Div</th>{/if}
          <th>W</th>
          <th>L</th>
          <th>Differential</th>
        </tr>
      </thead>

      <tbody>
        {#each sortedTeams as t, i}
          <tr>
            <td>{i + 1}</td>
            <td>{t.team_name}</td>
            <td>{t.coach_name}</td>
            {#if showConference}<td>{t.conference}</td>{/if}
            {#if showDivision}<td>{t.division}</td>{/if}
            <td style="text-align: center;">{t.season_wins}</td>
            <td style="text-align: center;">{t.season_losses}</td>
            <td style="text-align: center;">{differentialMap[t.id]}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
