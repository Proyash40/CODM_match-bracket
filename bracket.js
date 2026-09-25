/**
 * ============================================================================
 *  MECHTRONICA CODM · TACTICAL COMMAND
 *  bracket.js  -  "Top 8 Tactical Bracket" tab (single elimination)
 * ============================================================================
 *
 *  HOW THE BRACKET IS MODELLED
 *  ---------------------------
 *  We store the MINIMUM needed to rebuild the whole tree, and derive
 *  everything else every time we render:
 *
 *  App.state.bracket = {
 *    size:         8,                        // slots in round 1 (a power of two)
 *    participants: [{ id, name, seed }],     // roster snapshot at generation time
 *    slots:        [id|null, ...],           // length === size, bracket order; null = bye
 *    winners:      { "0-1": teamId, ... },   // ONLY the results a human has clicked
 *    createdAt:    1700000000000
 *  }
 *
 *  Match keys are "<round>-<index>", both zero-based. Match (r, i) is fed by
 *  matches (r-1, 2i) and (r-1, 2i+1); its winner moves into (r+1, floor(i/2)).
 *
 *  Only human clicks are stored, so undoing a result is just deleting a key.
 *  resolve() rebuilds who plays whom from that, and drops any stored winner
 *  that's no longer valid (e.g. an earlier match in the same line changed).
 *
 *  SEEDING AND BYES
 *  -----------------
 *  Squads are seeded in roster order (or shuffled). Bracket size is the next
 *  power of two; the standard seeding pattern (1 v 8, 4 v 5, 2 v 7 ...) keeps
 *  top seeds apart until late rounds. Missing slots become byes, which by
 *  construction always land on the highest seeds.
 * ============================================================================
 */
(function (App) {
  'use strict';

  const esc = App.util.esc;
  const $ = function (id) { return document.getElementById(id); };
  let els = {};

  const ICON_CHECK = '<svg class="team-check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  /* ------------------------------------------------------------------------
   * PURE HELPERS (no DOM, no state)
   * --------------------------------------------------------------------- */

  function nextPowerOfTwo(n) {
    let power = 1;
    while (power < n) power *= 2;
    return power;
  }

  /** Standard tournament seed order, e.g. seedOrder(8) -> [1,8,4,5,2,7,3,6]. */
  function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
      const total = order.length * 2;
      order = order.reduce(function (next, seed) { next.push(seed, total + 1 - seed); return next; }, []);
    }
    return order;
  }

  function roundName(roundIndex, totalRounds, size) {
    const remaining = totalRounds - roundIndex;
    if (remaining === 1) return 'Final';
    if (remaining === 2) return 'Semi-finals';
    if (remaining === 3) return 'Quarter-finals';
    return 'Round of ' + size / Math.pow(2, roundIndex);
  }

  /* ------------------------------------------------------------------------
   * MODEL
   * --------------------------------------------------------------------- */

  function createBracket(teams, shuffle) {
    const ordered = shuffle ? App.util.shuffle(teams) : teams.slice();
    const size = nextPowerOfTwo(ordered.length);
    const participants = ordered.map(function (t, i) { return { id: t.id, name: t.name, seed: i + 1 }; });

    const slots = seedOrder(size).map(function (seed) {
      return seed <= participants.length ? participants[seed - 1].id : null;
    });

    return { size: size, participants: participants, slots: slots, winners: {}, createdAt: Date.now() };
  }

  /**
   * Turn the stored bracket into a full match tree.
   * Returns { rounds, totalRounds, champion, cleared }.
   * Mutates bracket.winners to prune stale results, so it's safe to call
   * after any change.
   */
  function resolve(bracket) {
    const totalRounds = Math.log2(bracket.size);
    const rounds = [];
    let cleared = 0;

    for (let r = 0; r < totalRounds; r++) {
      const matchCount = bracket.size / Math.pow(2, r + 1);
      const round = [];

      for (let i = 0; i < matchCount; i++) {
        const key = r + '-' + i;
        const teamA = r === 0 ? bracket.slots[2 * i] : rounds[r - 1][2 * i].winner;
        const teamB = r === 0 ? bracket.slots[2 * i + 1] : rounds[r - 1][2 * i + 1].winner;
        const isBye = r === 0 && (!teamA || !teamB);

        let winner = null;
        if (isBye) {
          winner = teamA || teamB;
        } else {
          const stored = bracket.winners[key];
          if (stored && (stored === teamA || stored === teamB)) winner = stored;
          else if (stored) { delete bracket.winners[key]; cleared++; }
        }
        round.push({ key: key, round: r, index: i, teamA: teamA, teamB: teamB, winner: winner, isBye: isBye });
      }
      rounds.push(round);
    }

    const champion = rounds[totalRounds - 1][0].winner;
    return { rounds: rounds, totalRounds: totalRounds, champion: champion, cleared: cleared };
  }

  /** A human clicked a team in a match. Clicking the current winner again undoes it. */
  function pickWinner(matchKey, teamId) {
    const bracket = App.state.bracket;
    if (!bracket) return;

    const before = resolve(bracket);
    const match = before.rounds.reduce(function (all, round) { return all.concat(round); }, [])
      .find(function (m) { return m.key === matchKey; });

    if (!match || match.isBye || !match.teamA || !match.teamB) return;
    if (teamId !== match.teamA && teamId !== match.teamB) return;

    if (bracket.winners[matchKey] === teamId) delete bracket.winners[matchKey];
    else bracket.winners[matchKey] = teamId;

    const after = resolve(bracket);
    App.commit('bracket');
    render();

    if (after.cleared > 0) App.toast('Later results in this line were reset.', 'info', 4000);
    if (after.champion && after.champion !== before.champion) {
      const champ = bracket.participants.find(function (p) { return p.id === after.champion; });
      App.toast('CHAMPION CONFIRMED: ' + champ.name, 'success', 5000);
    }
  }

  /* ------------------------------------------------------------------------
   * PUBLIC STATUS API (consumed by the War Room)
   * --------------------------------------------------------------------- */

  /**
   * @param {string} teamId
   * @returns {null|{state:'qualified'|'eliminated'|'ondeck', label:string, detail:string}}
   *          null means this team is not part of the current bracket at all.
   */
  function getStatus(teamId) {
    const bracket = App.state.bracket;
    if (!bracket) return null;
    if (!bracket.participants.some(function (p) { return p.id === teamId; })) return null;

    const model = resolve(bracket);
    const flat = model.rounds.reduce(function (all, round) { return all.concat(round); }, []);

    if (model.champion === teamId) {
      return { state: 'qualified', label: 'CHAMPION', detail: 'Won the Top 8 bracket.' };
    }

    const lostMatch = flat.find(function (m) {
      return !m.isBye && m.winner && (m.teamA === teamId || m.teamB === teamId) && m.winner !== teamId;
    });
    if (lostMatch) {
      const opponent = bracket.participants.find(function (p) { return p.id === lostMatch.winner; });
      return { state: 'eliminated', label: 'ELIMINATED', detail: 'Lost to ' + (opponent ? opponent.name : 'opponent') + ' in the ' + roundName(lostMatch.round, model.totalRounds, bracket.size) + '.' };
    }

    const currentMatch = flat.find(function (m) { return !m.winner && (m.teamA === teamId || m.teamB === teamId); });
    if (currentMatch) {
      const opponentId = currentMatch.teamA === teamId ? currentMatch.teamB : currentMatch.teamA;
      const label = roundName(currentMatch.round, model.totalRounds, bracket.size);
      if (!opponentId) return { state: 'ondeck', label: 'ON DECK', detail: 'Awaiting a confirmed opponent in the ' + label + '.' };
      const opponent = bracket.participants.find(function (p) { return p.id === opponentId; });
      return { state: 'ondeck', label: 'ON DECK', detail: 'Next up: vs ' + (opponent ? opponent.name : '?') + ' in the ' + label + '.' };
    }

    // Won every match played so far but the next round hasn't been populated yet.
    return { state: 'qualified', label: 'QUALIFIED', detail: 'Advancing — awaiting the next round.' };
  }

  /* ------------------------------------------------------------------------
   * RENDERING
   * --------------------------------------------------------------------- */

  function teamRowHtml(match, teamId, lookup) {
    if (!teamId) {
      return '<div class="team-row is-empty"><span class="team-seed">–</span><span class="team-label">' + (match.isBye ? 'BYE' : 'TBD') + '</span></div>';
    }

    const team = lookup.get(teamId);
    const decided = !!match.winner;
    const isWinner = decided && match.winner === teamId;
    const isLoser = decided && !isWinner;
    const canPick = !match.isBye && !!match.teamA && !!match.teamB;

    const classes = ['team-row'];
    if (isWinner) classes.push('is-winner');
    if (isLoser) classes.push('is-loser');
    if (canPick) classes.push('is-clickable');

    let title = '';
    if (canPick) title = isWinner ? 'Click to overturn this result' : 'Click to advance ' + team.name;

    return '' +
      '<button type="button" class="' + classes.join(' ') + '"' +
        ' data-match="' + match.key + '" data-team="' + teamId + '"' +
        ' aria-pressed="' + isWinner + '"' +
        (title ? ' title="' + esc(title) + '"' : '') +
        (canPick ? '' : ' disabled tabindex="-1"') + '>' +
        '<span class="team-seed">' + team.seed + '</span>' +
        '<span class="team-label">' + esc(team.name) + '</span>' +
        (isWinner ? ICON_CHECK : '') +
      '</button>';
  }

  function slotHtml(match, totalRounds, lookup) {
    const hasNext = match.round < totalRounds - 1;
    const hasPrev = match.round > 0;

    const classes = ['bracket-slot'];
    if (hasNext) classes.push('has-next', match.index % 2 === 0 ? 'is-top' : 'is-bottom');
    if (hasPrev) classes.push('has-prev');
    if (hasPrev && match.teamA && match.teamB) classes.push('has-both');
    if (match.winner) classes.push('is-decided');

    return '' +
      '<div class="' + classes.join(' ') + '">' +
        '<div class="match-card' + (match.isBye ? ' is-bye' : '') + '">' +
          '<div class="match-card-tag">DOSSIER · MATCH ' + App.util.pad2(match.index + 1) + '</div>' +
          teamRowHtml(match, match.teamA, lookup) +
          teamRowHtml(match, match.teamB, lookup) +
        '</div>' +
        (hasNext ? '<span class="conn-v" aria-hidden="true"></span>' : '') +
      '</div>';
  }

  function render() {
    const bracket = App.state.bracket;
    const teamCount = App.state.teams.length;

    els.generateBtn.textContent = bracket ? 'Regenerate bracket' : 'Generate bracket';
    els.clearBtn.disabled = !bracket;

    if (!bracket) {
      els.emptyText.textContent = teamCount >= 2
        ? 'You have ' + teamCount + ' squads registered. Select Generate bracket to seed the knockout tree.'
        : 'Register at least 2 squads on the Squad Roster tab first.';
      els.empty.hidden = false;
      els.scroll.hidden = true;
      els.champion.hidden = true;
      els.notice.hidden = true;
      els.progress.hidden = true;
      return;
    }

    const model = resolve(bracket);
    const lookup = new Map(bracket.participants.map(function (p) { return [p.id, p]; }));

    els.empty.hidden = true;
    els.scroll.hidden = false;

    const inSync = App.util.sameRoster(bracket.participants, App.state.teams);
    els.notice.hidden = inSync;
    if (!inSync) els.notice.textContent = 'The squad roster changed since this bracket was generated. Select Regenerate bracket to include the changes — this clears all results.';

    const playable = model.rounds.reduce(function (all, round) { return all.concat(round); }, []).filter(function (m) { return !m.isBye; });
    const played = playable.filter(function (m) { return m.winner; }).length;
    els.progress.textContent = played + ' of ' + playable.length + ' matches decided';
    els.progress.hidden = false;

    if (model.champion) {
      els.champion.hidden = false;
      els.champion.innerHTML =
        '<div class="champion-banner">' +
          '<span class="champion-trophy" aria-hidden="true">🏆</span>' +
          '<div><p class="champion-label">Tournament champion</p>' +
          '<p class="champion-name">' + esc(lookup.get(model.champion).name) + '</p></div>' +
        '</div>';
    } else {
      els.champion.hidden = true;
      els.champion.innerHTML = '';
    }

    els.tree.innerHTML = model.rounds.map(function (round, r) {
      return '' +
        '<div class="bracket-round">' +
          '<div class="bracket-round-title">' + roundName(r, model.totalRounds, bracket.size) + '</div>' +
          '<div class="bracket-round-body">' + round.map(function (m) { return slotHtml(m, model.totalRounds, lookup); }).join('') + '</div>' +
        '</div>';
    }).join('');
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
    if (App.state.bracket) {
      const ok = await App.confirm({
        title: 'Regenerate the bracket?',
        message: 'The current bracket and every result entered will be replaced.',
        confirmLabel: 'Regenerate',
        danger: true
      });
      if (!ok) return;
    }
    App.state.bracket = createBracket(teams, els.shuffle.checked);
    App.commit('bracket');
    render();
    App.toast('Bracket deployed: ' + teams.length + ' squads.', 'success');
  }

  async function onClearResults() {
    const bracket = App.state.bracket;
    if (!bracket || Object.keys(bracket.winners).length === 0) {
      App.toast('There are no results to clear.', 'info');
      return;
    }
    const ok = await App.confirm({
      title: 'Clear all results?',
      message: 'Seeding stays the same, but every match goes back to undecided.',
      confirmLabel: 'Clear results',
      danger: true
    });
    if (!ok) return;
    bracket.winners = {};
    App.commit('bracket');
    render();
  }

  function onTreeClick(event) {
    const row = event.target.closest('button.team-row[data-match]');
    if (row) pickWinner(row.dataset.match, row.dataset.team);
  }

  /* ------------------------------------------------------------------------
   * MODULE REGISTRATION
   * --------------------------------------------------------------------- */
  function init() {
    els = {
      generateBtn: $('bracket-generate-btn'),
      clearBtn: $('bracket-clear-btn'),
      shuffle: $('bracket-shuffle'),
      progress: $('bracket-progress'),
      notice: $('bracket-notice'),
      champion: $('bracket-champion'),
      empty: $('bracket-empty'),
      emptyText: $('bracket-empty-text'),
      scroll: $('bracket-scroll'),
      tree: $('bracket-tree')
    };

    els.generateBtn.addEventListener('click', onGenerate);
    els.clearBtn.addEventListener('click', onClearResults);
    els.tree.addEventListener('click', onTreeClick);
  }

  App.register('bracket', {
    init: init,
    render: render,
    getStatus: getStatus,
    helpers: { nextPowerOfTwo: nextPowerOfTwo, seedOrder: seedOrder, createBracket: createBracket, resolve: resolve, roundName: roundName }
  });
})(window.App);
