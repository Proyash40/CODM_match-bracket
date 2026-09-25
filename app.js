/**
 * ============================================================================
 *  MECHTRONICA CODM · TACTICAL COMMAND
 *  app.js  -  Core: global state, localStorage wrapper, tab navigation,
 *             and the "War Room" module (lobby alert + squad lookup).
 * ============================================================================
 *
 *  This file MUST load first (see the <script defer> order in index.html).
 *  It creates one global object, `window.App`, that every other file uses.
 *
 *  ARCHITECTURE
 *  ------------
 *  - State lives in ONE plain object (App.state). Feature files mutate it
 *    directly, then call App.commit('scope') to persist it and notify
 *    listeners.
 *  - Each tab is a "module" registered with App.register(name, { init, render }).
 *    App calls init() once on load and render() every time that tab opens,
 *    so modules never need to know about each other directly. Where one DOES
 *    need another's data (War Room reads bracket/league status), it fetches
 *    the other module with App.module(name) and calls a small public method
 *    on it — see getStatus() in bracket.js and league.js.
 *  - Everything is stored under one localStorage key (STORAGE_KEY).
 *
 *  STATE SHAPE (version 1)
 *  ------------------------
 *  {
 *    version:   1,
 *    activeTab: 'warroom' | 'roster' | 'bracket' | 'league',
 *    teams:     [{ id, name }],          // ordered list; order = seeding
 *    bracket:   null | { ... }           // documented in bracket.js
 *    league:    null | { ... }           // documented in league.js
 *    lobby:     { roomId, password, endsAt }   // endsAt: epoch ms or null
 *  }
 * ============================================================================
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------------
   * 1. CONSTANTS
   * --------------------------------------------------------------------- */
  const STORAGE_KEY = 'mechtronica-codm:tactical-command';
  const SCHEMA_VERSION = 1;
  const TABS = ['warroom', 'roster', 'bracket', 'league'];
  const TAB_TITLES = {
    warroom: 'War Room',
    roster: 'Squad Roster',
    bracket: 'Top 8 Tactical Bracket',
    league: 'Round-Robin Matrix'
  };

  /* ------------------------------------------------------------------------
   * 2. LOCAL STORAGE WRAPPER
   *    localStorage can throw (private browsing, storage full, blocked by
   *    browser settings), so every call is wrapped and fails soft.
   * --------------------------------------------------------------------- */
  function createDefaultState() {
    return {
      version: SCHEMA_VERSION,
      activeTab: 'warroom',
      teams: [],
      bracket: null,
      league: null,
      lobby: { roomId: '', password: '', endsAt: null }
    };
  }

  const Store = {
    load() {
      try {
        const raw = global.localStorage.getItem(STORAGE_KEY);
        if (!raw) return createDefaultState();
        const parsed = JSON.parse(raw);
        const valid = parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.teams);
        return valid ? Object.assign(createDefaultState(), parsed) : createDefaultState();
      } catch (err) {
        console.warn('[Mechtronica] Could not read saved data, starting fresh.', err);
        return createDefaultState();
      }
    },
    save(nextState) {
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        return true;
      } catch (err) {
        console.warn('[Mechtronica] Could not save data.', err);
        return false;
      }
    },
    clear() {
      try { global.localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
    }
  };

  /* ------------------------------------------------------------------------
   * 3. MODULE REGISTRY + TINY EVENT BUS
   * --------------------------------------------------------------------- */
  let state = Store.load();
  let storageWarningShown = false;
  const modules = {};      // name -> { init?, render? , ...publicMethods }
  const listeners = {};    // event name -> [callbacks]

  function on(eventName, callback) {
    (listeners[eventName] = listeners[eventName] || []).push(callback);
  }
  function emit(eventName, payload) {
    (listeners[eventName] || []).forEach(function (cb) { cb(payload); });
  }

  function save() {
    const ok = Store.save(state);
    if (!ok && !storageWarningShown) {
      storageWarningShown = true;
      toast('Browser storage was blocked. Progress will be lost on close.', 'error', 6000);
    }
    return ok;
  }

  /** Call after mutating App.state. Saves, then emits "<scope>:changed" and "changed". */
  function commit(scope) {
    save();
    emit(scope + ':changed');
    emit('changed', scope);
  }

  /* ------------------------------------------------------------------------
   * 4. UTILITIES shared by all modules (exposed as App.util)
   * --------------------------------------------------------------------- */
  const util = {
    uid(prefix) {
      return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },
    /** Escape text before putting it into innerHTML. ALWAYS use for user input. */
    esc(value) {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return String(value).replace(/[&<>"']/g, function (ch) { return map[ch]; });
    },
    shuffle(list) {
      const copy = list.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
      }
      return copy;
    },
    /** True when a saved roster snapshot ([{id}]) matches the live team list. */
    sameRoster(snapshot, teams) {
      if (snapshot.length !== teams.length) return false;
      const ids = new Set(snapshot.map(function (t) { return t.id; }));
      return teams.every(function (t) { return ids.has(t.id); });
    },
    pad2(n) { return n < 10 ? '0' + n : String(n); }
  };

  /* ------------------------------------------------------------------------
   * 5. TOASTS
   * --------------------------------------------------------------------- */
  function toast(message, type, duration) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    root.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () { el.remove(); }, 260);
    }, duration || 3500);
  }

  /* ------------------------------------------------------------------------
   * 6. CONFIRM DIALOG (promise based, wraps the <dialog> in index.html)
   * --------------------------------------------------------------------- */
  function confirmDialog(options) {
    const dialog = document.getElementById('confirm-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') {
      return Promise.resolve(global.confirm(options.message));
    }
    document.getElementById('confirm-title').textContent = options.title || 'Confirm action';
    document.getElementById('confirm-message').textContent = options.message;
    const okButton = document.getElementById('confirm-ok');
    okButton.textContent = options.confirmLabel || 'Confirm';
    okButton.className = 'btn ' + (options.danger ? 'btn-danger-solid' : 'btn-primary');

    return new Promise(function (resolve) {
      dialog.returnValue = 'cancel';
      function onClose() {
        dialog.removeEventListener('close', onClose);
        resolve(dialog.returnValue === 'ok');
      }
      dialog.addEventListener('close', onClose);
      dialog.showModal();
    });
  }

  /* ------------------------------------------------------------------------
   * 7. TAB NAVIGATION
   * --------------------------------------------------------------------- */
  function showTab(tab) {
    if (TABS.indexOf(tab) === -1) tab = 'warroom';
    state.activeTab = tab;

    document.querySelectorAll('[data-view]').forEach(function (section) {
      section.hidden = section.dataset.view !== tab;
    });
    document.querySelectorAll('.hud-tab[data-tab]').forEach(function (btn) {
      if (btn.dataset.tab === tab) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });

    const mod = modules[tab];
    if (mod && typeof mod.render === 'function') mod.render();

    document.title = TAB_TITLES[tab] + ' · MECHTRONICA CODM';
    if (global.location.hash !== '#' + tab) global.location.hash = tab;
    save();
    global.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------------
   * 8. RESET
   * --------------------------------------------------------------------- */
  async function resetAll() {
    const ok = await confirmDialog({
      title: 'Wipe all tournament data?',
      message: 'This deletes every squad, the bracket, the league and the lobby alert. It cannot be undone.',
      confirmLabel: 'Wipe data',
      danger: true
    });
    if (!ok) return;

    Store.clear();
    state = createDefaultState();
    save();
    emit('changed', 'reset');
    showTab('warroom');
    toast('All tournament data wiped.', 'success');
  }

  /* ------------------------------------------------------------------------
   * 9. WAR ROOM MODULE
   *    Public-facing telemetry: the flashing lobby alert (room ID, password,
   *    join countdown), a squad lookup search, and a live status grid. Status
   *    is computed by asking the bracket and league modules for their read
   *    on a given team (see getStatus() in bracket.js / league.js).
   * --------------------------------------------------------------------- */
  const WarRoom = (function () {
    let els = {};
    let timerInterval = null;

    /* ---- Lobby alert (room ID / password / countdown) ---- */

    function formatClock(msRemaining) {
      const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
      const mm = Math.floor(totalSeconds / 60);
      const ss = totalSeconds % 60;
      return util.pad2(mm) + ':' + util.pad2(ss);
    }

    function renderLobby() {
      const lobby = state.lobby;
      els.roomDisplay.textContent = lobby.roomId ? lobby.roomId : '— — — —';
      els.passDisplay.textContent = lobby.password ? lobby.password : '— — — —';

      if (!lobby.endsAt) {
        els.timerDisplay.textContent = '--:--';
        els.timerDisplay.className = 'lobby-field-value lobby-timer';
        return;
      }

      const remaining = lobby.endsAt - Date.now();
      if (remaining <= 0) {
        els.timerDisplay.textContent = 'CLOSED';
        els.timerDisplay.className = 'lobby-field-value lobby-timer is-expired';
        return;
      }
      els.timerDisplay.textContent = formatClock(remaining);
      els.timerDisplay.className = 'lobby-field-value lobby-timer' + (remaining <= 30000 ? ' is-critical' : '');
    }

    /** Ticks every second while the War Room tab is visible; index.html has no other timers. */
    function startTicker() {
      stopTicker();
      timerInterval = setInterval(renderLobby, 1000);
    }
    function stopTicker() {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }

    function onLobbySubmit(event) {
      event.preventDefault();
      const minutes = Math.min(60, Math.max(1, Number(els.minutesInput.value) || 2));
      state.lobby = {
        roomId: els.roomInput.value.trim().slice(0, 24),
        password: els.passInput.value.trim().slice(0, 24),
        endsAt: Date.now() + minutes * 60000
      };
      commit('lobby');
      renderLobby();
      els.lobbyForm.hidden = true;
      toast('Lobby alert broadcast to the War Room.', 'success');
    }

    async function onLobbyClear() {
      const ok = await confirmDialog({ title: 'Clear the lobby alert?', message: 'The room ID, password and timer will be removed from the banner.', confirmLabel: 'Clear alert' });
      if (!ok) return;
      state.lobby = { roomId: '', password: '', endsAt: null };
      commit('lobby');
      renderLobby();
      els.roomInput.value = ''; els.passInput.value = ''; els.minutesInput.value = '2';
    }

    /* ---- Squad status (shared logic used by both lookup and the grid) ---- */

    /**
     * Combine bracket status (if a bracket exists) or league status (if a
     * league exists) into one { state, label, detail } object, or a default
     * "registered, nothing started yet" status.
     * state is one of: 'qualified' | 'eliminated' | 'ondeck'
     */
    function getCombinedStatus(teamId) {
      const bracketMod = modules.bracket;
      const leagueMod = modules.league;

      if (bracketMod && typeof bracketMod.getStatus === 'function') {
        const s = bracketMod.getStatus(teamId);
        if (s) return s;
      }
      if (leagueMod && typeof leagueMod.getStatus === 'function') {
        const s = leagueMod.getStatus(teamId);
        if (s) return s;
      }
      return { state: 'ondeck', label: 'ON DECK', detail: 'Registered — tournament stage not yet generated.' };
    }

    function statusCardHtml(team, status) {
      return '' +
        '<div class="status-card is-' + status.state + '">' +
          '<span class="status-badge is-' + status.state + '">' + util.esc(status.label) + '</span>' +
          '<div class="status-card-body">' +
            '<p class="status-card-name">' + util.esc(team.name) + '</p>' +
            '<p class="status-card-detail">' + util.esc(status.detail) + '</p>' +
          '</div>' +
        '</div>';
    }

    function onLookupSubmit(event) {
      event.preventDefault();
      const query = els.lookupInput.value.trim().toLowerCase();
      els.lookupResult.hidden = false;

      if (!query) {
        els.lookupResult.innerHTML = statusCardHtml({ name: 'Enter a squad name' }, { state: 'notfound', label: 'NO INPUT', detail: 'Type a squad name to search.' });
        return;
      }

      const team = state.teams.find(function (t) { return t.name.toLowerCase() === query; }) ||
        state.teams.find(function (t) { return t.name.toLowerCase().indexOf(query) !== -1; });

      if (!team) {
        els.lookupResult.innerHTML = statusCardHtml({ name: '"' + els.lookupInput.value.trim() + '"' }, { state: 'notfound', label: 'NOT FOUND', detail: 'No squad matches that name. Check the Squad Roster tab.' });
        return;
      }
      els.lookupResult.innerHTML = statusCardHtml(team, getCombinedStatus(team.id));
    }

    function renderStatusGrid() {
      const teams = state.teams;
      els.statusGridEmpty.hidden = teams.length > 0;
      els.statusGrid.hidden = teams.length === 0;
      if (teams.length === 0) { els.statusGrid.innerHTML = ''; return; }

      els.statusGrid.innerHTML = teams.map(function (team) {
        const status = getCombinedStatus(team.id);
        return '' +
          '<div class="status-tile is-' + status.state + '" title="' + util.esc(status.detail) + '">' +
            '<span class="status-tile-dot" aria-hidden="true"></span>' +
            '<span class="status-tile-name">' + util.esc(team.name) + '</span>' +
            '<span class="status-tile-label">' + util.esc(status.label) + '</span>' +
          '</div>';
      }).join('');
    }

    function render() {
      renderLobby();
      renderStatusGrid();
      // Keep an open lookup result in sync when other tabs change bracket/league state.
      if (!els.lookupResult.hidden && els.lookupInput.value.trim()) onLookupSubmit({ preventDefault: function () {} });
    }

    function init() {
      els = {
        roomDisplay: document.getElementById('lobby-room-display'),
        passDisplay: document.getElementById('lobby-pass-display'),
        timerDisplay: document.getElementById('lobby-timer-display'),
        editToggle: document.getElementById('lobby-edit-toggle'),
        lobbyForm: document.getElementById('lobby-form'),
        roomInput: document.getElementById('lobby-room-input'),
        passInput: document.getElementById('lobby-pass-input'),
        minutesInput: document.getElementById('lobby-minutes-input'),
        clearBtn: document.getElementById('lobby-clear-btn'),
        lookupForm: document.getElementById('lookup-form'),
        lookupInput: document.getElementById('lookup-input'),
        lookupResult: document.getElementById('lookup-result'),
        statusGrid: document.getElementById('status-grid'),
        statusGridEmpty: document.getElementById('status-grid-empty')
      };

      els.editToggle.addEventListener('click', function () { els.lobbyForm.hidden = !els.lobbyForm.hidden; });
      els.lobbyForm.addEventListener('submit', onLobbySubmit);
      els.clearBtn.addEventListener('click', onLobbyClear);
      els.lookupForm.addEventListener('submit', onLookupSubmit);

      // The countdown must keep ticking even while another tab is open, so a
      // stale "CLOSED" banner is never shown when the organiser tabs back.
      startTicker();
      on('changed', function () { if (state.activeTab === 'warroom') render(); });
    }

    return { init: init, render: render };
  })();

  /* ------------------------------------------------------------------------
   * 10. INIT
   * --------------------------------------------------------------------- */
  function updateShell() {
    document.querySelectorAll('[data-shell-stat="teams"]').forEach(function (el) {
      el.textContent = state.teams.length;
    });
  }

  function init() {
    document.addEventListener('click', function (event) {
      const tabTrigger = event.target.closest('[data-tab]');
      if (tabTrigger) { showTab(tabTrigger.dataset.tab); return; }
      if (event.target.closest('[data-action="reset-all"]')) resetAll();
    });

    const dialog = document.getElementById('confirm-dialog');
    if (dialog) dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close('cancel');
    });

    global.addEventListener('hashchange', function () {
      const tab = global.location.hash.slice(1);
      if (TABS.indexOf(tab) !== -1 && tab !== state.activeTab) showTab(tab);
    });

    global.addEventListener('storage', function (event) {
      if (event.key !== STORAGE_KEY) return;
      state = Store.load();
      emit('changed', 'external');
      showTab(state.activeTab);
    });

    on('changed', updateShell);

    modules.warroom = WarRoom;
    Object.keys(modules).forEach(function (name) {
      if (typeof modules[name].init === 'function') modules[name].init();
    });

    updateShell();
    const hashTab = global.location.hash.slice(1);
    showTab(TABS.indexOf(hashTab) !== -1 ? hashTab : state.activeTab);
  }

  /* ------------------------------------------------------------------------
   * 11. PUBLIC API
   * --------------------------------------------------------------------- */
  global.App = {
    get state() { return state; },
    register: function (name, mod) { modules[name] = mod; },
    module: function (name) { return modules[name]; },
    on: on,
    emit: emit,
    save: save,
    commit: commit,
    showTab: showTab,
    toast: toast,
    confirm: confirmDialog,
    resetAll: resetAll,
    util: util
  };

  document.addEventListener('DOMContentLoaded', init);
})(window);
