<script>
  export let teams = [];         // standings rows (wins/losses/etc)
  export let seasonTeams = [];   // season teams rows (colors live here)
  export let matches = [];       // needed so we know which matches are playoffs/playins
  export let matchGames = [];    // individual game results

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
    (matches ?? [])
      .filter((m) => m.is_playoff || m.is_playins)
      .map((m) => m.id)
  );

  // Helper: does this season actually have any matchGames rows?
  $: hasMatchGames = Array.isArray(matchGames) && matchGames.length > 0;

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

  function textColorForBg(hex) {
    const c = hexToRgb(hex);
    if (!c) return null;
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return luminance > 155 ? "#0b1020" : "#ffffff";
  }

  // Build a lookup from seasonTeams -> color_primary by team id
  $: colorById = new Map(
    (seasonTeams ?? [])
      .filter((t) => t?.id != null)
      .map((t) => [Number(t.id), normalizeHex(t?.color_primary)])
  );

  function teamPillStyle(teamRow) {
    // standings row id matches seasonTeams id
    const base = colorById.get(Number(teamRow?.id)) ?? null;
    if (!base) return "";
    const fg = textColorForBg(base) ?? "#ffffff";
    return `background:${base}; color:${fg}; border-color: rgba(255,255,255,0.14);`;
  }

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
    for (const team of teams ?? []) {
      diff[team.id] = 0;
      kills[team.id] = 0;
    }

    // Set of double-loss matches
    const doubleLossMatchIds = new Set(
      (matches ?? [])
        .filter((m) => m.is_double_loss)
        .map((m) => m.id)
    );

    if (hasMatchGames) {
      // ---- CASE A: Use matchGames (per-game differential & kills) ----
      for (const g of matchGames ?? []) {
        // ignore postseason games (playoffs + playins)
        if (excludedMatchIds.has(g.match_id)) continue;

        // find the match so we know which team was team1 / team2
        const match = (matches ?? []).find((m) => m.id === g.match_id);
        if (!match) continue;

        const t1 = (teams ?? []).find((t) => t.team_name === match.team1_name);
        const t2 = (teams ?? []).find((t) => t.team_name === match.team2_name);
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
        kills[t1.id] += (4 - s2);
        kills[t2.id] += (4 - s1);
      }
    } else {
      // ---- CASE B: No matchGames → use matches table directly (Bo1) ----
      for (const m of matches ?? []) {
        // ignore postseason (playoffs + playins)
        if (excludedMatchIds.has(m.id)) continue;

        const t1 = (teams ?? []).find((t) => t.team_name === m.team1_name);
        const t2 = (teams ?? []).find((t) => t.team_name === m.team2_name);
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
            diff[t1.id] += s1;
            diff[t2.id] -= s1;
          } else if (s2 > s1) {
            diff[t2.id] += s2;
            diff[t1.id] -= s2;
          }
          // ties: no change
        }

        // Kills (Bo1): each team gets (6 - opponent_score)
        kills[t1.id] += (6 - s2);
        kills[t2.id] += (6 - s1);
      }
    }

    differentialMap = diff;
    killsMap = kills;
  }

  // 4) Sort by wins → diff → kills → losses → team_name
  $: sortedTeams = [...(filteredTeams ?? [])].sort((a, b) => {
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
    const killsDiff = killsB - killsA;
    if (killsDiff !== 0) return killsDiff;

    const lossesA = a.season_losses ?? 0;
    const lossesB = b.season_losses ?? 0;
    const lossesDiff = lossesA - lossesB;
    if (lossesDiff !== 0) return lossesDiff;

    return (a.team_name ?? "").localeCompare(b.team_name ?? "");
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
            <td>
              <span class="team-pill" style={teamPillStyle(t)}>
                {t.team_name}
              </span>
            </td>
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

<style>
  .team-pill{
    display:inline-block;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.12);
    font-weight: 900;
    line-height: 1.2;
    background: rgba(255,255,255,0.06); /* fallback if no color */
  }
</style>
