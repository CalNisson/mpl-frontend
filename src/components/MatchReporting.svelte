<script>
  import { onMount, onDestroy } from "svelte";
  import {
    getSeasonMatchesForReporting,
    getSeasonRostersForReporting,
    uploadMatchReport,
  } from "../lib/api.js";

  export let seasonId;
  export let canEdit = false; // league master/admin gate (parent should enforce)

  // Analyzer iframe (served from /public)
  const ANALYZER_PATH = `${import.meta.env.BASE_URL}replay_analyzer.html`;

  let loading = true;
  let error = "";
  let matches = [];
  let rosterRows = [];

  // replay analysis payload received from iframe
  let analysis = null; // { replayUrl, analysis: json }

  // match selection
  let selectedWeek = "";
  let selectedMatchId = "";

  // computed mapping + validation
  let mapping = null; // { p1: {...}, p2: {...}, mismatches: [...] }

  // preview + override
  let readyToUpload = false;
  let showOverride = false;

  // override fields
  let ovTeam1Id = "";
  let ovTeam2Id = "";
  let ovTeam1Score = 1;
  let ovTeam2Score = 0;
  let ovWinnerId = "";
  let ovReplay = "";

  // pokemon stat overrides (optional, only used if showOverride)
  let ovPokemonStats = []; // [{ team_id, pokemon_id, pokemon_name, kills, deaths }]

  // ---------- helpers ----------
  function setErr(e) {
    error = e?.message ?? String(e);
  }

  function normName(s) {
    if (!s) return "";
    return String(s)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function analysisPlayers() {
    const stats = analysis?.analysis?.stats;
    if (!stats) return [];

    // Supports both {P1:{...},P2:{...}} and array forms
    if (Array.isArray(stats)) return stats;
    return Object.entries(stats).map(([key, v]) => ({ key, ...v }));
  }

  function getWeeks() {
    const set = new Set(matches.map((m) => m.week).filter((w) => w != null));
    return Array.from(set).sort((a, b) => a - b);
  }

  function matchesForWeek(week) {
    const w = Number(week);
    if (!w) return [];
    return matches.filter((m) => (m.week ?? 0) === w);
  }

  function rosterForWeek(week) {
    const w = Number(week);
    // include pokemon if acquired_week is null/0 or <= week, and not dropped or dropped > week
    return rosterRows.filter((r) => {
      const a = r.acquisition_week ?? 0;
      const d = r.dropped_week ?? null;
      const okAcquire = a === 0 || a <= w;
      const okDrop = d == null || d > w;
      return okAcquire && okDrop;
    });
  }

  function groupRoster(rows) {
    const byTeam = {};
    for (const r of rows) {
      if (!byTeam[r.team_id]) {
        byTeam[r.team_id] = {
          team_id: r.team_id,
          team_name: r.team_name,
          coach_id: r.coach_id ?? null,
          coach_name: r.coach_name ?? null,
          pokemon: [],
          pokemonSet: new Set(),
        };
      }
      byTeam[r.team_id].pokemon.push({ pokemon_id: r.pokemon_id, pokemon_name: r.pokemon_name });
      byTeam[r.team_id].pokemonSet.add(normName(r.pokemon_name));
    }
    return Object.values(byTeam);
  }

  function buildPokemonStatsFromAnalysis(player, team_id, rosterTeam) {
    const team = player?.team;
    const formes = team?.formes ?? [];

    const stats = [];
    for (const f of formes) {
      if (!f?.brought) continue;
      const pokemon_name = f?.name ?? f?.id ?? "";
      const pokemon_key = normName(pokemon_name);

      // map to pokemon_id using roster (best effort: exact normalized match)
      const rosterMon = rosterTeam?.pokemon?.find((p) => normName(p.pokemon_name) === pokemon_key);
      if (!rosterMon) continue;

      const k = Array.isArray(f.kills) ? f.kills.reduce((a, b) => a + (b ?? 0), 0) : 0;
      const d = f.fainted ? 1 : 0;
      stats.push({
        team_id,
        pokemon_id: rosterMon.pokemon_id,
        pokemon_name: rosterMon.pokemon_name,
        kills: k,
        deaths: d,
      });
    }
    return stats;
  }

  function computeMapping() {
    mapping = null;
    readyToUpload = false;
    showOverride = false;

    const wk = Number(selectedWeek);
    const matchId = Number(selectedMatchId);
    if (!analysis || !wk || !matchId) return;

    const players = analysisPlayers();
    if (players.length < 2) {
      mapping = { error: "Replay analysis did not contain two players.", mismatches: [] };
      return;
    }

    const m = matches.find((x) => x.id === matchId);
    if (!m) {
      mapping = { error: "Selected match not found.", mismatches: [] };
      return;
    }

    const rosterGrouped = groupRoster(rosterForWeek(wk));

    function usedMons(p) {
      const formes = p?.team?.formes ?? [];
      return formes
        .filter((f) => f?.brought)
        .map((f) => normName(f?.name ?? f?.id ?? ""))
        .filter(Boolean);
    }

    function bestRosterForPlayer(p) {
      const used = new Set(usedMons(p));
      let best = null;
      for (const rt of rosterGrouped) {
        let overlap = 0;
        let missing = [];
        for (const u of used) {
          if (rt.pokemonSet.has(u)) overlap += 1;
          else missing.push(u);
        }
        const score = overlap * 1000 - missing.length; // strong preference for overlap
        if (!best || score > best.score) best = { rt, overlap, missing, score, used: Array.from(used) };
      }
      return best;
    }

    const p1 = players[0];
    const p2 = players[1];
    const b1 = bestRosterForPlayer(p1);
    let b2 = bestRosterForPlayer(p2);

    // Ensure different teams if possible
    if (b2 && b1 && b2.rt.team_id === b1.rt.team_id) {
      // pick next best for p2
      const used2 = new Set(usedMons(p2));
      const candidates = rosterGrouped
        .filter((rt) => rt.team_id !== b1.rt.team_id)
        .map((rt) => {
          let overlap = 0;
          let missing = [];
          for (const u of used2) {
            if (rt.pokemonSet.has(u)) overlap += 1;
            else missing.push(u);
          }
          const score = overlap * 1000 - missing.length;
          return { rt, overlap, missing, score, used: Array.from(used2) };
        })
        .sort((a, b) => b.score - a.score);
      if (candidates.length) b2 = candidates[0];
    }

    const mismatches = [];
    if (!b1 || !b2) {
      mismatches.push({ kind: "mapping", message: "Could not map both replay players to teams." });
    } else {
      if (b1.missing.length) {
        mismatches.push({
          kind: "roster",
          team_id: b1.rt.team_id,
          team_name: b1.rt.team_name,
          player: p1.username,
          missing: b1.missing,
        });
      }
      if (b2.missing.length) {
        mismatches.push({
          kind: "roster",
          team_id: b2.rt.team_id,
          team_name: b2.rt.team_name,
          player: p2.username,
          missing: b2.missing,
        });
      }
    }

    // Determine score + winner from analysis
    const p1Win = !!p1.win;
    const p2Win = !!p2.win;
    let team1_score = null;
    let team2_score = null;
    let winner_team_id = null;
    if (p1Win !== p2Win) {
      team1_score = p1Win ? 1 : 0;
      team2_score = p2Win ? 1 : 0;
      winner_team_id = p1Win ? b1?.rt?.team_id : b2?.rt?.team_id;
    }

    // Map replay players -> match teams (team1/team2) by ID if they line up, otherwise keep mapped IDs
    const mappedTeam1 = b1?.rt?.team_id;
    const mappedTeam2 = b2?.rt?.team_id;
    const aligns = mappedTeam1 === m.team1_id && mappedTeam2 === m.team2_id;
    const alignsSwapped = mappedTeam1 === m.team2_id && mappedTeam2 === m.team1_id;

    let finalTeam1 = m.team1_id;
    let finalTeam2 = m.team2_id;
    let finalWinner = null;
    if (winner_team_id) {
      finalWinner = winner_team_id;
    }
    if (!aligns && alignsSwapped) {
      // If our mapping is swapped relative to the match record, flip the score assignment too
      if (team1_score != null && team2_score != null) {
        const tmp = team1_score;
        team1_score = team2_score;
        team2_score = tmp;
      }
    }

    const pstats1 = buildPokemonStatsFromAnalysis(p1, mappedTeam1, b1?.rt);
    const pstats2 = buildPokemonStatsFromAnalysis(p2, mappedTeam2, b2?.rt);
    const pokemon_stats = [...pstats1, ...pstats2];

    mapping = {
      match: m,
      p1: { username: p1.username, team: b1?.rt, overlap: b1?.overlap, missing: b1?.missing ?? [] },
      p2: { username: p2.username, team: b2?.rt, overlap: b2?.overlap, missing: b2?.missing ?? [] },
      replay_url: analysis.replayUrl,
      suggested: {
        team1_id: finalTeam1,
        team2_id: finalTeam2,
        team1_score,
        team2_score,
        winner_id: finalWinner,
        pokemon_stats,
      },
      mismatches,
    };

    readyToUpload = mismatches.length === 0 && team1_score != null && team2_score != null && finalWinner != null;

    // preload override defaults
    ovReplay = analysis.replayUrl ?? "";
    ovTeam1Id = String(finalTeam1 ?? "");
    ovTeam2Id = String(finalTeam2 ?? "");
    ovTeam1Score = team1_score ?? 1;
    ovTeam2Score = team2_score ?? 0;
    ovWinnerId = String(finalWinner ?? "");
    ovPokemonStats = pokemon_stats.map((x) => ({ ...x }));
  }

  async function load() {
    if (!seasonId) return;
    loading = true;
    error = "";
    analysis = null;
    selectedWeek = "";
    selectedMatchId = "";
    mapping = null;

    try {
      const [m, r] = await Promise.all([
        getSeasonMatchesForReporting(seasonId),
        getSeasonRostersForReporting(seasonId),
      ]);
      matches = Array.isArray(m) ? m : [];
      rosterRows = Array.isArray(r) ? r : [];
    } catch (e) {
      setErr(e);
      matches = [];
      rosterRows = [];
    } finally {
      loading = false;
    }
  }

  function onMessage(ev) {
    const data = ev?.data;
    if (!data || data.type !== "mpl_replay_analysis") return;
    analysis = { replayUrl: data.replayUrl ?? "", analysis: data.analysis ?? null };
    // reset downstream selection
    selectedWeek = "";
    selectedMatchId = "";
    mapping = null;
    readyToUpload = false;
    showOverride = false;
  }

  onMount(() => {
    window.addEventListener("message", onMessage);
    load();
  });

  onDestroy(() => {
    window.removeEventListener("message", onMessage);
  });

  $: if (analysis && selectedWeek && selectedMatchId) {
    computeMapping();
  }

  async function onUpload() {
    const matchId = Number(selectedMatchId);
    if (!matchId) return;

    const payload = showOverride
      ? {
          replay: ovReplay?.trim() || null,
          team1_score: Number(ovTeam1Score),
          team2_score: Number(ovTeam2Score),
          winner_id: Number(ovWinnerId),
          pokemon_stats: (ovPokemonStats ?? []).map((x) => ({
            team_id: Number(x.team_id),
            pokemon_id: Number(x.pokemon_id),
            kills: Number(x.kills),
            deaths: Number(x.deaths),
          })),
        }
      : {
          replay: mapping?.replay_url?.trim() || null,
          team1_score: mapping?.suggested?.team1_score,
          team2_score: mapping?.suggested?.team2_score,
          winner_id: mapping?.suggested?.winner_id,
          pokemon_stats: mapping?.suggested?.pokemon_stats?.map((x) => ({
            team_id: x.team_id,
            pokemon_id: x.pokemon_id,
            kills: x.kills,
            deaths: x.deaths,
          })),
        };

    error = "";
    try {
      await uploadMatchReport(matchId, payload);
      // Refresh match list (so schedule reflects replay URL and score)
      await load();
    } catch (e) {
      setErr(e);
    }
  }

  function diffText(k, d) {
    return `${k - d}`;
  }

  function summarizeTeam(team_id) {
    const stats = (mapping?.suggested?.pokemon_stats ?? []).filter((s) => s.team_id === team_id);
    const kills = stats.reduce((a, s) => a + (s.kills ?? 0), 0);
    const deaths = stats.reduce((a, s) => a + (s.deaths ?? 0), 0);
    return { kills, deaths, diff: kills - deaths };
  }
</script>

{#if !canEdit}
  <div class="card muted">Match Reporting is only available to League Masters and Admins.</div>
{:else}
  <div class="grid">
    <div class="card">
      <div class="card-title">Replay Analyzer</div>
      <div class="muted" style="margin:.25rem 0 .5rem;">
        Paste the replay URL into the analyzer and click Analyze. When it finishes, the results will populate on the right.
      </div>
      <iframe class="analyzer" title="Replay Analyzer" src={ANALYZER_PATH} />
    </div>

    <div class="card">
      <div class="card-title">Match Upload</div>

      {#if loading}
        <div class="muted">Loading match data…</div>
      {:else}
        {#if error}
          <div class="error">{error}</div>
        {/if}

        {#if !analysis}
          <div class="muted">Analyze a replay to begin.</div>
        {:else}
          <div class="block">
            <div class="muted">Replay:</div>
            <div class="mono">{analysis.replayUrl}</div>
          </div>

          <div class="row">
            <label class="field">
              <span class="lab">Week</span>
              <select class="select" bind:value={selectedWeek}>
                <option value="">Select week…</option>
                {#each getWeeks() as w}
                  <option value={w}>{w}</option>
                {/each}
              </select>
            </label>

            <label class="field">
              <span class="lab">Match</span>
              <select class="select" bind:value={selectedMatchId} disabled={!selectedWeek}>
                <option value="">Select match…</option>
                {#each matchesForWeek(selectedWeek) as m (m.id)}
                  <option value={m.id}>
                    {m.team1_name} vs {m.team2_name} (#{m.id})
                  </option>
                {/each}
              </select>
            </label>
          </div>

          {#if mapping}
            {#if mapping.error}
              <div class="error">{mapping.error}</div>
            {:else}
              <div class="block">
                <div class="muted">Replay players mapped to teams:</div>
                <ul>
                  <li>
                    <span class="mono">{mapping.p1.username}</span>
                    → <b>{mapping.p1.team?.team_name}</b>
                    {#if mapping.p1.team?.coach_name}
                      <span class="muted">({mapping.p1.team.coach_name})</span>
                    {/if}
                  </li>
                  <li>
                    <span class="mono">{mapping.p2.username}</span>
                    → <b>{mapping.p2.team?.team_name}</b>
                    {#if mapping.p2.team?.coach_name}
                      <span class="muted">({mapping.p2.team.coach_name})</span>
                    {/if}
                  </li>
                </ul>
              </div>

              {#if mapping.mismatches?.length}
                <div class="error">
                  <div style="font-weight:800; margin-bottom:.25rem;">Roster mismatches (upload blocked)</div>
                  {#each mapping.mismatches as mm}
                    {#if mm.kind === "roster"}
                      <div>
                        <b>{mm.player}</b> has Pokémon not on <b>{mm.team_name}</b>: {mm.missing.join(", ")}
                      </div>
                    {:else}
                      <div>{mm.message}</div>
                    {/if}
                  {/each}
                </div>
              {/if}

              <div class="divider"></div>

              <div class="preview">
                <div class="preview-title">Preview</div>
                <div class="preview-line">
                  <b>{mapping.match.team1_name}</b>
                  <span class="muted">vs</span>
                  <b>{mapping.match.team2_name}</b>
                </div>
                {#if mapping.suggested.winner_id}
                  <div class="preview-line">
                    {#if mapping.suggested.winner_id === mapping.match.team1_id}
                      <b>{mapping.suggested.team1_score}</b>
                      <span class="muted">-</span>
                      {mapping.suggested.team2_score}
                    {:else}
                      {mapping.suggested.team1_score}
                      <span class="muted">-</span>
                      <b>{mapping.suggested.team2_score}</b>
                    {/if}
                  </div>
                {:else}
                  <div class="muted">No winner detected in replay analysis.</div>
                {/if}

                <div class="stats-row">
                  {#each [mapping.p1.team?.team_id, mapping.p2.team?.team_id].filter(Boolean) as tid (tid)}
                    <div class="stat-card">
                      <div class="muted">Team {tid}</div>

                      <div>Wins: {summarizeTeam(tid).wins}</div>
                      <div>Losses: {summarizeTeam(tid).losses}</div>
                      <div>Diff: {summarizeTeam(tid).diff}</div>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="row" style="margin-top:.75rem;">
                <button class="btn" on:click={() => (showOverride = !showOverride)}>
                  {showOverride ? "Hide override" : "Override / edit before upload"}
                </button>
                <button class="btn coral" on:click={onUpload} disabled={!readyToUpload && !showOverride}>
                  Upload
                </button>
              </div>

              {#if showOverride}
                <div class="override">
                  <div class="muted" style="margin-bottom:.5rem;">
                    Override lets you manually adjust the computed values before upload.
                  </div>

                  <label class="field">
                    <span class="lab">Replay URL</span>
                    <input class="select" type="text" bind:value={ovReplay} />
                  </label>

                  <div class="row">
                    <label class="field">
                      <span class="lab">Team 1 score</span>
                      <input class="select" type="number" min="0" step="1" bind:value={ovTeam1Score} />
                    </label>
                    <label class="field">
                      <span class="lab">Team 2 score</span>
                      <input class="select" type="number" min="0" step="1" bind:value={ovTeam2Score} />
                    </label>
                    <label class="field">
                      <span class="lab">Winner team_id</span>
                      <input class="select" type="number" min="1" step="1" bind:value={ovWinnerId} />
                    </label>
                  </div>

                  <div class="divider"></div>

                  <div class="muted" style="margin-bottom:.25rem;">Pokémon stats (kills/deaths)</div>
                  <div class="poke-grid">
                    {#each ovPokemonStats as ps, i (ps.team_id + ':' + ps.pokemon_id)}
                      <div class="poke-row">
                        <div class="mono" title="{ps.team_id}">{ps.pokemon_name}</div>
                        <input class="select" type="number" min="0" step="1" bind:value={ovPokemonStats[i].kills} />
                        <input class="select" type="number" min="0" step="1" bind:value={ovPokemonStats[i].deaths} />
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            {/if}
          {/if}
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  @media (max-width: 980px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .card {
    border-radius: 16px;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .card-title {
    font-weight: 900;
    font-size: 1.05rem;
    margin-bottom: 0.4rem;
  }
  .muted {
    opacity: 0.75;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.9rem;
    word-break: break-all;
  }
  .analyzer {
    width: 100%;
    height: 70vh;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.25);
  }
  .row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: end;
  }
  .field {
    display: grid;
    gap: 0.25rem;
    min-width: 180px;
    flex: 1;
  }
  .lab {
    font-size: 0.85rem;
    opacity: 0.9;
  }
  .select {
    padding: 0.55rem 0.65rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.25);
    color: rgba(255, 255, 255, 0.92);
  }
  select.select {
    appearance: none;
  }
  .btn {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.92);
    padding: 0.55rem 0.85rem;
    border-radius: 12px;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .coral {
    background: rgba(255, 107, 107, 0.18);
    border-color: rgba(255, 107, 107, 0.35);
  }
  .divider {
    margin: 0.85rem 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
  }
  .error {
    background: rgba(255, 80, 80, 0.12);
    border: 1px solid rgba(255, 80, 80, 0.25);
    padding: 0.6rem 0.75rem;
    border-radius: 12px;
    margin: 0.5rem 0;
  }
  .block {
    margin: 0.75rem 0;
  }
  .preview {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.18);
  }
  .preview-title {
    font-weight: 900;
    margin-bottom: 0.4rem;
  }
  .preview-line {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .stats-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-top: 0.65rem;
  }
  .stat-card {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 0.5rem 0.6rem;
    background: rgba(255, 255, 255, 0.04);
  }
  .override {
    margin-top: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.18);
  }
  .poke-grid {
    display: grid;
    gap: 0.35rem;
  }
  .poke-row {
    display: grid;
    grid-template-columns: 1fr 90px 90px;
    gap: 0.5rem;
    align-items: center;
  }
</style>
