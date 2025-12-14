<script>
  import { onMount } from "svelte";
  import { getCoachProfileByName, getCoachSeasonDetails } from "../lib/api.js";

  let coachName = "";
  let loading = true;
  let error = "";

  let coach = null;
  let seasons = [];
  let openSeasonId = null;

  let seasonDetails = {};

  function getQueryParam(key) {
    const hash = window.location.hash || "";
    const queryIndex = hash.indexOf("?");
    if (queryIndex === -1) return null;

    const queryString = hash.slice(queryIndex + 1);
    return new URLSearchParams(queryString).get(key);
  }

  async function loadProfile() {
    loading = true;
    error = "";
    coach = null;
    seasons = [];
    seasonDetails = {};
    openSeasonId = null;

    coachName = getQueryParam("name") ?? "";
    if (!coachName.trim()) {
      error = "Missing ?name= in the URL. Example: #/coach?name=Calvin%20Nisson";
      loading = false;
      return;
    }

    try {
      const data = await getCoachProfileByName(coachName);
      coach = data.coach;
      seasons = data.seasons ?? [];
      if (seasons.length === 0) error = "Coach found, but no seasons were found.";
    } catch (e) {
      error = e?.message ?? "Failed to load coach profile.";
    } finally {
      loading = false;
    }
  }

  async function toggleSeason(season_id, coach_id) {
    openSeasonId = openSeasonId === season_id ? null : season_id;

    if (openSeasonId && !seasonDetails[season_id]) {
      seasonDetails = { ...seasonDetails, [season_id]: { loading: true } };
      try {
        const details = await getCoachSeasonDetails(coach_id, season_id);
        seasonDetails = { ...seasonDetails, [season_id]: { loading: false, ...details } };
      } catch (e) {
        seasonDetails = {
          ...seasonDetails,
          [season_id]: { loading: false, error: e?.message ?? "Failed to load season details." }
        };
      }
    }
  }

  const placementLabel = (p) => {
    if (p == null) return "—";
    if (p === 1) return "🥇 Champion";
    if (p === 2) return "🥈 Runner-up";
    if (p === 3) return "🥉 3rd";
    return `${p}th`;
  };

  const diffClass = (d) => (d > 0 ? "pos" : d < 0 ? "neg" : "neu");

  const matchTag = (m) => {
    if (m.is_playoff) return m.playoff_round ? `Playoffs • ${m.playoff_round}` : "Playoffs";
    if (m.is_playins) return m.playins_round ? `Play-ins • ${m.playins_round}` : "Play-ins";
    return null;
  };

  onMount(loadProfile);
</script>

{#if loading}
  <div class="card skeleton">
    <div class="line w40"></div>
    <div class="line w60"></div>
  </div>
{:else if error}
  <div class="card error">{error}</div>
{:else}
  <!-- HERO -->
  <section class="hero">
    <div class="hero-top">
      <div>
        <div class="hero-title">{coach.coach_name}</div>
        <div class="hero-sub muted">Coach Profile</div>
      </div>

      <a class="back" href="#/coaches">← Coaches</a>
    </div>

    <div class="hero-chips">
      <div class="chip">
        <div class="chip-k">Seasons</div>
        <div class="chip-v">{seasons.length}</div>
      </div>

      <!-- These are just derived from seasons list -->
      <div class="chip">
        <div class="chip-k">Best Placement</div>
        <div class="chip-v">
          {#if seasons.length === 0}
            —
          {:else}
            {placementLabel(Math.min(...seasons.map(s => s.final_placement ?? 9999)))}
          {/if}
        </div>
      </div>

      <div class="chip">
        <div class="chip-k">Avg Rank</div>
        <div class="chip-v">
          {#if seasons.length === 0}
            —
          {:else}
            {(
              seasons.reduce((acc, s) => acc + (s.regular_season_rank ?? 0), 0) / seasons.length
            ).toFixed(1)}
          {/if}
        </div>
      </div>
    </div>
  </section>

  <!-- SEASONS -->
  <div class="season-list">
    {#each seasons as s (s.season_id)}
      <article class="season-card {openSeasonId === s.season_id ? 'open' : ''}">
        <button class="season-head" on:click={() => toggleSeason(s.season_id, coach.id)}>
          <div class="left">
            <div class="season-name">{s.season_name}</div>
            <div class="season-meta muted">
              <span class="team">{s.team_name}</span>
              <span class="dot">•</span>
              <span class="record">{s.season_wins ?? 0}-{s.season_losses ?? 0}</span>
            </div>
          </div>

          <div class="right">
            <div class="pill">
              <span class="pill-k">Rank</span>
              <span class="pill-v">#{s.regular_season_rank ?? "—"}</span>
            </div>
            <div class="pill">
              <span class="pill-k">Place</span>
              <span class="pill-v">{placementLabel(s.final_placement)}</span>
            </div>
            <div class="chev">{openSeasonId === s.season_id ? "▲" : "▼"}</div>
          </div>
        </button>

        {#if openSeasonId === s.season_id}
          <div class="season-body">
            {#if seasonDetails[s.season_id]?.loading}
              <div class="panel">
                <div class="panel-title">Loading…</div>
                <div class="muted">Fetching roster, schedule, and transactions.</div>
              </div>
            {:else if seasonDetails[s.season_id]?.error}
              <div class="panel error">{seasonDetails[s.season_id].error}</div>
            {:else}
              <!-- SUMMARY STRIP -->
              <div class="summary-strip">
                <div class="stat">
                  <div class="k">Record</div>
                  <div class="v">
                    {seasonDetails[s.season_id].season_wins ?? 0}-{seasonDetails[s.season_id].season_losses ?? 0}
                  </div>
                </div>

                <div class="stat">
                  <div class="k">Differential</div>
                  <div class="v {diffClass(seasonDetails[s.season_id].differential ?? 0)}">
                    {seasonDetails[s.season_id].differential ?? 0}
                  </div>
                </div>

                <div class="stat">
                  <div class="k">Reg Season Rank</div>
                  <div class="v">#{seasonDetails[s.season_id].regular_season_rank ?? "—"}</div>
                </div>

                <div class="stat">
                  <div class="k">Final</div>
                  <div class="v">{placementLabel(seasonDetails[s.season_id].final_placement)}</div>
                </div>
              </div>

              <!-- PANELS -->
              <div class="panels">
                <!-- ROSTER -->
                <section class="panel">
                  <div class="panel-title">Roster</div>
                  <div class="panel-sub muted">Season totals for this team.</div>

                  <table class="pretty-table">
                    <thead>
                      <tr>
                        <th>Pokémon</th>
                        <th class="num">K</th>
                        <th class="num">D</th>
                        <th class="num">Diff</th>
                        <th class="num">GP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each (seasonDetails[s.season_id].roster ?? []) as r}
                        <tr>
                          <td class="name">{r.pokemon_name}</td>
                          <td class="num">{r.kills}</td>
                          <td class="num">{r.deaths}</td>
                          <td class="num {diffClass(r.differential)}">{r.differential}</td>
                          <td class="num">{r.games_played}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </section>

                <!-- SCHEDULE -->
                <section class="panel">
                  <div class="panel-title">Schedule</div>
                  <div class="panel-sub muted">Includes postseason markers.</div>

                  <div class="schedule">
                    {#each (seasonDetails[s.season_id].schedule ?? []) as m (m.match_id)}
                      <div class="match-row">
                        <div class="wk">
                          <div class="wk-top">Week</div>
                          <div class="wk-val">{m.week ?? "—"}</div>
                        </div>

                        <div class="mid">
                          <div class="opp">
                            <span class="muted">vs</span> <span class="opp-name">{m.opponent_team_name}</span>
                          </div>
                          {#if matchTag(m)}
                            <div class="tag">{matchTag(m)}</div>
                          {/if}
                        </div>

                        <div class="righty">
                          <div class="score">{m.my_score}-{m.opp_score}</div>
                          <div class="result {m.result === 'W' ? 'win' : m.result === 'L' ? 'loss' : m.result === 'T' ? 'tie' : 'none'}">
                            {m.result}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                </section>

                <!-- TRANSACTIONS -->
                <section class="panel">
                  <div class="panel-title">Transactions</div>
                  <div class="panel-sub muted">Moves affecting this team this season.</div>

                  {#if (seasonDetails[s.season_id].transactions ?? []).length === 0}
                    <div class="muted">No transactions recorded.</div>
                  {:else}
                    <div class="tx-list">
                      {#each (seasonDetails[s.season_id].transactions ?? []) as tr (tr.id)}
                        <div class="tx">
                          <div class="tx-left">
                            <div class="tx-week">W{tr.week ?? "—"}</div>
                            <div class="tx-type">{tr.transaction_type}</div>
                          </div>

                          <div class="tx-mid">
                            <div class="tx-poke">{tr.pokemon_name}</div>
                            <div class="tx-flow muted">
                              <span class="from">{tr.team_from_name ?? "Free Agency"}</span>
                              <span class="arrow">→</span>
                              <span class="to">{tr.team_to_name}</span>
                            </div>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </section>
              </div>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>
{/if}

<style>
  /* ---- layout ---- */
  .hero{
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.05);
    border-radius: 18px;
    padding: 16px;
    margin-bottom: 14px;
  }
  .hero-top{
    display:flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .hero-title{
    font-size: 1.4rem;
    font-weight: 800;
    letter-spacing: .2px;
  }
  .hero-sub{ margin-top: 2px; }

  .back{
    text-decoration:none;
    padding: .4rem .65rem;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.10);
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.85);
    font-weight: 700;
  }

  .hero-chips{
    margin-top: 12px;
    display:grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
  }
  .chip{
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(0,0,0,.18);
    border-radius: 14px;
    padding: 10px 12px;
  }
  .chip-k{ font-size:.75rem; opacity:.75; }
  .chip-v{ font-size: 1.05rem; font-weight: 800; margin-top: 2px; }

  .season-list{ display:flex; flex-direction: column; gap: 10px; }

  .season-card{
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,.08);
    overflow:hidden;
    background: rgba(255,255,255,.04);
  }
  .season-card.open{
    border-color: rgba(255,107,107,.35);
    box-shadow: 0 0 0 1px rgba(255,107,107,.10) inset;
  }

  .season-head{
    width:100%;
    display:flex;
    justify-content: space-between;
    align-items:center;
    gap: 10px;
    padding: 14px 14px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align:left;
  }

  .season-name{ font-weight: 800; font-size: 1.05rem; }
  .season-meta{ margin-top: 2px; display:flex; align-items:center; gap: 8px; }
  .dot{ opacity: .5; }
  .team{ font-weight: 700; opacity: .9; }

  .right{
    display:flex;
    align-items:center;
    gap: 8px;
  }
  .pill{
    display:flex;
    gap: 8px;
    align-items:center;
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(0,0,0,.20);
    border-radius: 999px;
    padding: 6px 10px;
    font-size: .85rem;
    white-space: nowrap;
  }
  .pill-k{ opacity:.7; font-weight: 700; }
  .pill-v{ font-weight: 900; }
  .chev{ opacity:.8; font-weight: 900; padding-left: 4px; }

  .season-body{
    padding: 0 14px 14px 14px;
  }

  .summary-strip{
    margin-top: 10px;
    display:grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    padding: 12px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(0,0,0,.18);
  }
  .stat .k{ font-size:.75rem; opacity:.75; }
  .stat .v{ font-size: 1.05rem; font-weight: 900; margin-top: 2px; }

  .panels{
    margin-top: 12px;
    display:grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 980px){
    .panels{ grid-template-columns: 1.05fr .95fr; }
    .panels > :nth-child(3){ grid-column: 1 / -1; }
  }

  .panel{
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.03);
    padding: 12px;
  }
  .panel-title{
    font-weight: 900;
    font-size: 1rem;
  }
  .panel-sub{ margin-top: 2px; margin-bottom: 10px; }

  /* ---- tables ---- */
  .pretty-table{
    width: 100%;
    border-collapse: collapse;
    overflow:hidden;
    border-radius: 14px;
  }
  .pretty-table thead th{
    font-size: .8rem;
    text-transform: uppercase;
    letter-spacing: .06em;
    opacity: .75;
    padding: 10px 10px;
    border-bottom: 1px solid rgba(255,255,255,.10);
  }
  .pretty-table tbody td{
    padding: 10px 10px;
    border-bottom: 1px solid rgba(255,255,255,.06);
  }
  .pretty-table tbody tr:nth-child(2n){
    background: rgba(255,255,255,.03);
  }
  .pretty-table .name{ font-weight: 750; }
  .num{ text-align:right; }

  /* ---- schedule ---- */
  .schedule{ display:flex; flex-direction: column; gap: 8px; }
  .match-row{
    display:grid;
    grid-template-columns: 80px 1fr 110px;
    gap: 10px;
    align-items:center;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,.07);
    background: rgba(0,0,0,.14);
    padding: 10px;
  }
  .wk-top{ font-size:.75rem; opacity:.7; }
  .wk-val{ font-weight: 900; font-size: 1rem; }
  .opp-name{ font-weight: 800; }
  .tag{
    display:inline-block;
    margin-top: 6px;
    font-size: .78rem;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid rgba(255,107,107,.25);
    background: rgba(255,107,107,.14);
  }
  .righty{ display:flex; flex-direction: column; align-items:flex-end; gap: 6px; }
  .score{ font-weight: 900; }
  .result{
    width: 34px;
    height: 26px;
    border-radius: 10px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-weight: 900;
    border: 1px solid rgba(255,255,255,.10);
    background: rgba(255,255,255,.06);
  }
  .result.win{
    border-color: rgba(46, 204, 113, .35);
    background: rgba(46, 204, 113, .12);
  }
  .result.loss{
    border-color: rgba(231, 76, 60, .35);
    background: rgba(231, 76, 60, .12);
  }
  .result.tie{
    border-color: rgba(241, 196, 15, .35);
    background: rgba(241, 196, 15, .12);
  }

  /* ---- transactions ---- */
  .tx-list{ display:flex; flex-direction: column; gap: 8px; }
  .tx{
    display:grid;
    grid-template-columns: 110px 1fr;
    gap: 10px;
    align-items:center;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,.07);
    background: rgba(0,0,0,.14);
    padding: 10px;
  }
  .tx-week{
    font-weight: 900;
    font-size: 1rem;
  }
  .tx-type{
    margin-top: 2px;
    font-size: .8rem;
    opacity: .75;
  }
  .tx-poke{ font-weight: 900; }
  .tx-flow{ margin-top: 2px; display:flex; gap: 8px; align-items:center; flex-wrap: wrap; }
  .arrow{ opacity: .65; }

  /* diff coloring */
  .pos{ color: rgba(46, 204, 113, .95); }
  .neg{ color: rgba(231, 76, 60, .95); }
  .neu{ color: rgba(255,255,255,.85); }

  .error{
    color: #ffb3b3;
    border-color: rgba(231, 76, 60, .35);
    background: rgba(231, 76, 60, .10);
  }

  .accordion {
  color: rgba(255, 255, 255, 0.9);
}

.accordion .title {
  font-weight: 700;
  font-size: 1.05rem;
  color: #ffffff;
}

.accordion .muted {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.7);
}


  /* tiny skeleton */
  .skeleton .line{
    height: 12px;
    border-radius: 999px;
    background: rgba(255,255,255,.08);
    margin: 8px 0;
  }
  .w40{ width: 40%; }
  .w60{ width: 60%; }

  /* Ensure header text is light (season name / meta / pills) */
.season-head {
  color: rgba(255, 255, 255, 0.92);
}

.season-name {
  color: #ffffff;
}

/* The line that currently appears black for you */
.season-meta {
  color: rgba(255, 255, 255, 0.80);
}

/* Make Rank / Place label + value readable */
.pill-k {
  color: rgba(255, 255, 255, 0.70);
}

.pill-v {
  color: #ffffff;
}

/* If your global .muted is dark, override it locally on this page */
.muted {
  color: rgba(255, 255, 255, 0.70);
}

</style>
