<script>
  // Props from parent
  export let matches = [];
  export let matchGames = [];
  export let teams = [];
  export let phase = 'playoffs';

  // ----- Layout constants -----
  const MATCH_WIDTH = 260;
  const HORIZONTAL_GAP_X = 80;
  const ROUND_GAP_X = MATCH_WIDTH + HORIZONTAL_GAP_X;

  const MATCH_HEIGHT_EST = 90;
  const MATCH_GAP_Y = 40;
  const LEFT_MARGIN = 80;
  const TOP_MARGIN = 60;

  // Derived bracket data
  let rounds = [];
  let allMatches = [];
  let matchPositions = {};
  let connectionLines = [];
  let BRACKET_HEIGHT = 300;
  let BRACKET_WIDTH = 600;
  let hoveredPlayerId = null;

  // ----- Helpers -----

    function getPhaseFlag(m) {
        if (phase === 'playins') {
        return Boolean(m.is_playins);
        }
        // default: playoffs
        return Boolean(m.is_playoff);
    }

    function getPhaseRoundLabel(m) {
        if (phase === 'playins') {
        return m.playins_round ?? "Round 1";
        }
        return m.playoff_round ?? "Round 1";
    }

  function isThirdPlaceLabel(label) {
    const lower = (label || "").toLowerCase();
    return lower.includes("third");
  }

  function getRoundOrder(label) {
    const lower = (label || "").toLowerCase();
    if (lower.includes("round of 32")) return 1;
    if (lower.includes("round of 16")) return 2;
    if (lower.includes("quarter")) return 3;
    if (lower.includes("semi")) return 4;
    if (lower.includes("final")) return 5;
    return 99;
  }

  // ---- Standings-style seeding (same ordering as StandingsTable) ----

  function computeSeededTeams(allTeams, allMatches, allMatchGames) {
    if (!allTeams.length) return [];

    // 1) Only teams with placement get a seed
    const filteredTeams = allTeams.filter(
      (t) => t.placement !== null && t.placement !== undefined
    );

    if (!filteredTeams.length) return [];

    // 2) Playoff match_ids (to EXCLUDE from diff calc)
    const playoffMatchIds = new Set(
      allMatches.filter((m) => m.is_playoff).map((m) => m.id)
    );

    // 3) Differential map, mirroring StandingsTable.svelte
    const diff = {};
    for (const team of allTeams) {
      diff[team.id] = 0;
    }

    for (const g of allMatchGames) {
      if (playoffMatchIds.has(g.match_id)) continue;

      const match = allMatches.find((m) => m.id === g.match_id);
      if (!match) continue;

      const t1 = allTeams.find((t) => t.team_name === match.team1_name);
      const t2 = allTeams.find((t) => t.team_name === match.team2_name);
      if (!t1 || !t2) continue;

      if (g.team1_score > g.team2_score) {
        diff[t1.id] += g.team1_score;
        diff[t2.id] -= g.team1_score;
      } else if (g.team2_score > g.team1_score) {
        diff[t2.id] += g.team2_score;
        diff[t1.id] -= g.team2_score;
      }
      // ties → no change
    }

    // 4) Sort like StandingsTable
    const sortedTeams = [...filteredTeams].sort((a, b) => {
      const winsA = a.season_wins ?? 0;
      const winsB = b.season_wins ?? 0;
      const winsDiff = winsB - winsA;
      if (winsDiff !== 0) return winsDiff;

      const diffA = diff[a.id] ?? 0;
      const diffB = diff[b.id] ?? 0;
      const diffDiff = diffB - diffA;
      if (diffDiff !== 0) return diffDiff;

      const lossesA = a.season_losses ?? 0;
      const lossesB = b.season_losses ?? 0;
      const lossesDiff = lossesA - lossesB;
      if (lossesDiff !== 0) return lossesDiff;

      return a.team_name.localeCompare(b.team_name);
    });

    return sortedTeams;
  }

  function apply11TeamSeeding(bracketRounds, allTeams, allMatches, allMatchGames) {
    if (!bracketRounds.length || !allTeams.length) return;

    // Build seeds from standings
    const seededTeams = computeSeededTeams(allTeams, allMatches, allMatchGames);
    if (!seededTeams.length) return;

    const seedByTeamName = new Map();
    seededTeams.forEach((t, idx) => {
      seedByTeamName.set(t.team_name, idx + 1); // 1-based seeds
    });

    // Which seeds actually appear in the playoffs?
    const playoffSeeds = new Set();
    for (const round of bracketRounds) {
      for (const match of round.matches) {
        for (const p of match.players) {
          const s = seedByTeamName.get(p.name);
          if (s) playoffSeeds.add(s);
        }
      }
    }

    // Only try this structure in the exact 11-team playoff case
    if (playoffSeeds.size !== 11) return;

    // Find Round of 16 and Quarterfinal rounds
    const round16 = bracketRounds.find((r) =>
      r.name.toLowerCase().includes("round of 16")
    );
    const quarters = bracketRounds.find((r) =>
      r.name.toLowerCase().includes("quarter")
    );

    if (!round16 || !quarters) return;

    // ---- Reorder Quarterfinals to 1 / 4 / 3 / 2 seed pattern ----
    const mainQMatches = quarters.matches.filter((m) => !m.isThirdPlace);
    if (mainQMatches.length !== 4) return;

    const byMinSeed = new Map();
    for (const m of mainQMatches) {
      const seeds = m.players
        .map((p) => seedByTeamName.get(p.name))
        .filter((s) => typeof s === "number");
      if (!seeds.length) continue;
      const minSeed = Math.min(...seeds);
      byMinSeed.set(minSeed, m);
    }

    const neededSeeds = [1, 2, 3, 4];
    if (!neededSeeds.every((s) => byMinSeed.has(s))) {
      // Seed shape doesn't match the expected 1–4 / 11-team layout; bail out cleanly
      return;
    }

    // Desired vertical order for quarterfinals: 1, 4, 3, 2
    const orderedQF = [
      byMinSeed.get(1),
      byMinSeed.get(4),
      byMinSeed.get(3),
      byMinSeed.get(2)
    ];

    orderedQF.forEach((m, idx) => {
      m.slotIndex = idx;
    });

    // Keep only these as main matches (3rd place is handled in final round)
    quarters.matches = orderedQF.concat(
      quarters.matches.filter((m) => m.isThirdPlace)
    );

    // ---- Reorder Round of 16 based on which QF they feed into ----
    const mainR16 = round16.matches.filter((m) => !m.isThirdPlace);
    if (!mainR16.length) return;

    const qById = new Map(orderedQF.map((m) => [m.id, m]));

    const r16WithTargets = mainR16.map((m) => {
      const target = qById.get(m.nextMatchId);
      const targetIdx = target != null ? target.slotIndex : 99;
      return { match: m, targetIdx };
    });

    r16WithTargets.sort((a, b) => a.targetIdx - b.targetIdx);

    r16WithTargets.forEach((entry, idx) => {
      entry.match.slotIndex = idx;
    });

    round16.matches = r16WithTargets.map((e) => e.match);
  }

  // Infer best-of from per-game scores
  function inferBestOfFromGames(gameRows) {
    if (!gameRows || gameRows.length === 0) {
      return 1;
    }

    const winCounts = new Map();
    let tieCount = 0;

    for (const g of gameRows) {
      const winner = g.winner_id;

      if (!winner || winner === 0) {
        tieCount++;
        continue;
      }

      winCounts.set(winner, (winCounts.get(winner) || 0) + 1);
    }

    // No winner at all → treat as Bo1
    if (winCounts.size === 0) {
      return 1;
    }

    // Find the maximum number of wins from any winner_id
    let maxWins = 0;
    for (const wins of winCounts.values()) {
      if (wins > maxWins) maxWins = wins;
    }

    // Use the traditional formula: Best-of = 2*maxWins - 1
    return 2 * maxWins - 1;
  }

  function buildRoundsFromBackend(matches, matchGames) {
    const phaseMatches = matches.filter((m) => getPhaseFlag(m));
    if (!phaseMatches.length) return { rounds: [] };

    const phaseMatchIds = new Set(phaseMatches.map((m) => m.id));
    const gamesByMatch = new Map();

    matchGames.forEach((g) => {
      if (!phaseMatchIds.has(g.match_id)) return;
      const key = g.match_id;
      const existing = gamesByMatch.get(key) ?? [];
      existing.push(g);
      gamesByMatch.set(key, existing);
    });

    const grouped = new Map(); // roundLabel -> [matches]
    phaseMatches.forEach((m) => {
      const label = getPhaseRoundLabel(m);
      const arr = grouped.get(label) ?? [];
      arr.push(m);
      grouped.set(label, arr);
    });

    const allLabels = Array.from(grouped.keys());
    const mainLabels = allLabels.filter((l) => !isThirdPlaceLabel(l));
    const thirdLabels = allLabels.filter((l) => isThirdPlaceLabel(l));

    const sortedMainLabels = mainLabels.sort(
      (a, b) => getRoundOrder(a) - getRoundOrder(b)
    );

    const bracketRounds = [];
    let roundIndex = 0;

    // Main rounds
    for (const label of sortedMainLabels) {
      const roundMatchesRaw = grouped
        .get(label)
        .slice()
        .sort((a, b) => a.id - b.id);

      const matchesForRound = roundMatchesRaw.map((m, idx) => {
        const team1Name = m.team1_name ?? "Team 1";
        const team2Name = m.team2_name ?? "Team 2";
        const team1Score = m.team1_score ?? 0;
        const team2Score = m.team2_score ?? 0;
        const winnerName = m.winner_team_name ?? null;

        const gmArr = (gamesByMatch.get(m.id) ?? [])
          .slice()
          .sort((a, b) => (a.game_number ?? 0) - (b.game_number ?? 0));

        const games = gmArr.length
          ? gmArr.map((g) => ({
              scores: [g.team1_score ?? 0, g.team2_score ?? 0]
            }))
          : [];

        const bestOf = inferBestOfFromGames(gmArr);

        let matchLabel = "Finals";
        if (label.toLowerCase() !== "finals") {
          matchLabel = `${label} M${idx + 1}`;
        }

        return {
          id: `m${m.id}`,
          backendId: m.id,
          roundIndex,
          slotIndex: idx,
          label: matchLabel,
          roundLabel: label,
          bestOf,
          nextMatchId: null,
          winnerName,
          isThirdPlace: false,
          players: [
            { id: team1Name, name: team1Name, score: team1Score },
            { id: team2Name, name: team2Name, score: team2Score }
          ],
          games
        };
      });

      const round = {
        id: `round-${label}`,
        name: label,
        index: roundIndex,
        matches: matchesForRound
      };

      bracketRounds.push(round);
      roundIndex += 1;
    }

    // Third place matches share the final column, below the final
    if (thirdLabels.length && bracketRounds.length) {
      const finalRound = bracketRounds[bracketRounds.length - 1];

      for (const label of thirdLabels) {
        const thirdMatchesRaw = grouped
          .get(label)
          .slice()
          .sort((a, b) => a.id - b.id);

        thirdMatchesRaw.forEach((m) => {
          const team1Name = m.team1_name ?? "Team 1";
          const team2Name = m.team2_name ?? "Team 2";
          const team1Score = m.team1_score ?? 0;
          const team2Score = m.team2_score ?? 0;
          const winnerName = m.winner_team_name ?? null;

          const gmArr = (gamesByMatch.get(m.id) ?? [])
            .slice()
            .sort((a, b) => (a.game_number ?? 0) - (b.game_number ?? 0));

          const games = gmArr.length
            ? gmArr.map((g) => ({
                scores: [g.team1_score ?? 0, g.team2_score ?? 0]
              }))
            : [];

          const bestOf = inferBestOfFromGames(gmArr);

          const matchObj = {
            id: `m${m.id}`,
            backendId: m.id,
            roundIndex: finalRound.index,
            slotIndex: finalRound.matches.length,
            label: `${label}`,
            roundLabel: label,
            bestOf,
            nextMatchId: null,
            winnerName,
            isThirdPlace: true,
            players: [
              { id: team1Name, name: team1Name, score: team1Score },
              { id: team2Name, name: team2Name, score: team2Score }
            ],
            games
          };

          finalRound.matches.push(matchObj);
        });
      }
    }

    // Link winners between main rounds by team names
    for (let i = 0; i < bracketRounds.length - 1; i++) {
      const curRound = bracketRounds[i];
      const nextRound = bracketRounds[i + 1];

      // Only link main bracket matches, skip 3rd place
      const cur = curRound.matches.filter((m) => !m.isThirdPlace);
      const next = nextRound.matches.filter((m) => !m.isThirdPlace);

      if (!next.length) continue;

      for (const m of cur) {
        const prevTeams = new Set(m.players.map((p) => p.name));

        // Find the match in the next round that contains any of these teams
        const target = next.find((n) =>
          n.players.some((p) => prevTeams.has(p.name))
        );

        if (target) {
          m.nextMatchId = target.id;
        }
      }
    }

    // 🔧 Apply special seeding for 11-team playoff structures
    apply11TeamSeeding(bracketRounds, teams, matches, matchGames);

    return { rounds: bracketRounds };
  }

  function computeMatchPositions(rounds) {
  const positions = {};
  if (!rounds.length) return positions;

  // ----- Collect all main-bracket matches (ignore 3rd place for layout tree) -----
  const mainMatches = rounds.flatMap((r) =>
    r.matches.filter((m) => !m.isThirdPlace)
  );

  const mainById = new Map(mainMatches.map((m) => [m.id, m]));

  // Build parent -> children map based on nextMatchId
  const childrenByParentId = new Map(); // parentId -> [childMatch]
  const childIds = new Set();

  for (const m of mainMatches) {
    if (!m.nextMatchId) continue;
    if (!mainById.has(m.nextMatchId)) continue; // ignore links into 3rd place, etc.

    const arr = childrenByParentId.get(m.nextMatchId) ?? [];
    arr.push(m);
    childrenByParentId.set(m.nextMatchId, arr);
    childIds.add(m.id);
  }

  // Roots = matches that are never used as a child; usually the Final(s)
  const roots = mainMatches.filter((m) => !childIds.has(m.id));

  const step = MATCH_HEIGHT_EST + MATCH_GAP_Y;
  let nextLeafIndex = 0;

  // Recursively assign Y: leaves get sequential Y, parents at avg(children.y)
  function assignY(match) {
    const existing = positions[match.id];
    if (existing && typeof existing.y === "number") {
      return existing.y;
    }

    const children = childrenByParentId.get(match.id) ?? [];

    if (!children.length) {
      // Leaf: earliest round
      const y =
        TOP_MARGIN + MATCH_HEIGHT_EST / 2 + nextLeafIndex * step;
      nextLeafIndex++;

      positions[match.id] = positions[match.id] || {};
      positions[match.id].y = y;
      return y;
    } else {
      const childYs = children.map((c) => assignY(c));
      const sum = childYs.reduce((a, b) => a + b, 0);
      const y = sum / childYs.length;
      positions[match.id] = positions[match.id] || {};
      positions[match.id].y = y;
      return y;
    }
  }

  // Kick off Y-assignment from each root (typically the single Final)
  // If there are multiple independent trees, they will be stacked one after another.
  roots.forEach((root, idx) => {
    assignY(root);
    // Add a blank row between independent trees, if any
    if (idx < roots.length - 1) {
      nextLeafIndex++;
    }
  });

  // Now assign X positions for all main matches based on roundIndex
  for (const m of mainMatches) {
    const x =
      LEFT_MARGIN + m.roundIndex * ROUND_GAP_X + MATCH_WIDTH / 2;

    const existing = positions[m.id] || {};
    const y =
      typeof existing.y === "number"
        ? existing.y
        : TOP_MARGIN + MATCH_HEIGHT_EST / 2;

    positions[m.id] = { x, y };
  }

  // ----- Position third-place matches (if any), below their round's main matches -----
  for (const round of rounds) {
    const thirdMatches = round.matches.filter((m) => m.isThirdPlace);
    if (!thirdMatches.length) continue;

    const mainInRound = round.matches.filter((m) => !m.isThirdPlace);

    let baseY =
      TOP_MARGIN + MATCH_HEIGHT_EST / 2 + step * nextLeafIndex;

    if (mainInRound.length) {
      const ys = mainInRound
        .map((m) => positions[m.id]?.y)
        .filter((y) => typeof y === "number");
      if (ys.length) {
        baseY = Math.max(...ys) + MATCH_HEIGHT_EST + MATCH_GAP_Y * 2;
      }
    }

    thirdMatches
      .slice()
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .forEach((m, idx) => {
        const x =
          LEFT_MARGIN + m.roundIndex * ROUND_GAP_X + MATCH_WIDTH / 2;
        const y = baseY + idx * step;
        positions[m.id] = { x, y };
      });
  }

  return positions;
}



  function getMatchCenter(match) {
    return matchPositions[match.id];
  }

  function getWinner(match) {
    if (!match || !match.players) return null;

    if (match.winnerName) {
      const byName = match.players.find(
        (p) => p.name === match.winnerName
      );
      if (byName) return byName;
    }

    if (match.players[0].score === match.players[1].score) return null;
    return match.players[0].score > match.players[1].score
      ? match.players[0]
      : match.players[1];
  }

  function isWinner(player, match) {
    const w = getWinner(match);
    return w && w.id === player.id;
  }

  function getMatchById(id) {
    return allMatches.find((m) => m.id === id);
  }

  function buildConnections() {
    const lines = [];
    for (const match of allMatches) {
      if (!match.nextMatchId) continue;
      const next = getMatchById(match.nextMatchId);
      if (!next) continue;

      const winner = getWinner(match);
      const fromCenter = getMatchCenter(match);
      const toCenter = getMatchCenter(next);

      if (!fromCenter || !toCenter) continue;

      const from = {
        x: fromCenter.x + MATCH_WIDTH / 2,
        y: fromCenter.y
      };
      const to = {
        x: toCenter.x - MATCH_WIDTH / 2,
        y: toCenter.y
      };
      const midX = (from.x + to.x) / 2;

      const points = `${from.x},${from.y} ${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}`;

      lines.push({
        id: `${match.id}->${next.id}`,
        fromMatchId: match.id,
        toMatchId: next.id,
        playerId: winner ? winner.id : null,
        points
      });
    }
    return lines;
  }

  function isMatchHighlighted(match) {
    if (!hoveredPlayerId) return false;
    return match.players.some((p) => p.id === hoveredPlayerId);
  }

  function getMatchStyle(match) {
    const center = getMatchCenter(match);
    if (!center) return "";
    const { x, y } = center;
    return `
      left: ${x - MATCH_WIDTH / 2}px;
      top: ${y - MATCH_HEIGHT_EST / 2}px;
      width: ${MATCH_WIDTH}px;
    `;
  }

  // ----- Reactive wiring -----

  $: {
    const { rounds: builtRounds } = buildRoundsFromBackend(
      matches,
      matchGames
    );
    rounds = builtRounds;
  }

  $: allMatches = rounds.flatMap((r) => r.matches);
  $: matchPositions = computeMatchPositions(rounds);
  $: connectionLines = buildConnections();

  $: {
    // Width can still be based on number of rounds
    BRACKET_WIDTH =
      LEFT_MARGIN * 2 +
      (rounds.length ? rounds.length - 1 : 0) * ROUND_GAP_X +
      MATCH_WIDTH;

    // Height: derive from actual placed matches
    const ys = Object.values(matchPositions).map((p) => p.y);

    if (ys.length) {
      const maxY = Math.max(...ys);
      // match center is at y; add half match height plus bottom margin
      BRACKET_HEIGHT = maxY + MATCH_HEIGHT_EST / 2 + TOP_MARGIN;
    } else {
      BRACKET_HEIGHT = 200; // fallback
    }
  }
</script>



<div class="bracket-wrapper">
  <h2>{phase === 'playins' ? 'Playins Bracket' : 'Playoffs Bracket'}</h2>
  {#if !rounds.length}
    <div class="no-playoffs">
      {phase === 'playins'
        ? 'No playins matches found for this season.'
        : 'No playoff matches found for this season.'}
    </div>
  {:else}
    <div
      class="bracket-container"
      style={`width:${BRACKET_WIDTH}px; height:${BRACKET_HEIGHT}px;`}
    >
      <!-- Connection lines -->
      <svg
        class="connections"
        xmlns="http://www.w3.org/2000/svg"
        {BRACKET_WIDTH}
        {BRACKET_HEIGHT}
        width={BRACKET_WIDTH}
        height={BRACKET_HEIGHT}
        viewBox={`0 0 ${BRACKET_WIDTH} ${BRACKET_HEIGHT}`}
      >
        {#each connectionLines as line}
          <polyline
            points={line.points}
            class:highlight={hoveredPlayerId && line.playerId === hoveredPlayerId}
          />
        {/each}
      </svg>

      <!-- Match boxes -->
      {#each rounds as round}
        {#each round.matches as match}
          <div
            class="match-box {isMatchHighlighted(match) ? 'highlight' : ''}"
            style={getMatchStyle(match)}
          >
            <div class="match-header">
              <span class="match-label">{match.label}</span>
              <span class="match-meta">
                {match.bestOf === 1 ? "Single game" : `Bo${match.bestOf}`}
              </span>
            </div>
            <div class="players">
              {#each match.players as player, pIndex}
                <div
                  class="player-row
                    {hoveredPlayerId === player.id ? 'active' : ''}
                    {isWinner(player, match) ? 'winner' : ''}"
                  on:mouseenter={() => (hoveredPlayerId = player.id)}
                  on:mouseleave={() => (hoveredPlayerId = null)}
                >
                  <div class="player-main">
                    {#if isWinner(player, match)}
                      <span class="winner-mark" title="Match winner">🏆</span>
                    {/if}
                    <span class="player-name">{player.name}</span>
                  </div>

                  {#if match.games && match.games.length > 0}
                    <div class="player-game-scores">
                      {#each match.games as game}
                        <span
                          class="player-game-score"
                          class:loss={game.scores[pIndex] < game.scores[1 - pIndex]}
                        >
                          {game.scores[pIndex]}
                        </span>
                      {/each}
                    </div>
                  {:else}
                    <span class="player-score">{player.score}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/each}

      <!-- Round labels -->
      {#each rounds as round}
        <div
          class="round-label"
          style={`left: ${
            LEFT_MARGIN + round.index * ROUND_GAP_X + MATCH_WIDTH / 2
          }px; top: 16px;`}
        >
          {round.name}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bracket-wrapper {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
    padding: 1rem;
    background: #0b1020;
    color: #f5f5f7;
  }

  .bracket-wrapper h2 {
    margin-bottom: 1rem;
    font-weight: 600;
  }

  .no-playoffs {
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.4);
    font-size: 0.9rem;
    color: #cbd5f5;
  }

  .bracket-container {
    position: relative;
    border-radius: 0.75rem;
    background: radial-gradient(circle at top left, #1b2440, #050813);
    overflow: visible;
  }

  .connections {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  }

  .connections polyline {
    fill: none;
    stroke: rgba(200, 200, 220, 0.4);
    stroke-width: 2;
  }

  .connections polyline.highlight {
    stroke: #ffb347;
    stroke-width: 4;
  }

  .match-box {
    position: absolute;
    z-index: 2;
    background: rgba(16, 23, 48, 0.95);
    border-radius: 0.6rem;
    border: 1px solid rgba(180, 190, 220, 0.2);
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
    padding: 0.35rem 0.55rem 0.4rem;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-height: 90px;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.15s ease,
      background-color 0.15s ease;
  }

  .match-box.highlight {
    border-color: #ffb347;
    box-shadow: 0 0 0 2px rgba(255, 179, 71, 0.3),
      0 12px 26px rgba(0, 0, 0, 0.5);
    background: rgba(20, 32, 72, 0.98);
    transform: translateY(-2px);
  }

  .match-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.85;
  }

  .match-label {
    font-weight: 600;
  }

  .match-meta {
    font-size: 0.7rem;
  }

  .players {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .player-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    padding: 0.15rem 0.25rem;
    border-radius: 0.4rem;
    cursor: pointer;
    border-left: 3px solid transparent;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      transform 0.1s ease,
      border-left-color 0.15s ease;
  }

  .player-row:hover,
  .player-row.active {
    background: rgba(255, 179, 71, 0.15);
    color: #ffe6c7;
    transform: translateX(1px);
  }

  .player-row.winner {
    border-left-color: #ffb347;
    font-weight: 600;
  }

  .player-main {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    min-width: 0;
    flex: 1;
  }

  .winner-mark {
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .player-name {
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
  }

  .player-score {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .player-game-scores {
    display: flex;
    gap: 0.25rem;
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
  }

  .player-game-score {
    min-width: 0.7rem;
    text-align: right;
  }

  .player-game-score.loss {
    opacity: 0.35;
  }

  .round-label {
    position: absolute;
    transform: translateX(-50%);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.7;
    pointer-events: none;
  }
</style>
