<script>
  import { onMount, onDestroy, tick } from "svelte";
  import {
    getSeasonTierList,
    listLeagueTierListTemplates,
    initSeasonTierList,
    patchSeasonTierAssignments,
    createSeasonTier,
    putTierColumns,
    patchTier,
    deleteTier
  } from "../lib/api.js";

  export let seasonId;
  export let leagueId = null;
  export let canEdit = false;

  // ---------- Tier color themes ----------
  const RAINBOW = [
    { key: "red",    label: "Red" },
    { key: "orange", label: "Orange" },
    { key: "yellow", label: "Yellow" },
    { key: "green",  label: "Green" },
    { key: "blue",   label: "Blue" },
    { key: "purple", label: "Purple" }
  ];

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function tierThemeClass(tier, index, list) {
    if (tier?.is_banned) return "tier-theme-banned";

    const all = (list ?? []).filter((t) => !t?.is_banned);

    const val = (t) => {
      const w = t?.weight ?? t?.tier_weight ?? t?.tierWeight;
      if (w !== undefined && w !== null && w !== "") {
        const n = Number(w);
        if (Number.isFinite(n)) return n;
      }
      const so = t?.sort_order ?? t?.sortOrder ?? 0;
      return Number(so) || 0;
    };

    if (!all.length) return "tier-theme-red";

    const sorted = all.slice().sort((a, b) => val(a) - val(b));

    const i = sorted.findIndex((t) => Number(t?.id) === Number(tier?.id));
    const idxInSorted = i >= 0 ? i : 0;

    const n = Math.max(1, sorted.length - 1);
    const t01 = n === 0 ? 0 : (idxInSorted / n);

    const colorIdx = clamp(Math.round(t01 * (RAINBOW.length - 1)), 0, RAINBOW.length - 1);
    return `tier-theme-${RAINBOW[colorIdx].key}`;
  }

  let editMode = false;
  $: editable = !!canEdit && !!editMode;

  let loading = false;
  let error = "";

  // When a new season has no tier list yet, the backend returns 404.
  // We show an init UI for league masters to create/clone one.
  let missingTierList = false;
  let templatesLoading = false;
  let templates = [];
  let initMode = "new"; // "new" | "existing"
  let selectedSourceSeasonId = "";
  let initBusy = false;
  let initError = "";

  function httpStatusFromError(e) {
    const msg = e?.message ?? "";
    const m = /^HTTP\s+(\d{3})\s*:/i.exec(msg);
    return m ? Number(m[1]) : null;
  }

  let board = null;
  let tiers = [];
  let columns = [];
  let assignments = [];
  let tierList = null;

  // NEW: team lookup map for tile colors (when assignments don't include the color)
  let teamMetaById = new Map(); // team_id -> { primary_color, abbrev, name }

  // IMPORTANT: hide undraftable tiers in view mode (defense-in-depth)
  $: visibleTiers = editMode ? (tiers ?? []) : (tiers ?? []).filter(t => !t?.is_undraftable);

  let search = "";
  let bucketFilterByKey = {};

  let pendingByPokemonId = {};
  let saving = false;
  let saveMsg = "";

  let newTierName = "";
  let newTierSortOrder = 50;
  let newTierIsBanned = false;
  let newTierIsUndraftable = false;
  let creatingTier = false;

  let bucketInputByTierId = {};
  let savingBucketsByTierId = {};
  let bulkOpenByBucketKey = {};
  let bulkTextByBucketKey = {};
  let bulkApplyingByBucketKey = {};

  // ----------------------------
  // Tier assignment notes
  // ----------------------------
  const NOTE_MAX = 255;
  let noteEditorForPokemonId = null;
  let noteDraft = "";

  // Tier settings editor
  let tierEditById = {};
  let tierSavingById = {};
  let tierDeletingById = {};

  function hasNotes(a) {
    const n = a?.notes;
    return n != null && String(n).trim().length > 0;
  }

  function openNoteEditor(a) {
    if (!editable) return;
    noteEditorForPokemonId = Number(a?.pokemon_id);
    noteDraft = String(a?.notes ?? "");
  }

  function closeNoteEditor() {
    noteEditorForPokemonId = null;
    noteDraft = "";
  }

  function httpStatus(e) {
    const m = String(e?.message ?? e).match(/HTTP\s+(\d+):/i);
    return m ? Number(m[1]) : null;
  }

  async function loadTemplates() {
    templatesError = "";
    templatesLoading = true;
    try {
      if (!leagueId) {
        templates = [];
        return;
      }
      const rows = await listLeagueTierListTemplates(leagueId);
      templates = Array.isArray(rows) ? rows : [];

      // Default selection = most recent
      if (!selectedSourceSeasonId && templates.length) {
        selectedSourceSeasonId = String(templates[0].season_id);
      }
    } catch (e) {
      templatesError = String(e?.message ?? e);
      templates = [];
    } finally {
      templatesLoading = false;
    }
  }

  async function initTierList() {
    if (!canEdit) return;
    if (!seasonId) return;

    error = "";
    initBusy = true;
    try {
      if (initMode === "existing") {
        const sid = Number(selectedSourceSeasonId);
        if (!Number.isFinite(sid)) throw new Error("Pick an existing season tier list first.");
        await initSeasonTierList(seasonId, { source_season_id: sid });
      } else {
        // "Create new" = clone the most recent season tier list automatically.
        await initSeasonTierList(seasonId);
      }

      // Reload board
      missingTierList = false;
      await refresh();
    } catch (e) {
      error = String(e?.message ?? e);
    } finally {
      initBusy = false;
    }
  }

  function ensureTierEdit(t) {
    const id = Number(t?.id);
    if (!id) return null;
    if (!tierEditById[id]) {
      tierEditById = {
        ...tierEditById,
        [id]: {
          name: t?.name ?? "",
          sort_order: Number(t?.sort_order ?? 0),
          is_banned: !!t?.is_banned,
          is_undraftable: !!t?.is_undraftable
        }
      };
    }
    return tierEditById[id];
  }

  async function saveTierSettings(t) {
    if (!editable) return;
    const id = Number(t?.id);
    if (!id) return;

    const ed = ensureTierEdit(t);
    if (!ed) return;

    tierSavingById = { ...tierSavingById, [id]: true };
    error = "";

    try {
      const payload = {
        name: (ed.name ?? "").trim(),
        sort_order: Number(ed.sort_order),
        is_banned: !!ed.is_banned,
        is_undraftable: !!ed.is_undraftable
      };

      if (!payload.name) {
        throw new Error("Tier name cannot be empty.");
      }

      await patchTier(id, payload);
      await load(); // re-pull board (also re-applies include_hidden logic)
      saveMsg = "Tier saved.";
      setTimeout(() => (saveMsg = ""), 1200);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      tierSavingById = { ...tierSavingById, [id]: false };
    }
  }

  async function onDeleteTier(t) {
    if (!editable) return;
    const id = Number(t?.id);
    if (!id) return;
    if (t?.is_system) return;

    const ok = window.confirm(
      `Delete tier "${t?.name}"?\n\nAll Pokémon in this tier will be moved back to Untiered.`
    );
    if (!ok) return;

    tierDeletingById = { ...tierDeletingById, [id]: true };
    error = "";

    try {
      await deleteTier(id);
      await load();
      saveMsg = "Tier deleted.";
      setTimeout(() => (saveMsg = ""), 1200);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      tierDeletingById = { ...tierDeletingById, [id]: false };
    }
  }

  // Quick Move picker state
  let movePickerForPokemonId = null;
  let moveTierId = null;
  let movePoints = null;
  let movePointsStr = "null";

  let renderVersion = 0;
  function bumpRender() { renderVersion += 1; }

  function resetMessages() { error = ""; saveMsg = ""; }

  const norm = (s) => (s ?? "").toString().trim().toLowerCase();

  function tierKey(t) { return t?.id; }
  function colKey(c) { return c?.id ?? `${c?.tier_id}:${c?.points}:${c?.sort_order ?? 0}`; }
  function assignmentKey(a) { return a?.pokemon_id; }

  function normPoints(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function bucketKey(tierId, points) {
    const tid = Number(tierId);
    const p = normPoints(points);
    return `${tid}|${p === null ? "null" : String(p)}`;
  }

  function parseBucketKeyStr(k) {
    const [tidRaw, pRaw] = String(k).split("|");
    const tierId = Number(tidRaw);
    const points = pRaw === "null" ? null : Number(pRaw);
    return { tierId, points: Number.isFinite(points) ? points : null };
  }

  function isMegaName(name) {
    return (name ?? "").toString().toLowerCase().startsWith("mega ");
  }

  function isPending(pokemonId) {
    return !!pendingByPokemonId?.[Number(pokemonId)];
  }

  function sameBucket(a, tierId, points) {
    return (
      Number(a?.tier_id) === Number(tierId) &&
      normPoints(a?.points) === normPoints(points)
    );
  }

  function getAssignmentByPokemonId(pokemonId) {
    const pid = Number(pokemonId);
    return (assignments ?? []).find((a) => Number(a.pokemon_id) === pid) ?? null;
  }

  function parseBulkNames(raw) {
    return (raw ?? "")
      .split(/[\n,]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function buildPokemonNameIndex() {
    const idx = new Map();
    for (const a of (assignments ?? [])) {
      const k = norm(a?.pokemon_name);
      if (!k) continue;
      if (!idx.has(k)) idx.set(k, a);
    }
    return idx;
  }

  function openBulk(bKey) {
    bulkOpenByBucketKey = { ...bulkOpenByBucketKey, [bKey]: true };
    if (bulkTextByBucketKey[bKey] == null) {
      bulkTextByBucketKey = { ...bulkTextByBucketKey, [bKey]: "" };
    }
  }

  function closeBulk(bKey) {
    bulkOpenByBucketKey = { ...bulkOpenByBucketKey, [bKey]: false };
  }

  function setBulkText(bKey, v) {
    bulkTextByBucketKey = { ...bulkTextByBucketKey, [bKey]: String(v ?? "") };
  }

  // ---- team abbrev helpers (view-mode badge) ----
  function teamAbbrevFromName(name) {
    const s = (name ?? "").toString().trim();
    if (!s) return "?";
    const parts = s.split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => (p[0] ?? "").toUpperCase()).join("");
    return letters || (s[0] ?? "?").toUpperCase();
  }

  function teamBadgeText(a) {
    const direct = (a?.owned_by_team_abbrev ?? "").toString().trim();
    if (direct) return direct.toUpperCase();

    const nm = (a?.owned_by_team_name ?? "").toString().trim();
    if (nm) return teamAbbrevFromName(nm);

    return "T";
  }

  // ---- UPDATED: drafted tile background color helpers (robust) ----
  function normalizeColor(c) {
    if (c == null) return null;
    let s = String(c).trim();
    if (!s) return null;

    const lower = s.toLowerCase();

    // Allow CSS functional colors as-is
    if (
      lower.startsWith("rgb(") || lower.startsWith("rgba(") ||
      lower.startsWith("hsl(") || lower.startsWith("hsla(")
    ) {
      return s;
    }

    // Strip "0x" prefix if present
    if (lower.startsWith("0x")) s = s.slice(2);

    // Already a hex with #
    if (s.startsWith("#")) return s;

    // Raw hex (RGB/RRGGBB/RRGGBBAA)
    const hex = s.replace(/[^0-9a-fA-F]/g, "");
    if (hex.length === s.length && (hex.length === 3 || hex.length === 6 || hex.length === 8)) {
      return `#${hex}`;
    }

    return null;
  }

  function teamPrimaryColor(a) {
    // First: try assignment row fields
    const rawFromAssignment =
      a?.owned_by_team_primary_color ??
      a?.ownedByTeamPrimaryColor ??
      a?.owned_by_team_color_primary ??
      a?.ownedByTeamColorPrimary ??
      a?.team_primary_color ??
      a?.teamPrimaryColor ??
      a?.primary_color ??
      a?.primaryColor ??
      null;

    const direct = normalizeColor(rawFromAssignment);
    if (direct) return direct;

    // Fallback: look up by team_id from board response
    const tid = Number(a?.owned_by_team_id);
    if (!tid) return null;

    const meta = teamMetaById.get(tid);
    const rawFromTeam =
      meta?.primary_color ??
      meta?.primaryColor ??
      meta?.color_primary ??
      meta?.colorPrimary ??
      null;

    return normalizeColor(rawFromTeam);
  }

  function tileStyleForAssignment(a) {
    // Only in view mode, only if drafted, only if we have a color.
    if (editable) return "";
    if (a?.owned_by_team_id == null) return "";

    const color = teamPrimaryColor(a);
    if (!color) return "";

    // ✅ Softened team color (keeps hue, reduces aggressiveness)
    // - mixes toward a dark neutral
    // - adds a subtle overlay gradient for "less neon" look
    return `
      background:
        linear-gradient(
          180deg,
          rgba(255,255,255,0.08),
          rgba(0,0,0,0.18)
        ),
        color-mix(in srgb, ${color} 65%, rgba(0,0,0,0.25));
      background-image: none;
      border-color: rgba(0,0,0,0.18);
    `;
  }

  function getAssignmentsForBucket(tierId, points, globalQuery, bucketQuery) {
    const tid = Number(tierId);
    const bp = normPoints(points);

    const gq = norm(globalQuery);
    const bq = norm(bucketQuery);

    return (assignments ?? [])
      .filter((a) => Number(a.tier_id) === tid)
      .filter((a) => normPoints(a.points) === bp)
      .filter((a) => (!gq ? true : norm(a?.pokemon_name).includes(gq)))
      .filter((a) => (!bq ? true : norm(a?.pokemon_name).includes(bq)))
      .slice()
      .sort((a, b) => {
        const am = isMegaName(a?.pokemon_name) ? 1 : 0;
        const bm = isMegaName(b?.pokemon_name) ? 1 : 0;
        if (am !== bm) return bm - am;
        return norm(a?.pokemon_name).localeCompare(norm(b?.pokemon_name));
      });
  }

  function setBucketFilter(bKey, value) {
    bucketFilterByKey = { ...bucketFilterByKey, [bKey]: String(value ?? "") };
    scheduleMeasure();
  }

  function clearPending() {
    pendingByPokemonId = {};
    saveMsg = "";
    saving = false;
  }

  function closeMovePicker() {
    movePickerForPokemonId = null;
    moveTierId = null;
    movePoints = null;
    movePointsStr = "null";
  }

  function exitEditMode() {
    editMode = false;
    clearPending();
    closeMovePicker();
    bucketFilterByKey = {};

    drag = {
      active: false,
      pokemonId: null,
      pokemonName: "",
      overBucketKey: null,
      x: 0,
      y: 0,
      offsetX: 14,
      offsetY: 14
    };
  }

  async function toggleEditMode() {
    if (!canEdit) return;

    if (editMode) exitEditMode();
    else editMode = true;

    await load(); // IMPORTANT: reload with include_hidden based on editable
    await tick();
    bumpRender();
    scheduleMeasure();
  }

  async function load() {
    if (!seasonId) return;

    resetMessages();
    loading = true;
    board = null;
    missingTierList = false;
    initError = "";

    try {
      const res = await getSeasonTierList(seasonId, { include_hidden: editMode });

      board = res;
      tierList = res?.tier_list ?? res?.tierList ?? null;

      tiers = (res?.tiers ?? []).slice();
      columns = (res?.columns ?? []).slice();

      // NEW: build team lookup map (supports multiple possible response keys)
      const teamsArr =
        res?.teams ??
        res?.draft_teams ??
        res?.league_teams ??
        res?.leagueTeams ??
        [];

      teamMetaById = new Map(
        (teamsArr ?? [])
          .map((t) => {
            const id = Number(t?.id ?? t?.team_id ?? t?.teamId);
            return [
              id,
              {
                primary_color: t?.primary_color ?? t?.primaryColor ?? null,
                abbrev: t?.abbrev ?? t?.abbreviation ?? null,
                name: t?.name ?? null
              }
            ];
          })
          .filter(([id]) => Number.isFinite(id) && id > 0)
      );

      assignments = (res?.assignments ?? []).map((a) => ({
        ...a,
        pokemon_id: Number(a.pokemon_id),
        tier_id: Number(a.tier_id ?? a.tierId),
        points: normPoints(a.points),
        notes: a.notes ?? null,
        dex_number: a.dex_number ?? a.dexNumber ?? null,
        owned_by_team_id: a.owned_by_team_id ?? a.ownedByTeamId ?? null,
        owned_by_team_name: a.owned_by_team_name ?? a.ownedByTeamName ?? null,
        owned_by_team_abbrev: a.owned_by_team_abbrev ?? a.ownedByTeamAbbrev ?? null,

        // still carry primary color through if backend provides it on assignment row
        owned_by_team_primary_color:
          a.owned_by_team_primary_color ??
          a.ownedByTeamPrimaryColor ??
          a.owned_by_team_color_primary ??
          a.ownedByTeamColorPrimary ??
          a.team_primary_color ??
          a.teamPrimaryColor ??
          a.primary_color ??
          a.primaryColor ??
          null
      }));

      // DEBUG (kept): prove whether team colors exist and normalize correctly
      const sample = (assignments ?? []).find((x) => x?.owned_by_team_id != null);
      console.log("[TierList] teams loaded:", (teamsArr ?? []).length);
      console.log("[TierList] sample owned assignment:", sample ? {
        pokemon: sample.pokemon_name,
        teamId: sample.owned_by_team_id,
        team: sample.owned_by_team_name,
        rawColorAssignment: sample.owned_by_team_primary_color,
        rawColorTeamMap: teamMetaById.get(Number(sample.owned_by_team_id))?.primary_color,
        normalized: teamPrimaryColor(sample),
      } : "NONE");

      bumpRender();
      scheduleMeasure();
    } catch (e) {
      const status = httpStatusFromError(e);

      // New season with no tier list yet.
      if (status === 404) {
        missingTierList = true;
        error = "";

        // Preload templates for the dropdown if we can.
        if (canEdit && leagueId) {
          templatesLoading = true;
          try {
            templates = await listLeagueTierListTemplates(leagueId);
          } catch (e2) {
            // Non-fatal; user can still create-from-latest.
            initError = e2?.message ?? String(e2);
            templates = [];
          } finally {
            templatesLoading = false;
          }
        }
      } else {
        error = e?.message ?? String(e);
      }

      board = null;
      tierList = null;
      tiers = [];
      columns = [];
      assignments = [];
      teamMetaById = new Map();
      bumpRender();
      scheduleMeasure();
    } finally {
      loading = false;
    }
  }

  async function onInitTierList() {
    if (!canEdit || !seasonId) return;
    initError = "";
    initBusy = true;
    try {
      const src =
        initMode === "existing" && selectedSourceSeasonId
          ? Number(selectedSourceSeasonId)
          : null;

      await initSeasonTierList(seasonId, {
        ...(src != null ? { source_season_id: src } : {}),
      });

      // After init, load the board normally.
      await load();
    } catch (e) {
      initError = e?.message ?? String(e);
    } finally {
      initBusy = false;
    }
  }

  async function applyBulkToBucket(bKey, tierId, points) {
    if (!editable) return;

    const raw = bulkTextByBucketKey?.[bKey] ?? "";
    const names = parseBulkNames(raw);

    if (!names.length) return;

    bulkApplyingByBucketKey = { ...bulkApplyingByBucketKey, [bKey]: true };

    try {
      const idx = buildPokemonNameIndex();

      const missing = [];
      const foundAssignments = [];

      for (const name of names) {
        const hit = idx.get(norm(name));
        if (!hit) missing.push(name);
        else foundAssignments.push(hit);
      }

      if (missing.length) {
        const msg =
          `Bulk entry aborted — couldn't find ${missing.length} Pokémon:\n\n` +
          missing.join("\n");
        error = msg;
        window.alert(msg);
        return;
      }

      const targetTid = Number(tierId);
      const targetPts = normPoints(points);
      const idSet = new Set(foundAssignments.map((a) => Number(a.pokemon_id)));

      const nextPending = { ...pendingByPokemonId };
      const nextAssignments = (assignments ?? []).map((a) => {
        const pid = Number(a.pokemon_id);
        if (!idSet.has(pid)) return a;

        if (sameBucket(a, targetTid, targetPts)) {
          if (nextPending[pid]) delete nextPending[pid];
          return a;
        }

        nextPending[pid] = { pokemon_id: pid, tier_id: targetTid, points: targetPts };
        return { ...a, tier_id: targetTid, points: targetPts };
      });

      pendingByPokemonId = nextPending;
      assignments = nextAssignments;

      await tick();
      bumpRender();
      scheduleMeasure();

      closeBulk(bKey);
    } finally {
      bulkApplyingByBucketKey = { ...bulkApplyingByBucketKey, [bKey]: false };
    }
  }

  onMount(load);

  let lastSeasonId = null;
  $: if (seasonId && seasonId !== lastSeasonId) {
    lastSeasonId = seasonId;
    load();
  }

  $: if (!canEdit && editMode) exitEditMode();

  function getTierColumns(tierId) {
    const tid = Number(tierId);

    const cols = (columns ?? [])
      .filter((c) => Number(c?.tier_id ?? c?.tierId) === tid)
      .slice()
      .sort((a, b) => {
        const ao = a?.sort_order ?? 0;
        const bo = b?.sort_order ?? 0;
        if (ao !== bo) return ao - bo;

        const ap = normPoints(a?.points);
        const bp = normPoints(b?.points);
        return (bp ?? -999999) - (ap ?? -999999);
      });

    if (!cols.length) {
      return [
        { id: `virtual:${tierId}`, tier_id: tid, points: null, sort_order: 0, _virtual: true }
      ];
    }

    return cols;
  }

  function bucketOptionsForTier(tierId) {
    const cols = getTierColumns(tierId) ?? [];
    return cols.map((c) => {
      const p = normPoints(c.points);
      return { points: p, label: p == null ? "Bucket" : `${p} pts` };
    });
  }

  function openMovePicker(a) {
    if (!editable) return;
    movePickerForPokemonId = Number(a.pokemon_id);
    moveTierId = Number(a.tier_id);
    movePoints = normPoints(a.points);

    const opts = bucketOptionsForTier(moveTierId);
    const ok = opts.some((o) => normPoints(o.points) === normPoints(movePoints));
    if (!ok) movePoints = opts?.[0]?.points ?? null;

    movePointsStr = (movePoints == null) ? "null" : String(movePoints);
  }

  async function queueChange(pokemonId, tierId, points) {
    if (!editable) return;

    const pid = Number(pokemonId);
    const tid = Number(tierId);
    const pts = normPoints(points);

    const current = getAssignmentByPokemonId(pid);
    if (current && sameBucket(current, tid, pts)) {
      if (pendingByPokemonId?.[pid]) {
        const next = { ...pendingByPokemonId };
        delete next[pid];
        pendingByPokemonId = next;
      }
      return;
    }

    pendingByPokemonId = {
      ...pendingByPokemonId,
      [pid]: { pokemon_id: pid, tier_id: tid, points: pts, notes: current?.notes ?? null }
    };

    let found = false;
    const nextAssignments = (assignments ?? []).map((a) => {
      if (Number(a.pokemon_id) !== pid) return a;
      found = true;
      return { ...a, tier_id: tid, points: pts };
    });

    if (!found) {
      nextAssignments.push({
        pokemon_id: pid,
        tier_id: tid,
        points: pts,
        pokemon_name: "(unknown)",
        dex_number: null
      });
    }

    assignments = nextAssignments;

    await tick();
    bumpRender();
    scheduleMeasure();
  }

  async function saveNotesForPokemon(pokemonId) {
    if (!editable) return;

    const pid = Number(pokemonId);
    const current = getAssignmentByPokemonId(pid);
    if (!current) return;

    const trimmed = String(noteDraft ?? "").trim();
    const nextNotes = trimmed ? trimmed.slice(0, NOTE_MAX) : null;

    // Update local assignments immediately
    assignments = (assignments ?? []).map((a) =>
      Number(a.pokemon_id) === pid ? { ...a, notes: nextNotes } : a
    );

    // Mark pending (include current tier/points + notes)
    pendingByPokemonId = {
      ...pendingByPokemonId,
      [pid]: {
        pokemon_id: pid,
        tier_id: Number(current.tier_id),
        points: normPoints(current.points),
        notes: nextNotes,
      },
    };

    closeNoteEditor();
    await tick();
    bumpRender();
    scheduleMeasure();
  }

  async function applyMove() {
    if (!editable) return;
    if (movePickerForPokemonId == null) return;

    const pts = (movePointsStr === "null") ? null : normPoints(movePointsStr);
    await queueChange(movePickerForPokemonId, moveTierId, pts);

    closeMovePicker();
  }

  async function saveChanges() {
    if (!editable) return;

    const changes = Object.values(pendingByPokemonId);
    if (!changes.length) return;

    saving = true;
    saveMsg = "";
    error = "";

    try {
      await patchSeasonTierAssignments(seasonId, changes);
      pendingByPokemonId = {};
      saveMsg = "Saved.";
      bumpRender();
      await load();
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      saving = false;
      setTimeout(() => (saveMsg = ""), 1200);
    }
  }

  async function onCreateTier() {
    if (!editable) return;

    const name = newTierName.trim();
    if (!name) return;

    creatingTier = true;
    error = "";

    try {
      const so = Number.isFinite(Number(newTierSortOrder)) ? Number(newTierSortOrder) : 50;

      await createSeasonTier(seasonId, {
        name,
        sort_order: so,
        is_banned: !!newTierIsBanned,
        is_undraftable: !!newTierIsUndraftable
      });

      newTierName = "";
      newTierSortOrder = 50;
      newTierIsBanned = false;
      newTierIsUndraftable = false;

      await load();
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      creatingTier = false;
    }
  }

  function parseBuckets(s) {
    const pts = (s ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));

    pts.sort((a, b) => b - a);
    return Array.from(new Set(pts));
  }

  async function onSaveBucketsForTier(tierId) {
    if (!editable) return;

    const raw = bucketInputByTierId?.[tierId] ?? "";
    const points = parseBuckets(raw);

    if (!points.length) {
      error = "Enter at least one point value (e.g. 20,19,18).";
      return;
    }

    savingBucketsByTierId = { ...savingBucketsByTierId, [tierId]: true };
    error = "";

    try {
      await putTierColumns(tierId, points);
      await load();
      saveMsg = "Buckets saved.";
      setTimeout(() => (saveMsg = ""), 1200);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      savingBucketsByTierId = { ...savingBucketsByTierId, [tierId]: false };
    }
  }

  // ================================
  // Pointer Drag with hit-test
  // ================================
  const bucketEls = new Map();

  function bucketEl(node, bKey) {
    if (bKey) bucketEls.set(bKey, node);

    return {
      update(nextKey) {
        if (bKey) bucketEls.delete(bKey);
        bKey = nextKey;
        if (bKey) bucketEls.set(bKey, node);
        scheduleMeasure();
      },
      destroy() {
        if (bKey) bucketEls.delete(bKey);
      }
    };
  }

  let drag = {
    active: false,
    pokemonId: null,
    pokemonName: "",
    overBucketKey: null,
    x: 0,
    y: 0,
    offsetX: 14,
    offsetY: 14
  };

  function findBucketUnderPointer(clientX, clientY) {
    for (const [k, el] of bucketEls.entries()) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return k;
      }
    }
    return null;
  }

  function onCardPointerDown(e, pokemonId, pokemonName) {
    if (!editable) return;
    if (e.button != null && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}

    drag = {
      active: true,
      pokemonId: Number(pokemonId),
      pokemonName: pokemonName ?? "",
      overBucketKey: null,
      x: e.clientX,
      y: e.clientY,
      offsetX: 14,
      offsetY: 14
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });

    drag = { ...drag, overBucketKey: findBucketUnderPointer(e.clientX, e.clientY) };
  }

  function onPointerMove(e) {
    if (!drag.active) return;
    e.preventDefault();

    drag = {
      ...drag,
      x: e.clientX,
      y: e.clientY,
      overBucketKey: findBucketUnderPointer(e.clientX, e.clientY)
    };
  }

  async function onPointerUp(e) {
    if (!drag.active) return;
    e.preventDefault();

    const pid = drag.pokemonId;
    const over = drag.overBucketKey;

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);

    if (pid && over) {
      const { tierId, points } = parseBucketKeyStr(over);
      await queueChange(pid, tierId, points);
    }

    drag = {
      active: false,
      pokemonId: null,
      pokemonName: "",
      overBucketKey: null,
      x: 0,
      y: 0,
      offsetX: 14,
      offsetY: 14
    };
  }

  onDestroy(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  });

  function stopDragPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function allowControlPointerDown(e) {
    e.stopPropagation();
  }

  // ================================
  // TRUE synced scrollbars
  // ================================
  let topScrollEl = null;
  let bottomScrollEl = null;
  let topSpacerW = 0;
  let syncingScroll = false;

  let rafMeasure = 0;
  let measureScheduled = false;

  function measureScroll() {
    if (!bottomScrollEl) return;

    const sw = bottomScrollEl.scrollWidth || 0;
    topSpacerW = sw;

    if (topScrollEl && !syncingScroll) {
      topScrollEl.scrollLeft = bottomScrollEl.scrollLeft;
    }
  }

  function scheduleMeasure() {
    if (measureScheduled) return;
    measureScheduled = true;

    tick().then(() => {
      cancelAnimationFrame(rafMeasure);
      rafMeasure = requestAnimationFrame(() => {
        measureScheduled = false;
        measureScroll();
      });
    });
  }

  function syncFromTop() {
    if (!topScrollEl || !bottomScrollEl) return;
    if (syncingScroll) return;
    syncingScroll = true;
    bottomScrollEl.scrollLeft = topScrollEl.scrollLeft;
    syncingScroll = false;
  }

  function syncFromBottom() {
    if (!topScrollEl || !bottomScrollEl) return;
    if (syncingScroll) return;
    syncingScroll = true;
    topScrollEl.scrollLeft = bottomScrollEl.scrollLeft;
    syncingScroll = false;
  }

  let ro = null;
  onMount(() => {
    scheduleMeasure();

    const onResize = () => scheduleMeasure();
    window.addEventListener("resize", onResize);

    if (bottomScrollEl && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => scheduleMeasure());
      ro.observe(bottomScrollEl);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      if (ro) ro.disconnect();
      cancelAnimationFrame(rafMeasure);
    };
  });

  $: if (renderVersion) scheduleMeasure();
  $: if (search !== undefined) scheduleMeasure();
  $: if (editMode !== undefined) scheduleMeasure();
</script>

<div class="wrap">
  <div class="topbar">
    <input class="search" placeholder="Search Pokémon (global)…" bind:value={search} />

    <div class="right">
      {#if canEdit}
        <button class="btn" on:click={toggleEditMode}>
          {editMode ? "Exit Edit Mode" : "Edit Mode"}
        </button>
      {/if}

      {#if editable}
        {#if saving}
          <div class="muted">Saving…</div>
        {:else if saveMsg}
          <div class="ok">{saveMsg}</div>
        {/if}

        <button
          class="btn"
          on:click={saveChanges}
          disabled={saving || Object.keys(pendingByPokemonId).length === 0}
        >
          Save
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="card error">{error}</div>
  {/if}

  {#if editable}
    <div class="card">
      <div class="panel-title">Add Tier</div>
      <div class="row">
        <input class="input" placeholder="Tier name (e.g. Tier 1)" bind:value={newTierName} />
        <input class="input small" type="number" min="0" step="1" title="sort_order" bind:value={newTierSortOrder} />
        <label class="check">
          <input type="checkbox" bind:checked={newTierIsBanned} />
          <span>Banned tier</span>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={newTierIsUndraftable} />
          <span>Undraftable tier</span>
        </label>
        <button class="btn" on:click={onCreateTier} disabled={creatingTier || !newTierName.trim()}>
          {creatingTier ? "Creating…" : "Create"}
        </button>
      </div>
      <div class="muted" style="margin-top:.5rem;">
        Tip: lower sort_order shows earlier. (0 is valid.) Undraftable tiers are hidden in view mode.
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="card muted">Loading tier list…</div>
  {:else if missingTierList}
    <div class="card">
      <div class="panel-title">No tier list yet for this season</div>
      <div class="muted" style="margin-top:.35rem;">
        This is normal for a brand-new season. As a league master you can either create a new tier list
        (by cloning the most recent season tier list in this league) or clone a specific existing season tier list.
      </div>

      <div class="row" style="margin-top:.75rem; align-items:center;">
        <label class="check">
          <input type="radio" name="tierInitMode" value="new" bind:group={initMode} />
          <span>Create new</span>
        </label>

        <label class="check">
          <input type="radio" name="tierInitMode" value="existing" bind:group={initMode} />
          <span>Use existing</span>
        </label>

        {#if initMode === "existing"}
          <select
            class="select"
            bind:value={selectedSourceSeasonId}
            disabled={templatesLoading}
            style="min-width: 320px;"
          >
            <option value="">Select a season tier list…</option>

            <optgroup label="This League">
              {#each templates.filter(t => t.is_same_league) as t (t.season_id)}
                <option value={t.season_id}>
                  {t.season_name} - {t.season_format ?? "(no format)"}
                </option>
              {/each}
            </optgroup>

            <optgroup label="Other Active Leagues">
              {#each templates.filter(t => !t.is_same_league) as t (t.season_id)}
                <option value={t.season_id}>
                  {t.league_name} - {t.season_name} - {t.season_format ?? "(no format)"}
                </option>
              {/each}
            </optgroup>
          </select>
        {/if}

        <button class="btn coral" on:click={onInitTierList} disabled={initBusy || (initMode === "existing" && !selectedSourceSeasonId)}>
          {initBusy ? "Creating…" : "Create tier list"}
        </button>
      </div>

      {#if templatesLoading}
        <div class="muted" style="margin-top:.5rem;">Loading existing tier lists…</div>
      {/if}

      {#if initError}
        <div class="card error" style="margin-top:.75rem;">{initError}</div>
      {/if}
    </div>
  {:else if !board}
    <div class="card muted">No tier list board returned.</div>
  {:else if !(visibleTiers?.length)}
    <div class="card muted">
      No tiers returned for this season.
      <div class="muted" style="margin-top:.5rem;">Create tiers above or via POST /seasons/:season_id/tierlist/tiers.</div>
    </div>
  {:else}
    <div class="hscroll-wrap">
      <div class="hscroll hscroll-top" bind:this={topScrollEl} on:scroll={syncFromTop}>
        <div class="hscroll-spacer" style="width:{topSpacerW}px;"></div>
      </div>

      <div class="hscroll hscroll-bottom" bind:this={bottomScrollEl} on:scroll={syncFromBottom}>
        {#key renderVersion}
          <div
            class="grid"
            style="--col-width:{editable ? 220 : 180}px; --col-min:{editable ? 220 : 180}px;"
          >
            {#each visibleTiers as t, ti (tierKey(t))}
              <section class={"tier " + tierThemeClass(t, visibleTiers.indexOf(t), visibleTiers)}>
                <div class="tier-head">
                  <div class="tier-name">{t.name}</div>
                  <div class="tier-head-right">
                    {#if t.is_system}
                      <div class="badge">System</div>
                    {/if}
                    {#if t.is_undraftable}
                      <div class="badge">Undraftable</div>
                    {/if}
                    {#if t.is_banned}
                      <div class="badge banned">Banned</div>
                    {/if}
                  </div>
                </div>

                {#if editable}
                  {@const ed = ensureTierEdit(t)}
                  <div class="tier-settings" on:pointerdown={allowControlPointerDown}>
                    <div class="tier-settings-title">Tier Settings</div>
                    <div class="tier-settings-row">
                      <input
                        class="input tier-settings-input"
                        placeholder="Tier name"
                        value={ed?.name ?? ""}
                        on:input={(e) => {
                          const v = e.currentTarget.value;
                          tierEditById = { ...tierEditById, [t.id]: { ...ed, name: v } };
                        }}
                      />
                      <input
                        class="input small"
                        type="number"
                        step="1"
                        value={ed?.sort_order ?? 0}
                        on:input={(e) => {
                          const v = Number(e.currentTarget.value);
                          tierEditById = { ...tierEditById, [t.id]: { ...ed, sort_order: v } };
                        }}
                        title="sort_order"
                      />
                    </div>

                    <div class="tier-settings-row">
                      <label class="check">
                        <input
                          type="checkbox"
                          checked={!!ed?.is_banned}
                          on:change={(e) => {
                            const v = !!e.currentTarget.checked;
                            tierEditById = { ...tierEditById, [t.id]: { ...ed, is_banned: v } };
                          }}
                        />
                        <span>Banned</span>
                      </label>

                      <label class="check">
                        <input
                          type="checkbox"
                          checked={!!ed?.is_undraftable}
                          disabled={!!t.is_system}
                          on:change={(e) => {
                            const v = !!e.currentTarget.checked;
                            tierEditById = { ...tierEditById, [t.id]: { ...ed, is_undraftable: v } };
                          }}
                        />
                        <span>Undraftable</span>
                      </label>

                      <button
                        class="mini-btn primary"
                        type="button"
                        disabled={!!tierSavingById[t.id]}
                        on:pointerdown={stopDragPointerDown}
                        on:click={() => saveTierSettings(t)}
                      >
                        {tierSavingById[t.id] ? "Saving…" : "Save Tier"}
                      </button>

                      <button
                        class="mini-btn danger"
                        type="button"
                        disabled={!!t.is_system || !!tierDeletingById[t.id]}
                        on:pointerdown={stopDragPointerDown}
                        on:click={() => onDeleteTier(t)}
                      >
                        {tierDeletingById[t.id] ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                {/if}

                {#if editable}
                  <div class="bucket-editor">
                    <div class="bucket-title">Buckets (points)</div>
                    <div class="bucket-row">
                      <input
                        class="input bucket-input"
                        placeholder="e.g. 20,19,18"
                        bind:value={bucketInputByTierId[t.id]}
                      />
                      <button
                        class="btn"
                        disabled={!!savingBucketsByTierId[t.id]}
                        on:click={() => onSaveBucketsForTier(t.id)}
                      >
                        {savingBucketsByTierId[t.id] ? "Saving…" : "Set"}
                      </button>
                    </div>
                    <div class="muted" style="margin-top:.35rem;">
                      This replaces the tier’s columns with these point values.
                    </div>
                  </div>
                {/if}

                <div class="tier-cols">
                  {#each getTierColumns(t.id) as c (colKey(c))}
                    {@const bKey = bucketKey(t.id, c.points)}
                    {@const bucketQuery = editable ? (bucketFilterByKey[bKey] ?? "") : ""}
                    {@const items = getAssignmentsForBucket(t.id, c.points, search, bucketQuery)}

                    <div
                      class="col {editable && drag.active && drag.overBucketKey === bKey ? 'over' : ''}"
                      use:bucketEl={bKey}
                    >
                      <div class="col-head">
                        <div class="col-title">
                          {#if c.points != null}
                            {normPoints(c.points)} pts
                          {:else}
                            Bucket
                          {/if}
                        </div>

                        <div class="col-head-right">
                          <div class="col-count">{items.length}</div>

                          {#if editable}
                            <button
                              class="mini-btn"
                              type="button"
                              on:pointerdown={stopDragPointerDown}
                              on:click|stopPropagation={() => openBulk(bKey)}
                            >
                              Bulk
                            </button>
                          {/if}
                        </div>
                      </div>

                      {#if editable}
                        <input
                          class="bucket-filter"
                          placeholder="Filter this bucket…"
                          value={bucketFilterByKey[bKey] ?? ""}
                          on:input={(e) => setBucketFilter(bKey, e.currentTarget.value)}
                        />
                      {/if}

                      {#if editable && bulkOpenByBucketKey[bKey]}
                        <div class="bulk-panel" on:pointerdown={allowControlPointerDown} on:click|stopPropagation>
                          <div class="bulk-title">Bulk entry</div>

                          <textarea
                            class="bulk-textarea"
                            placeholder="Paste Pokémon names (comma or newline separated)&#10;Example:&#10;Garchomp&#10;Rotom-Wash, Tapu Fini"
                            value={bulkTextByBucketKey[bKey] ?? ""}
                            on:input={(e) => setBulkText(bKey, e.currentTarget.value)}
                          />

                          <div class="bulk-actions">
                            <button
                              class="mini-btn primary"
                              type="button"
                              disabled={!!bulkApplyingByBucketKey[bKey]}
                              on:pointerdown={stopDragPointerDown}
                              on:click={() => applyBulkToBucket(bKey, t.id, c.points)}
                            >
                              {bulkApplyingByBucketKey[bKey] ? "Applying…" : "Apply"}
                            </button>

                            <button
                              class="mini-btn"
                              type="button"
                              on:pointerdown={stopDragPointerDown}
                              on:click={() => closeBulk(bKey)}
                            >
                              Cancel
                            </button>
                          </div>

                          <div class="muted" style="margin-top:.35rem;">
                            Moves every listed Pokémon into this bucket. If any name isn’t found, nothing is applied.
                          </div>
                        </div>
                      {/if}

                      <div class="cards">
                        {#each items as a (assignmentKey(a))}
                          {@const tileStyle = tileStyleForAssignment(a)}
                          <div
                            class="card-item {hasNotes(a) ? 'has-notes' : ''} {editable && isPending(a.pokemon_id) ? 'pending' : ''} {editable ? 'draggable' : 'readonly'} {(!editable && a.owned_by_team_id != null) ? 'owned' : ''}"
                            style={tileStyle}
                            title={!editable && hasNotes(a) ? a.notes : undefined}
                            on:pointerdown={(e) => onCardPointerDown(e, a.pokemon_id, a.pokemon_name)}
                          >
                            <div class="poke-row">
                              <div class="poke-name">
                                {a.pokemon_name}
                              </div>

                              {#if editable}
                                <button
                                  class="mini-btn"
                                  type="button"
                                  on:pointerdown={stopDragPointerDown}
                                  on:click={(e) => { e.stopPropagation(); openMovePicker(a); }}
                                >
                                  Move
                                </button>

                                <button
                                  class="mini-btn"
                                  type="button"
                                  on:pointerdown={stopDragPointerDown}
                                  on:click={(e) => { e.stopPropagation(); openNoteEditor(a); }}
                                >
                                  {hasNotes(a) ? "Note" : "Add note"}
                                </button>
                              {:else if a.owned_by_team_id != null}
                                <div
                                  class="owner-badge"
                                  title={a.owned_by_team_name ?? "Owned"}
                                >
                                  {teamBadgeText(a)}
                                </div>
                              {/if}

                              {#if editable && isPending(a.pokemon_id)}
                                <div class="pill">Pending</div>
                              {/if}
                            </div>

                            {#if editable && movePickerForPokemonId === a.pokemon_id}
                              <div
                                class="move-picker"
                                on:pointerdown={allowControlPointerDown}
                                on:click|stopPropagation
                              >
                                <select
                                  class="select"
                                  bind:value={moveTierId}
                                  on:pointerdown={allowControlPointerDown}
                                  on:change={(e) => {
                                    moveTierId = Number(e.currentTarget.value);
                                    const opts = bucketOptionsForTier(moveTierId);
                                    const next = opts?.[0]?.points ?? null;
                                    movePoints = next;
                                    movePointsStr = (next == null) ? "null" : String(next);
                                  }}
                                >
                                  {#each visibleTiers as tt (tierKey(tt))}
                                    <option value={Number(tt.id)}>{tt.name}</option>
                                  {/each}
                                </select>

                                <select
                                  class="select"
                                  bind:value={movePointsStr}
                                  on:pointerdown={allowControlPointerDown}
                                  on:change={(e) => {
                                    movePointsStr = e.currentTarget.value;
                                    movePoints = (movePointsStr === "null") ? null : Number(movePointsStr);
                                  }}
                                >
                                  {#each bucketOptionsForTier(moveTierId) as b}
                                    <option value={b.points == null ? "null" : String(b.points)}>
                                      {b.label}
                                    </option>
                                  {/each}
                                </select>

                                <button
                                  class="mini-btn primary"
                                  type="button"
                                  on:pointerdown={stopDragPointerDown}
                                  on:click={applyMove}
                                >
                                  Apply
                                </button>
                                <button
                                  class="mini-btn"
                                  type="button"
                                  on:pointerdown={stopDragPointerDown}
                                  on:click={closeMovePicker}
                                >
                                  Cancel
                                </button>
                              </div>
                            {/if}

                            {#if editable && noteEditorForPokemonId === a.pokemon_id}
                              <div
                                class="note-editor"
                                on:pointerdown={allowControlPointerDown}
                                on:click|stopPropagation
                              >
                                <div class="note-title">Notes (max {NOTE_MAX})</div>
                                <textarea
                                  class="note-textarea"
                                  bind:value={noteDraft}
                                  maxlength={NOTE_MAX}
                                  placeholder="Add notes for this Pokémon…"
                                  on:pointerdown={allowControlPointerDown}
                                />

                                <div class="note-actions">
                                  <button
                                    class="mini-btn primary"
                                    type="button"
                                    on:pointerdown={stopDragPointerDown}
                                    on:click={() => saveNotesForPokemon(a.pokemon_id)}
                                  >
                                    Save
                                  </button>

                                  <button
                                    class="mini-btn"
                                    type="button"
                                    on:pointerdown={stopDragPointerDown}
                                    on:click={closeNoteEditor}
                                  >
                                    Cancel
                                  </button>

                                  <button
                                    class="mini-btn"
                                    type="button"
                                    on:pointerdown={stopDragPointerDown}
                                    on:click={() => { noteDraft = ""; }}
                                  >
                                    Clear
                                  </button>
                                </div>
                              </div>
                            {/if}

                            <div class="poke-meta muted">
                              #{a.dex_number ?? "—"}
                              {#if a.owned_by_team_id != null}
                                • {a.owned_by_team_abbrev ?? "FREE"}
                              {:else}
                                • FREE
                              {/if}
                            </div>
                          </div>
                        {/each}

                        {#if items.length === 0}
                          <div class="empty muted">{editable ? "Drop here" : "No matches"}</div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        {/key}
      </div>
    </div>
  {/if}
</div>

{#if editable && drag.active}
  <div class="ghost" style="transform: translate({drag.x + drag.offsetX}px, {drag.y + drag.offsetY}px);">
    {drag.pokemonName || "Dragging…"}
  </div>
{/if}

<style>
  /* (UNCHANGED) — your styles exactly as provided */
  .wrap { display: flex; flex-direction: column; gap: 12px; }
  .topbar { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  .right { display: flex; gap: 10px; align-items: center; }

  .search {
    flex: 1;
    min-width: 220px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.18);
    color: rgba(255,255,255,0.92);
    padding: 0.55rem 0.75rem;
    outline: none;
  }
  .search:focus {
    border-color: rgba(255,107,107,0.35);
    box-shadow: 0 0 0 3px rgba(255,107,107,0.12);
  }

  .btn {
    appearance: none;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.92);
    padding: 0.5rem 0.85rem;
    border-radius: 12px;
    cursor: pointer;
    font-weight: 900;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .card {
    border-radius: 16px;
    padding: 1rem;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .panel-title { font-weight: 900; margin-bottom: 8px; }

  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

  .input {
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.18);
    color: rgba(255,255,255,0.92);
    padding: 0.55rem 0.75rem;
    outline: none;
    min-width: 220px;
    box-sizing: border-box;
  }
  .input.small { min-width: 110px; width: 110px; }

  .check { display: inline-flex; align-items: center; gap: 8px; user-select: none; font-weight: 800; opacity: 0.9; }

  .muted { opacity: 0.75; }
  .error { border-color: rgba(231,76,60,0.45); color: rgba(255,200,200,0.95); }
  .ok { color: rgba(187,247,208,0.95); font-weight: 900; }

  .hscroll-wrap{ display:flex; flex-direction:column; gap:10px; }
  .hscroll{ overflow-x:auto; overflow-y:hidden; width: 100%; max-width: 100%; }
  .hscroll-top{
    position: sticky;
    top: 0;
    z-index: 50;
    height: 18px;
    padding: 2px 0;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(0,0,0,0.22);
    backdrop-filter: blur(6px);
  }
  .hscroll-spacer{ height: 1px; }
  .hscroll-bottom{ width: 100%; padding-bottom: 6px; }

  .grid { display: flex; flex-direction: row; gap: 14px; align-items: flex-start; flex-wrap: nowrap; }

  .tier {
    flex: 0 0 auto;
    width: fit-content;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    border-radius: 18px;
    padding: 12px;
  }

  .tier-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .tier-name { font-weight: 900; font-size: 1.05rem; }

  .badge {
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.8rem;
    font-weight: 900;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(0,0,0,0.18);
  }
  .badge.banned { border-color: rgba(231,76,60,0.35); background: rgba(231,76,60,0.12); }

  .tier-settings{
    margin-bottom: 10px;
    padding: 10px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(0,0,0,0.12);
  }
  .tier-settings-title{ font-weight: 900; margin-bottom: 6px; }
  .tier-settings-row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top: 6px; }
  .tier-settings-input{ min-width: 0; width: 220px; max-width: 220px; }

  .bucket-editor {
    margin-bottom: 10px;
    padding: 10px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(0,0,0,0.12);
  }
  .bucket-title { font-weight: 900; margin-bottom: 6px; }
  .bucket-row { display: flex; gap: 10px; align-items: center; }
  .bucket-input { min-width: 0; width: 220px; max-width: 220px; }

  .tier-cols { display: flex; flex-direction: row; gap: 10px; align-items: flex-start; flex-wrap: nowrap; }

  .col {
    flex: 0 0 auto;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(0,0,0,0.14);
    padding: 8px;
    min-height: 220px;
    box-sizing: border-box;
    width: var(--col-width, 180px);
    min-width: var(--col-min, 180px);
  }

  .col.over {
    border-color: rgba(231,76,60,0.65);
    box-shadow: 0 0 0 3px rgba(231,76,60,0.18);
  }

  .col-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .col-title { font-weight: 900; }
  .col-count { opacity: 0.75; font-weight: 900; font-size: 0.9rem; }

  .bucket-filter {
    width: 100%;
    margin-bottom: 8px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(0,0,0,0.18);
    color: rgba(255,255,255,0.92);
    padding: 0.4rem 0.55rem;
    outline: none;
    font-size: 0.9rem;
    box-sizing: border-box;
  }

  .cards { display: flex; flex-direction: column; gap: 8px; }

  .card-item {
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
    padding: 8px;
    user-select: none;
    touch-action: none;
  }

  /* NEW: when we color a drafted tile, help text remain readable */
  .card-item.owned {
    color: rgba(255,255,255,0.94);
    text-shadow: 0 1px 12px rgba(0,0,0,0.45);
  }
  .card-item.owned .muted {
    opacity: 0.92;
  }

  .card-item.draggable { cursor: grab; }
  .card-item.readonly { cursor: default; }

  .card-item.pending {
    border-color: rgba(231,76,60,0.55);
    background: rgba(231,76,60,0.10);
  }

  .card-item.has-notes {
    position: relative;
  }

  .card-item.has-notes::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: 0;
    height: 0;
    border-top: 10px solid #000;
    border-left: 10px solid transparent;
    pointer-events: none;
  }

  .poke-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .poke-name { font-weight: 900; font-size: 0.95rem; }
  .poke-meta { font-size: 0.75rem; }

  .note-indicator {
    font-size: 0.85rem;
    opacity: 0.85;
    margin-left: 6px;
    user-select: none;
  }

  .note-editor {
    margin-top: 8px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(0,0,0,0.22);
    padding: 8px;
  }

  .note-title { font-weight: 900; font-size: 0.85rem; margin-bottom: 6px; opacity: 0.9; }

  .note-textarea {
    width: 100%;
    min-height: 74px;
    resize: vertical;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(0,0,0,0.18);
    color: rgba(255,255,255,0.92);
    padding: 0.45rem 0.55rem;
    outline: none;
    box-sizing: border-box;
    font: inherit;
  }

  .note-actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }

  .pill {
    font-size: 0.72rem;
    font-weight: 900;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid rgba(231,76,60,0.55);
    background: rgba(231,76,60,0.14);
    color: rgba(255,220,220,0.95);
  }

  .empty {
    border-radius: 14px;
    border: 1px dashed rgba(255,255,255,0.14);
    padding: 10px;
    text-align: center;
  }

  .ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 9999;
    pointer-events: none;
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(0,0,0,0.65);
    color: rgba(255,255,255,0.95);
    font-weight: 900;
    box-shadow: 0 12px 30px rgba(0,0,0,0.35);
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transform: translate(0px, 0px);
  }

  .owner-badge{
    flex: 0 0 auto;
    min-width: 28px;
    height: 24px;
    padding: 0 8px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    font-size: 0.8rem;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(0,0,0,0.18);
    opacity: 0.95;
  }

  .mini-btn{
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.92);
    padding: 4px 8px;
    font-weight: 900;
    cursor: pointer;
    font-size: 0.78rem;
    line-height: 1;
  }
  .mini-btn.primary{
    background: rgba(255,107,107,0.18);
    border-color: rgba(255,107,107,0.35);
  }
  .mini-btn.danger{
    background: rgba(231,76,60,0.14);
    border-color: rgba(231,76,60,0.40);
  }

  .move-picker{
    margin-top: 8px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    padding: 8px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(0,0,0,0.18);
  }

  /* ============================
     Tier Color Themes (Stronger)
     ============================ */

  .tier{
    --tier-accent: rgba(255,255,255,0.30);
    --tier-accent-weak: rgba(255,255,255,0.16);
    --tier-tint: rgba(255,255,255,0.10);
    --tier-tint-2: rgba(0,0,0,0.18);
  }

  .tier{
    border-color: var(--tier-accent-weak);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--tier-tint) 85%, rgba(255,255,255,0.02)),
      rgba(255,255,255,0.02)
    );
    box-shadow:
      0 12px 28px rgba(0,0,0,0.20),
      0 0 0 1px color-mix(in srgb, var(--tier-accent) 22%, transparent);
  }

  .tier-head{
    padding: 8px 10px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--tier-accent) 35%, rgba(255,255,255,0.10));
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--tier-tint) 55%, rgba(0,0,0,0.18)),
      rgba(0,0,0,0.14)
    );
  }

  .tier-name{
    text-shadow: 0 0 18px rgba(0,0,0,0.45);
  }

  .tier .badge{
    border-color: color-mix(in srgb, var(--tier-accent) 55%, rgba(255,255,255,0.14));
    background: color-mix(in srgb, var(--tier-tint) 35%, rgba(0,0,0,0.18));
  }

  .tier .bucket-editor,
  .tier .col,
  .tier .tier-settings{
    border-color: color-mix(in srgb, var(--tier-accent) 30%, rgba(255,255,255,0.10));
  }

  .tier .bucket-editor,
  .tier .tier-settings{
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--tier-tint) 35%, rgba(0,0,0,0.14)),
      rgba(0,0,0,0.12)
    );
  }

  .tier .col{
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--tier-tint) 30%, rgba(0,0,0,0.18)),
      var(--tier-tint-2)
    );
  }

  .tier .col.over{
    border-color: color-mix(in srgb, var(--tier-accent) 90%, rgba(255,255,255,0.14));
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--tier-accent) 35%, transparent),
      0 10px 24px rgba(0,0,0,0.20);
  }

  .tier .bucket-filter:focus,
  .tier .input:focus,
  .tier .select:focus{
    border-color: color-mix(in srgb, var(--tier-accent) 85%, rgba(255,255,255,0.12));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--tier-accent) 35%, transparent);
  }

  .tier .mini-btn.primary{
    background: color-mix(in srgb, var(--tier-accent) 28%, rgba(255,255,255,0.06));
    border-color: color-mix(in srgb, var(--tier-accent) 65%, rgba(255,255,255,0.14));
  }

  .tier-theme-red{
    --tier-accent: rgba(255, 60,  60,  0.95);
    --tier-accent-weak: rgba(255, 60,  60,  0.35);
    --tier-tint: rgba(255, 60,  60,  0.18);
  }
  .tier-theme-orange{
    --tier-accent: rgba(255, 140, 35,  0.95);
    --tier-accent-weak: rgba(255, 140, 35,  0.35);
    --tier-tint: rgba(255, 140, 35,  0.18);
  }
  .tier-theme-yellow{
    --tier-accent: rgba(255, 220, 60,  0.95);
    --tier-accent-weak: rgba(255, 220, 60,  0.35);
    --tier-tint: rgba(255, 220, 60,  0.16);
  }
  .tier-theme-green{
    --tier-accent: rgba(60,  220, 120, 0.95);
    --tier-accent-weak: rgba(60,  220, 120, 0.33);
    --tier-tint: rgba(60,  220, 120, 0.16);
  }
  .tier-theme-blue{
    --tier-accent: rgba(70,  160, 255, 0.95);
    --tier-accent-weak: rgba(70,  160, 255, 0.35);
    --tier-tint: rgba(70,  160, 255, 0.16);
  }
  .tier-theme-purple{
    --tier-accent: rgba(185, 95,  255, 0.95);
    --tier-accent-weak: rgba(185, 95,  255, 0.35);
    --tier-tint: rgba(185, 95,  255, 0.16);
  }

  .tier-theme-banned{
    --tier-accent: rgba(235,235,235,0.78);
    --tier-accent-weak: rgba(235,235,235,0.28);
    --tier-tint: rgba(210,210,210,0.10);
    --tier-tint-2: rgba(0,0,0,0.16);
    filter: grayscale(1);
  }

  .tier-theme-banned .badge.banned{
    border-color: rgba(245,245,245,0.35);
    background: rgba(255,255,255,0.06);
  }

  .col-head-right{
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .tier-head-right{
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .bulk-panel{
    margin-bottom: 8px;
    padding: 8px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(0,0,0,0.18);
  }

  .bulk-title{
    font-weight: 900;
    margin-bottom: 6px;
  }

  .bulk-textarea{
    width: 100%;
    min-height: 90px;
    resize: vertical;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.18);
    color: rgba(255,255,255,0.92);
    padding: 8px;
    outline: none;
    box-sizing: border-box;
    font-weight: 700;
  }

  .bulk-actions{
    margin-top: 8px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
</style>
