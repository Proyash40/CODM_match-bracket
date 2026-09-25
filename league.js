/**
 * ============================================================================
 *  MECHTRONICA CODM · TACTICAL COMMAND
 *  league.js  -  "Round-Robin Matrix" tab
 * ============================================================================
 *
 *  Every squad plays every other squad exactly once.
 *
 *  DATA MODEL
 *  ----------
 *  App.state.league = {
 *    participants: [{ id, name }],              // roster snapshot at generation time
 *    matchdays: [
 *      {
 *        number:   1,
 *        bye:      teamId | null,               // resting squad when the count is odd
 *        fixtures: [{ id, a, b, scoreA, scoreB }]  // scores are null until entered
 *      }
 *    ],
 *    createdAt: 1700000000000
 *  }
 *
 *  Standings are always DERIVED from the fixtures, never stored, so they
 *  can't drift out of sync with the scores.
 *
 *  SCHEDULING
 *  ----------
 *  Uses the "circle method": one team stays fixed, the others rotate one
 *  place each matchday. With N teams (N even) that's N-1 matchdays of N/2
 *  fixtures. For odd N, a phantom "bye" team is added and whoever draws it
 *  rests that matchday.
 *
 *  SCORING
 *  -------
 *  Per the brief: a win is worth 2 points, a loss 0. The brief doesn't cover
 *  a tied score, so as a documented fallback a tie splits 1 point each.
 * ============================================================================
 */
(function (App) {
  'use strict';

  const POINTS = { win: 2, draw: 1, loss: 0 };
  const MAX_SCORE = 99;

  const esc = App.util.esc;
  const $ = function (id) { return document.getElementById(id); };
  let els = {};

  /* ------------------------------------------------------------------------
   * PURE HELPERS
   * --------------------------------------------------------------------- */

  function buildMatchdays(teamIds) {
    const ring = teamIds.slice();
    if (ring.length % 2 === 1) ring.push(null);
    const n = ring.length;
    const matchdays = [];

    for (let round = 0; round < n - 1; round++) {
      const fixtures = [];
      let bye = null;

      for (let i = 0; i < n / 2; i++) {
        const home = ring[i];
        const away = ring[n - 1 - i];

        if (home === null || away === null) { bye = home === null ? away : home; continue; }
        const flip = i === 0 && round % 2 === 1;   // alternate the fixed team's side
        fixtures.push({ id: 'md' + (round + 1) + '-' + (i + 1), a: flip ? away : home, b: flip ? home : away, scoreA: null, scoreB: null });
      }
      matchdays.push({ number: round + 1, bye: bye, fixtures: fixtures });
      ring.splice(1, 0, ring.pop());
    }
    return matchdays;
  }

  function isPlayed(fx) { return Number.isInteger(fx.scoreA) && Number.isInteger(fx.scoreB); }

  function parseScore(text) {
    if (text === '' || text === null || text === undefined) return null;
    const value = Number(text);
    return Number.isInteger(value) && value >= 0 && value <= MAX_SCORE ? value : null;
  }

  function fixtureFlags(fx) {
    const played = isPlayed(fx);
    return { played: played, aWin: played && fx.scoreA > fx.scoreB, bWin: played && fx.scoreB > fx.scoreA, draw: played && fx.scoreA === fx.scoreB };
  }

  function allFixtures(league) { return league.matchdays.reduce(function (all, day) { return all.concat(day.fixtures); }, []); }

  /** Sort order: points, then score difference, then score for, then name. */
  function computeStandings(league) {
    const table = new Map(league.participants.map(function (p) {
      return [p.id, { id: p.id, name: p.name, played: 0, won: 0, drawn: 0, lost: 0, scoreFor: 0, scoreAgainst: 0, points: 0, diff: 0 }];
    }));

    allFixtures(league).filter(isPlayed).forEach(function (fx) {
      const a = table.get(fx.a);
      const b = table.get(fx.b);
      a.played++; b.played++;
      a.scoreFor += fx.scoreA; a.scoreAgainst += fx.scoreB;
      b.scoreFor += fx.scoreB; b.scoreAgainst += fx.scoreA;

      if (fx.scoreA > fx.scoreB) { a.won++; b.lost++; a.points += POINTS.win; b.points += POINTS.loss; }
      else if (fx.scoreA < fx.scoreB) { b.won++; a.lost++; b.points += POINTS.win; a.points += POINTS.loss; }
      else { a.drawn++; b.drawn++; a.points += POINTS.draw; b.points += POINTS.draw; }
    });

    const rows = Array.from(table.values());
    rows.forEach(function (row) { row.diff = row.scoreFor - row.scoreAgainst; });
    rows.sort(function (x, y) { return (y.points - x.points) || (y.diff - x.diff) || (y.scoreFor - x.scoreFor) || x.name.localeCompare(y.name); });
    return rows;
  }

  /* ------------------------------------------------------------------------
   * MODEL
   * --------------------------------------------------------------------- */
  function createLeague(teams) {
    const participants = teams.map(function (t) { return { id: t.id, name: t.name }; });
    return { participants: participants, matchdays: buildMatchdays(participants.map(function (p) { return p.id; })), createdAt: Date.now() };
  }

  /* ------------------------------------------------------------------------
   * PUBLIC STATUS API (consumed by the War Room)
   * --------------------------------------------------------------------- */

  /**
   * @param {string} teamId
   * @returns {null|{state:'qualified'|'ondeck', label:string, detail:string}}
   *          null means this team is not part of the current league at all.
   *          Round robin has no elimination, so this never returns 'eliminated'.
   */
  function getStatus(teamId) {
    const league = App.state.league;
    if (!league) return null;
    if (!league.participants.some(function (p) { return p.id === teamId; })) return null;

    const fixtures = allFixtures(league).filter(function (fx) { return fx.a === teamId || fx.b === teamId; });
    const played = fixtures.filter(isPlayed).length;
    if (played === 0) return { state: 'ondeck', label: 'ON DECK', detail: 'Round-robin schedule set — no matches played yet.' };

    const standings = computeStandings(league);
    const row = standings.find(function (r) { return r.id === teamId; });
    const rank = standings.indexOf(row) + 1;
    return { state: 'qualified', label: 'IN CONTENTION', detail: 'Rank ' + rank + ' of ' + standings.length + ' · ' + row.points + ' pts (' + row.won + 'W-' + row.lost + 'L).' };
  }

  /* ------------------------------------------------------------------------
   * RENDERING
   * --------------------------------------------------------------------- */

  function renderStandings() {
    const league = App.state.league;
    const rows = computeStandings(league);
    const anyPlayed = rows.some(function (r) { return r.played > 0; });

    const body = rows.map(function (row, i) {
      const leader = anyPlayed && i === 0;
      const diffClass = row.diff > 0 ? 'diff-pos' : row.diff < 0 ? 'diff-neg' : '';
      const diffText = row.diff > 0 ? '+' + row.diff : String(row.diff);
      return '' +
        '<tr' + (leader ? ' class="is-leader"' : '') + '>' +
          '<td class="col-rank">' + (i + 1) + '</td>' +
          '<td class="col-team">' + esc(row.name) + '</td>' +
          '<td>' + row.played + '</td><td>' + row.won + '</td><td>' + row.lost + '</td>' +
          '<td>' + row.scoreFor + '</td><td>' + row.scoreAgainst + '</td>' +
          '<td class="' + diffClass + '">' + diffText + '</td>' +
          '<td class="col-pts">' + row.points + '</td>' +
        '</tr>';
    }).join('');

    els.standings.innerHTML =
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th>#</th><th class="col-team">Squad</th>' +
          '<th title="Played">P</th><th title="Won">W</th><th title="Lost">L</th>' +
          '<th title="Score for">SF</th><th title="Score against">SA</th><th title="Score difference">Diff</th>' +
          '<th title="Points">Pts</th>' +
        '</tr></thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table>';
  }

  function lookupOf(league) { return new Map(league.participants.map(function (p) { return [p.id, p]; })); }

  function fixtureHtml(fx, lookup) {
    const a = lookup.get(fx.a);
    const b = lookup.get(fx.b);
    const flags = fixtureFlags(fx);
    const valueOf = function (score) { return score === null ? '' : score; };

    return '' +
      '<div class="fixture' + (flags.played ? ' is-played' : '') + '" data-fixture="' + fx.id + '">' +
        '<span class="fx-team fx-team-a' + (flags.aWin ? ' is-win' : '') + '" title="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
        '<div class="fx-score">' +
          '<input class="score-input" type="number" min="0" max="' + MAX_SCORE + '" step="1" inputmode="numeric" data-side="a" value="' + valueOf(fx.scoreA) + '" aria-label="' + esc(a.name) + ' score">' +
          '<span aria-hidden="true">:</span>' +
          '<input class="score-input" type="number" min="0" max="' + MAX_SCORE + '" step="1" inputmode="numeric" data-side="b" value="' + valueOf(fx.scoreB) + '" aria-label="' + esc(b.name) + ' score">' +
        '</div>' +
        '<span class="fx-team fx-team-b' + (flags.bWin ? ' is-win' : '') + '" title="' + esc(b.name) + '">' + esc(b.name) + '</span>' +
      '</div>';
  }

  function renderFixtures() {
    const league = App.state.league;
    const lookup = lookupOf(league);

    els.fixtures.innerHTML = league.matchdays.map(function (day) {
      const rest = day.bye ? '<div class="fixture-bye">Resting: <strong>' + esc(lookup.get(day.bye).name) + '</strong></div>' : '';
      return '' +
        '<div class="panel matchday">' +
          '<div class="matchday-head"><span>Matchday ' + day.number + '</span><span class="hint">' + day.fixtures.length + ' matches</span></div>' +
          day.fixtures.map(function (fx) { return fixtureHtml(fx, lookup); }).join('') +
          rest +
        '</div>';
    }).join('');
  }

  function updateProgress() {
    const fixtures = allFixtures(App.state.league);
    const played = fixtures.filter(isPlayed).length;
    els.progress.textContent = played + ' of ' + fixtures.length + ' matches played';
    els.progress.hidden = false;
  }

  function render() {
    const league = App.state.league;
    const teamCount = App.state.teams.length;

    els.generateBtn.textContent = league ? 'Regenerate schedule' : 'Generate schedule';
    els.clearBtn.disabled = !league;

    if (!league) {
      els.emptyText.textContent = teamCount >= 2
        ? 'You have ' + teamCount + ' squads registered, which makes ' + (teamCount * (teamCount - 1)) / 2 + ' matches. Select Generate schedule to build it.'
        : 'Register at least 2 squads on the Squad Roster tab first.';
      els.empty.hidden = false;
      els.content.hidden = true;
      els.notice.hidden = true;
      els.progress.hidden = true;
      return;
    }

    els.empty.hidden = true;
    els.content.hidden = false;

    const inSync = App.util.sameRoster(league.participants, App.state.teams);
    els.notice.hidden = inSync;
    if (!inSync) els.notice.textContent = 'The squad roster changed since this schedule was generated. Select Regenerate schedule to include the changes — this clears all scores.';

    renderStandings();
    renderFixtures();
    updateProgress();
  }

  /* ------------------------------------------------------------------------
   * EVENT HANDLERS
   * --------------------------------------------------------------------- */

  async function onGenerate() {
    const teams = App.state.teams;
    if (teams.length < 2) {
      App.toast('Register at least 2 squads first.', 'warn');
      App.showTab('roster');
      return;
    }
    if (App.state.league) {
      const ok = await App.confirm({
        title: 'Regenerate the schedule?',
        message: 'The current schedule and every score entered will be replaced.',
        confirmLabel: 'Regenerate',
        danger: true
      });
      if (!ok) return;
    }
    App.state.league = createLeague(teams);
    App.commit('league');
    render();
    App.toast('Schedule deployed: ' + allFixtures(App.state.league).length + ' matches.', 'success');
  }

  async function onClearScores() {
    const league = App.state.league;
    if (!league) return;
    const fixtures = allFixtures(league);
    if (!fixtures.some(function (fx) { return fx.scoreA !== null || fx.scoreB !== null; })) {
      App.toast('There are no scores to clear.', 'info');
      return;
    }
    const ok = await App.confirm({ title: 'Clear all scores?', message: 'The schedule stays the same, but every score is removed.', confirmLabel: 'Clear scores', danger: true });
    if (!ok) return;
    fixtures.forEach(function (fx) { fx.scoreA = null; fx.scoreB = null; });
    App.commit('league');
    render();
  }

  /** A score input lost focus with a changed value. Refresh standings + this card only, so focus/Tab order isn't disturbed. */
  function onScoreChange(event) {
    const input = event.target.closest('.score-input');
    if (!input) return;

    const card = input.closest('[data-fixture]');
    const fx = allFixtures(App.state.league).find(function (f) { return f.id === card.dataset.fixture; });
    if (!fx) return;

    const value = parseScore(input.value);
    if (input.value !== '' && value === null) App.toast('Scores must be whole numbers from 0 to ' + MAX_SCORE + '.', 'warn');
    input.value = value === null ? '' : value;
    if (input.dataset.side === 'a') fx.scoreA = value; else fx.scoreB = value;

    App.save();

    const flags = fixtureFlags(fx);
    card.classList.toggle('is-played', flags.played);
    card.querySelector('.fx-team-a').classList.toggle('is-win', flags.aWin);
    card.querySelector('.fx-team-b').classList.toggle('is-win', flags.bWin);

    renderStandings();
    updateProgress();
  }

  /* ------------------------------------------------------------------------
   * MODULE REGISTRATION
   * --------------------------------------------------------------------- */
  function init() {
    els = {
      generateBtn: $('league-generate-btn'),
      clearBtn: $('league-clear-btn'),
      progress: $('league-progress'),
      notice: $('league-notice'),
      empty: $('league-empty'),
      emptyText: $('league-empty-text'),
      content: $('league-content'),
      standings: $('league-standings'),
      fixtures: $('league-fixtures')
    };

    els.generateBtn.addEventListener('click', onGenerate);
    els.clearBtn.addEventListener('click', onClearScores);
    els.fixtures.addEventListener('change', onScoreChange);
  }

  App.register('league', {
    init: init,
    render: render,
    getStatus: getStatus,
    helpers: { buildMatchdays: buildMatchdays, computeStandings: computeStandings, parseScore: parseScore }
  });
})(window.App);
