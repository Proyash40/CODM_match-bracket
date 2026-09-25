/**
 * ============================================================================
 *  MECHTRONICA CODM · TACTICAL COMMAND
 *  teams.js  -  "Squad Roster" tab
 * ============================================================================
 *
 *  Responsibilities
 *  - Bulk-add squads from a comma-separated textarea (a single name works too).
 *  - Rename a squad in place, delete it, reorder it (list order = seeding).
 *  - Show a live summary of what the roster will produce (bracket size, byes,
 *    league fixture count).
 *
 *  Data owned by this module:   App.state.teams  ->  [{ id, name }]
 *
 *  A team's `id` never changes, so renaming or reordering here can never
 *  corrupt a bracket or league that already refers to that id.
 * ============================================================================
 */
(function (App) {
  'use strict';

  const MAX_TEAMS = 64;
  const MAX_NAME_LENGTH = 32;
  const DEMO_TEAMS = [
    'Phantom Squad', 'Iron Wolves', 'Crimson Reapers', 'Ghost Protocol',
    'Neon Vipers', 'Apex Predators', 'Nova Strike', 'Shadow Legion'
  ];

  const ICON_UP = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
  const ICON_DOWN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_EDIT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>';

  const esc = App.util.esc;
  const $ = function (id) { return document.getElementById(id); };
  let els = {};
  let editingId = null;   // id of the squad currently in rename mode, or null

  /* ------------------------------------------------------------------------
   * MODEL
   * --------------------------------------------------------------------- */

  function isNameTaken(name, teams, excludeId) {
    const lower = name.toLowerCase();
    return teams.some(function (t) { return t.id !== excludeId && t.name.toLowerCase() === lower; });
  }

  /** @returns {{added:number, errors:string[]}} */
  function addTeams(rawNames) {
    const teams = App.state.teams;
    const errors = [];
    let added = 0;

    for (let i = 0; i < rawNames.length; i++) {
      const name = rawNames[i].trim().replace(/\s+/g, ' ');
      if (!name) continue;

      if (name.length > MAX_NAME_LENGTH) {
        errors.push('"' + name.slice(0, 14) + '…" is over ' + MAX_NAME_LENGTH + ' characters.');
        continue;
      }
      if (isNameTaken(name, teams, null)) {
        errors.push('"' + name + '" is already on the roster.');
        continue;
      }
      if (teams.length >= MAX_TEAMS) {
        errors.push('The roster limit is ' + MAX_TEAMS + ' squads.');
        break;
      }
      teams.push({ id: App.util.uid('squad'), name: name });
      added++;
    }

    if (added > 0) App.commit('teams');
    return { added: added, errors: errors };
  }

  function renameTeam(id, rawName) {
    const teams = App.state.teams;
    const team = teams.find(function (t) { return t.id === id; });
    if (!team) return true;

    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name) { App.toast('Squad name cannot be empty.', 'warn'); return false; }
    if (name.length > MAX_NAME_LENGTH) { App.toast('Squad name is over ' + MAX_NAME_LENGTH + ' characters.', 'warn'); return false; }
    if (isNameTaken(name, teams, id)) { App.toast('"' + name + '" is already on the roster.', 'warn'); return false; }

    if (name !== team.name) { team.name = name; App.commit('teams'); }
    return true;
  }

  function removeTeam(id) {
    const teams = App.state.teams;
    const index = teams.findIndex(function (t) { return t.id === id; });
    if (index === -1) return;

    const removed = teams.splice(index, 1)[0];
    App.commit('teams');
    render();

    if (App.state.bracket || App.state.league) {
      App.toast(removed.name + ' removed. Regenerate the bracket or league to reflect this.', 'info', 4500);
    }
  }

  function moveTeam(id, direction) {
    const teams = App.state.teams;
    const from = teams.findIndex(function (t) { return t.id === id; });
    const to = from + direction;
    if (from === -1 || to < 0 || to >= teams.length) return;

    const tmp = teams[from]; teams[from] = teams[to]; teams[to] = tmp;
    App.commit('teams');
    render();
  }

  /* ------------------------------------------------------------------------
   * RENDERING
   * --------------------------------------------------------------------- */
  function nextPowerOfTwo(n) {
    let power = 1;
    while (power < n) power *= 2;
    return power;
  }

  function renderStats() {
    const n = App.state.teams.length;
    if (n < 2) {
      els.statSize.textContent = els.statByes.textContent = els.statRounds.textContent = els.statFixtures.textContent = '–';
      return;
    }
    const size = nextPowerOfTwo(n);
    els.statSize.textContent = size + ' slots';
    els.statByes.textContent = size - n;
    els.statRounds.textContent = Math.log2(size);
    els.statFixtures.textContent = (n * (n - 1)) / 2;
  }

  /** One roster row. In rename mode the name becomes a text input instead of a span. */
  function rowHtml(team, index, total) {
    const name = esc(team.name);
    const isEditing = team.id === editingId;

    const nameCell = isEditing
      ? '<input type="text" class="input roster-name-edit" data-role="rename-input" value="' + name + '" maxlength="' + MAX_NAME_LENGTH + '" aria-label="Rename ' + name + '">'
      : '<span class="roster-name" title="' + name + '">' + name + '</span>';

    const actions = isEditing
      ? '<button type="button" class="icon-btn" data-action="save" aria-label="Save name">' + '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>' + '</button>' +
        '<button type="button" class="icon-btn" data-action="cancel-edit" aria-label="Cancel rename">' + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' + '</button>'
      : '<button type="button" class="icon-btn" data-action="up" aria-label="Move ' + name + ' up"' + (index === 0 ? ' disabled' : '') + '>' + ICON_UP + '</button>' +
        '<button type="button" class="icon-btn" data-action="down" aria-label="Move ' + name + ' down"' + (index === total - 1 ? ' disabled' : '') + '>' + ICON_DOWN + '</button>' +
        '<button type="button" class="icon-btn" data-action="edit" aria-label="Rename ' + name + '">' + ICON_EDIT + '</button>' +
        '<button type="button" class="icon-btn icon-btn-danger" data-action="delete" aria-label="Remove ' + name + '">' + ICON_TRASH + '</button>';

    return '' +
      '<li class="roster-item" data-id="' + team.id + '">' +
        '<span class="seed-badge" title="Seed ' + (index + 1) + '">SEED<span class="seed-badge-num">' + App.util.pad2(index + 1) + '</span></span>' +
        nameCell +
        '<div class="roster-actions">' + actions + '</div>' +
      '</li>';
  }

  function render() {
    const teams = App.state.teams;
    els.count.textContent = teams.length;
    els.empty.hidden = teams.length > 0;
    els.clearBtn.disabled = teams.length === 0;
    els.list.hidden = teams.length === 0;

    els.list.innerHTML = teams.map(function (team, i) { return rowHtml(team, i, teams.length); }).join('');

    if (editingId) {
      const input = els.list.querySelector('[data-role="rename-input"]');
      if (input) { input.focus(); input.select(); }
    }
    renderStats();
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = !message;
  }

  /* ------------------------------------------------------------------------
   * EVENT HANDLERS
   * --------------------------------------------------------------------- */
  function onSubmit(event) {
    event.preventDefault();
    const names = els.textarea.value.split(/[,;\n]+/);
    if (!names.some(function (n) { return n.trim(); })) {
      showError('Enter at least one squad name.');
      els.textarea.focus();
      return;
    }

    const result = addTeams(names);
    showError(result.errors.join(' '));

    if (result.added > 0) {
      els.textarea.value = result.errors.length ? els.textarea.value : '';
      render();
      App.toast(result.added === 1 ? 'Squad deployed.' : result.added + ' squads deployed.', 'success', 2200);
    }
  }

  function saveEdit(item) {
    const input = item.querySelector('[data-role="rename-input"]');
    const ok = renameTeam(item.dataset.id, input.value);
    if (ok) { editingId = null; render(); }
    else { input.focus(); input.select(); }
  }

  function onListClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const item = button.closest('[data-id]');
    if (!item) return;
    const id = item.dataset.id;
    const action = button.dataset.action;

    if (action === 'delete') removeTeam(id);
    else if (action === 'up') moveTeam(id, -1);
    else if (action === 'down') moveTeam(id, 1);
    else if (action === 'edit') { editingId = id; render(); }
    else if (action === 'save') saveEdit(item);
    else if (action === 'cancel-edit') { editingId = null; render(); }
  }

  /** Enter saves, Escape cancels, while typing inside a rename input. */
  function onListKeydown(event) {
    const input = event.target.closest('[data-role="rename-input"]');
    if (!input) return;
    const item = input.closest('[data-id]');
    if (event.key === 'Enter') { event.preventDefault(); saveEdit(item); }
    else if (event.key === 'Escape') { event.preventDefault(); editingId = null; render(); }
  }

  async function onClearAll() {
    const ok = await App.confirm({
      title: 'Disband every squad?',
      message: 'The roster will be emptied. A bracket or league that already exists keeps its own copy of the squads until you regenerate it.',
      confirmLabel: 'Disband all',
      danger: true
    });
    if (!ok) return;
    App.state.teams = [];
    App.commit('teams');
    editingId = null;
    render();
  }

  function onLoadDemo() {
    const result = addTeams(DEMO_TEAMS);
    render();
    App.toast(result.added ? result.added + ' demo squads deployed.' : 'Demo squads are already on the roster.', result.added ? 'success' : 'info');
  }

  /* ------------------------------------------------------------------------
   * MODULE REGISTRATION
   * --------------------------------------------------------------------- */
  function init() {
    els = {
      form: $('roster-form'),
      textarea: $('roster-textarea'),
      error: $('roster-error'),
      list: $('roster-list'),
      empty: $('roster-empty'),
      count: $('roster-count'),
      clearBtn: $('roster-clear-btn'),
      demoBtn: $('roster-demo-btn'),
      statSize: $('stat-size'),
      statByes: $('stat-byes'),
      statRounds: $('stat-rounds'),
      statFixtures: $('stat-fixtures')
    };

    els.form.addEventListener('submit', onSubmit);
    els.textarea.addEventListener('input', function () { if (els.error.textContent) showError(''); });
    els.list.addEventListener('click', onListClick);
    els.list.addEventListener('keydown', onListKeydown);
    els.clearBtn.addEventListener('click', onClearAll);
    els.demoBtn.addEventListener('click', onLoadDemo);
  }

  App.register('teams', { init: init, render: render });
})(window.App);
