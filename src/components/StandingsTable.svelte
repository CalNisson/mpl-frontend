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

  // Truthiness helper because the API/db might return 0/1, "true"/"false", or actual booleans
  function truthyFlag(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (v == null) return false;
    if (typeof v === "number") return v !== 0;
    const s = String(v).trim().toLowerCase();
    if (s === "true" || s === "t" || s === "1" || s === "yes" || s === "y") return true;
    if (s === "false" || s === "f" || s === "0" || s === "no" || s === "n" || s === "") return false;
    // fallback: JS truthiness
    return !!v;
  }

  // 2) Build a Set of *postseason* match_ids (playoffs + playins) to EXCLUDE from ALL regular-season calcs
  $: excludedMatchIds = new Set(
    (matches ?? [])
      .filter((m) => truthyFlag(m.is_playoff) || truthyFlag(m.is_playins))
      .map((m) => Number(m.id))
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
  let winsMap = {};
  let lossesMap = {};

  // 3) Compute regular-season W/L from *matches only* (NOT per-game).
  //    - Differential is also computed from the match result totals (team1_score/team2_score).
  //    - Kills can still use matchGames when present (but still excludes postseason).
  $: {
    const diff = {};
    const kills = {};
    const wins = {};
    const losses = {};

    // Initialize ALL teams (so games vs non-placed teams still count)
    for (const team of teams ?? []) {
      diff[team.id] = 0;
      kills[team.id] = 0;
      wins[team.id] = 0;
      losses[team.id] = 0;
    }

    const teamIdByName = new Map((teams ?? []).map((t) => [t.team_name, t.id]));

    // ---- W/L + Diff from MATCHES (regular season only) ----
    for (const m of matches ?? []) {
      if (excludedMatchIds.has(Number(m.id))) continue;

      const t1id = teamIdByName.get(m.team1_name);
      const t2id = teamIdByName.get(m.team2_name);
      if (t1id == null || t2id == null) continue;

      const isDL = truthyFlag(m.is_double_loss);

      if (isDL) {
        losses[t1id] += 1;
        losses[t2id] += 1;
        // double loss diff: both teams lose by opponent's score
        const s1 = Number(m.team1_score ?? 0);
        const s2 = Number(m.team2_score ?? 0);
        if (Number.isFinite(s1) && Number.isFinite(s2)) {
          diff[t1id] -= s2;
          diff[t2id] -= s1;
        }
        continue;
      }

      // Prefer winner_team_name if present; otherwise compare scores
      const winner = m.winner_team_name ?? null;
      const s1 = Number(m.team1_score ?? 0);
      const s2 = Number(m.team2_score ?? 0);

      if (winner && winner === m.team1_name) {
        wins[t1id] += 1;
        losses[t2id] += 1;
        diff[t1id] += s1;
        diff[t2id] -= s1;
      } else if (winner && winner === m.team2_name) {
        wins[t2id] += 1;
        losses[t1id] += 1;
        diff[t2id] += s2;
        diff[t1id] -= s2;
      } else if (Number.isFinite(s1) && Number.isFinite(s2)) {
        if (s1 > s2) {
          wins[t1id] += 1;
          losses[t2id] += 1;
          diff[t1id] += s1;
          diff[t2id] -= s1;
        } else if (s2 > s1) {
          wins[t2id] += 1;
          losses[t1id] += 1;
          diff[t2id] += s2;
          diff[t1id] -= s2;
        } else {
          // tie: ignore for now (no W/L, no diff)
        }
      }
    }

    // ---- Kills: use matchGames when present, else approximate from matches ----
    if (hasMatchGames) {
      // For each GAME row, apply the same kill formula you already had,
      // but never include postseason games.
      for (const g of matchGames ?? []) {
        if (excludedMatchIds.has(Number(g.match_id))) continue;

        const match = (matches ?? []).find((m) => Number(m.id) === Number(g.match_id));
        if (!match) continue;

        const t1id = teamIdByName.get(match.team1_name);
        const t2id = teamIdByName.get(match.team2_name);
        if (t1id == null || t2id == null) continue;

        const s1 = Number(g.team1_score ?? 0);
        const s2 = Number(g.team2_score ?? 0);

        // Kills (Bo3): each team gets (4 - opponent_score)
        kills[t1id] += (4 - s2);
        kills[t2id] += (4 - s1);
      }
    } else {
      // Fallback: Bo1-style kill estimate from match totals
      for (const m of matches ?? []) {
        if (excludedMatchIds.has(Number(m.id))) continue;

        const t1id = teamIdByName.get(m.team1_name);
        const t2id = teamIdByName.get(m.team2_name);
        if (t1id == null || t2id == null) continue;

        const s1 = Number(m.team1_score ?? 0);
        const s2 = Number(m.team2_score ?? 0);

        // Kills (Bo1): each team gets (6 - opponent_score)
        kills[t1id] += (6 - s2);
        kills[t2id] += (6 - s1);
      }
    }

    differentialMap = diff;
    killsMap = kills;
    winsMap = wins;
    lossesMap = losses;
  }

  // 4) Sort by wins → diff → kills → losses → team_name
  $: sortedTeams = [...(filteredTeams ?? [])].sort((a, b) => {
    const winsA = winsMap[a.id] ?? (a.season_wins ?? 0);
    const winsB = winsMap[b.id] ?? (b.season_wins ?? 0);
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

    const lossesA = lossesMap[a.id] ?? (a.season_losses ?? 0);
    const lossesB = lossesMap[b.id] ?? (b.season_losses ?? 0);
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
            <td style="text-align: center;">{winsMap[t.id] ?? t.season_wins ?? 0}</td>
            <td style="text-align: center;">{lossesMap[t.id] ?? t.season_losses ?? 0}</td>
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
