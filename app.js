/* ═══════════════════════════════════════════════════════════
   PONG GOU – APP LOGIC
   Vanilla JS  ·  localStorage persistence  ·  2-table tournament
   ═══════════════════════════════════════════════════════════ */

// ──────────────────────────── CONSTANTS ────────────────────────────
const STORAGE_KEYS = {
  players:  'pongGou_players',
  tables:   'pongGou_tables',
  queue:    'pongGou_queue',
  matches:  'pongGou_matches',
  settings: 'pongGou_settings',
};

// ──────────────────────────── STATE ────────────────────────────
let state = {};

// ──────────────────────────── PERSISTENCE ────────────────────────────

function loadState() {
  return {
    players:  JSON.parse(localStorage.getItem(STORAGE_KEYS.players)  || '[]'),
    tables:   JSON.parse(localStorage.getItem(STORAGE_KEYS.tables)   || '[]'),
    queue:    JSON.parse(localStorage.getItem(STORAGE_KEYS.queue)    || '[]'),
    matches:  JSON.parse(localStorage.getItem(STORAGE_KEYS.matches)  || '[]'),
    settings: JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{"modo":"solo","sessionActive":false}'),
  };
}

function saveState(s) {
  localStorage.setItem(STORAGE_KEYS.players,  JSON.stringify(s.players));
  localStorage.setItem(STORAGE_KEYS.tables,   JSON.stringify(s.tables));
  localStorage.setItem(STORAGE_KEYS.queue,    JSON.stringify(s.queue));
  localStorage.setItem(STORAGE_KEYS.matches,  JSON.stringify(s.matches));
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s.settings));
}

function initStateIfEmpty() {
  state = loadState();
  if (state.tables.length === 0) {
    state.tables = [
      { id: 1, modo: state.settings.modo, ladoA: { playerIds: [], score: 0 }, ladoB: { playerIds: [], score: 0 } },
      { id: 2, modo: state.settings.modo, ladoA: { playerIds: [], score: 0 }, ladoB: { playerIds: [], score: 0 } },
    ];
    saveState(state);
  }
}

// Ensure settings has showRanking flag when loading older state
function ensureSettingsDefaults() {
  state.settings = state.settings || {};
  if (typeof state.settings.modo === 'undefined') state.settings.modo = 'solo';
  if (typeof state.settings.sessionActive === 'undefined') state.settings.sessionActive = false;
  if (typeof state.settings.showRanking === 'undefined') state.settings.showRanking = false;
}

// Remove a player safely from queue/tables and players list
function removePlayer(playerId) {
  if (!confirm('¿Eliminar jugador? Esta acción quitará al jugador de la cola y/o mesa actual.')) return;

  // First check tables for presence
  for (const table of state.tables) {
    for (const sideName of ['ladoA', 'ladoB']) {
      const side = table[sideName];
      if (!side.playerIds || side.playerIds.length === 0) continue;
      if (side.playerIds.includes(playerId)) {
        // If this is the only player/team on that side, treat as forfeit -> opponent wins
        if (side.playerIds.length === 1) {
          // Process forfeit before removing player record so stats and match include them
          processForfeit(table.id, sideName === 'ladoA' ? 'A' : 'B', playerId);
          // After processing forfeit, remove player from master list and queue
          removeFromAllQueues(playerId);
          state.players = state.players.filter(p => p.id !== playerId);
          saveState(state);
          render(state);
          showToast('Jugador eliminado y la mesa procesó la salida.', 'warning');
          return;
        } else {
          // Team has other members (duo), just remove member from team
          side.playerIds = side.playerIds.filter(id => id !== playerId);
          // Remove from player master list and any queue entries
          removeFromAllQueues(playerId);
          state.players = state.players.filter(p => p.id !== playerId);
          saveState(state);
          render(state);
          showToast('Jugador eliminado de la mesa.', 'warning');
          return;
        }
      }
    }
  }

  // Not found on table(s) — remove from queue if present
  const removedFromQueue = removeFromAllQueues(playerId);

  // Remove from master players list
  const existed = state.players.some(p => p.id === playerId);
  state.players = state.players.filter(p => p.id !== playerId);

  saveState(state);
  render(state);
  if (existed || removedFromQueue) showToast('Jugador eliminado.', 'warning');
}

function removeFromAllQueues(playerId) {
  let removed = false;
  const newQueue = [];
  for (const entry of state.queue) {
    if (Array.isArray(entry)) {
      const filtered = entry.filter(id => id !== playerId);
      if (filtered.length > 0) {
        newQueue.push(filtered);
      } else {
        removed = true;
      }
    } else {
      if (entry === playerId) {
        removed = true;
      } else {
        newQueue.push(entry);
      }
    }
  }
  state.queue = newQueue;
  return removed;
}

// Process a forfeit when a side becomes empty due to removal
function processForfeit(tableId, loserSideLetter, removedPlayerId) {
  const table = state.tables.find(t => t.id === tableId);
  if (!table) return;

  const loserSide = loserSideLetter === 'A' ? table.ladoA : table.ladoB;
  const winnerSide = loserSideLetter === 'A' ? table.ladoB : table.ladoA;

  const loserPlayerIds = [...loserSide.playerIds];
  const winnerPlayerIds = [...winnerSide.playerIds];

  const scoreFinalA = table.ladoA.score;
  const scoreFinalB = table.ladoB.score;

  const ganadorLado = loserSideLetter === 'A' ? 'B' : 'A';

  const match = {
    id: state.matches.length + 1,
    tableId,
    modo: table.modo,
    ladoAPlayerIds: [...table.ladoA.playerIds],
    ladoBPlayerIds: [...table.ladoB.playerIds],
    ganadorLado,
    scoreFinalA,
    scoreFinalB,
    fecha: new Date().toISOString(),
  };

  state.matches.push(match);

  // Update stats for winners and losers (if they still exist in players list)
  winnerPlayerIds.forEach(id => {
    const p = state.players.find(pl => pl.id === id);
    if (p) p.victorias++;
  });
  loserPlayerIds.forEach(id => {
    const p = state.players.find(pl => pl.id === id);
    if (p) p.derrotas++;
  });

  // Rotation: do NOT re-add removed players to the queue. Fill loser side from queue.
  if (table.modo === 'solo') {
    if (state.queue.length > 0) {
      const nextId = state.queue.shift();
      loserSide.playerIds = [nextId];
    } else {
      loserSide.playerIds = [];
    }
  } else {
    if (state.queue.length > 0) {
      const nextPair = state.queue.shift();
      loserSide.playerIds = Array.isArray(nextPair) ? nextPair : [nextPair];
    } else {
      loserSide.playerIds = [];
    }
  }

  // Reset scores
  table.ladoA.score = 0;
  table.ladoB.score = 0;

  saveState(state);

  const winnerNames = getPlayerNames(winnerPlayerIds);
  showWinnerOverlay(`Mesa ${tableId}: ¡Ganó ${winnerNames} (por abandono)!`, `${getPlayerNames(match.ladoAPlayerIds)} ${scoreFinalA} – ${scoreFinalB} ${getPlayerNames(match.ladoBPlayerIds)}`);

  render(state);
}

// ──────────────────────────── SCORING ────────────────────────────

/**
 * Check if there's a winner.
 * @returns 0 = no winner, 1 = side A wins, 2 = side B wins
 */
function checkWinner(scoreA, scoreB) {
  // Blanqueo (shutout) at 4-0
  if (scoreA === 4 && scoreB === 0) return 1;
  if (scoreB === 4 && scoreA === 0) return 2;

  // Deuce situation: both sides at least 6, need 2-point gap
  if (scoreA >= 6 && scoreB >= 6) {
    if (scoreA - scoreB >= 2) return 1;
    if (scoreB - scoreA >= 2) return 2;
    // no winner yet, continue deuce
    return 0;
  }

  // Normal win: first to 7 (covers 7-0..7-5, and any 8+ when not deuce)
  if (scoreA >= 7) return 1;
  if (scoreB >= 7) return 2;

  return 0;
}

// ──────────────────────────── PLAYER MANAGEMENT ────────────────────────────

function getNextPlayerId() {
  if (state.players.length === 0) return 1;
  return Math.max(...state.players.map(p => p.id)) + 1;
}

function addPlayer(nombre) {
  nombre = nombre.trim();
  if (!nombre) { showToast('Ingresa un nombre válido', 'warning'); return; }
  if (state.players.some(p => p.nombre.toLowerCase() === nombre.toLowerCase())) {
    showToast(`"${nombre}" ya existe`, 'warning');
    return;
  }

  const player = { id: getNextPlayerId(), nombre, victorias: 0, derrotas: 0 };
  state.players.push(player);

  // Auto-add to queue if session not yet started
  // In queue: solo mode stores playerIds, duo mode stores arrays of 2 ids
  if (state.settings.modo === 'solo') {
    state.queue.push(player.id);
  }
  // In duo mode players are also added individually; they get paired when session starts
  if (state.settings.modo === 'duo') {
    state.queue.push(player.id);
  }

  saveState(state);
  render(state);
  showToast(`Jugador "${nombre}" añadido a la cola`, 'success');
}

function getPlayerName(id) {
  const p = state.players.find(p => p.id === id);
  return p ? p.nombre : '?';
}

function getPlayerNames(ids) {
  return ids.map(getPlayerName).join(' & ');
}

// ──────────────────────────── SESSION ────────────────────────────

function startSession(modo) {
  const minPlayers = modo === 'solo' ? 4 : 8;
  if (state.players.length < minPlayers) {
    showToast(`Necesitas al menos ${minPlayers} jugadores para modo ${modo === 'solo' ? 'Solo' : 'Dúo'}`, 'error');
    return;
  }

  state.settings.modo = modo;
  state.settings.sessionActive = true;

  // Build ordered list of all player IDs
  const allIds = state.players.map(p => p.id);

  if (modo === 'solo') {
    // 2 per table = 4 initial, rest queued
    state.tables = [
      { id: 1, modo, ladoA: { playerIds: [allIds[0]], score: 0 }, ladoB: { playerIds: [allIds[1]], score: 0 } },
      { id: 2, modo, ladoA: { playerIds: [allIds[2]], score: 0 }, ladoB: { playerIds: [allIds[3]], score: 0 } },
    ];
    state.queue = allIds.slice(4); // remaining as individual IDs
  } else {
    // Duo: pair up — 2 pairs per table = 8 initial
    // queue stores arrays of [id1, id2]
    const pairs = [];
    for (let i = 0; i < allIds.length; i += 2) {
      if (i + 1 < allIds.length) {
        pairs.push([allIds[i], allIds[i + 1]]);
      } else {
        // Odd player — can't pair, will wait
        pairs.push([allIds[i]]);
      }
    }

    state.tables = [
      { id: 1, modo, ladoA: { playerIds: pairs[0], score: 0 }, ladoB: { playerIds: pairs[1], score: 0 } },
      { id: 2, modo, ladoA: { playerIds: pairs[2], score: 0 }, ladoB: { playerIds: pairs[3], score: 0 } },
    ];
    state.queue = pairs.slice(4); // remaining pairs
  }

  saveState(state);
  render(state);
  showToast(`¡Sesión iniciada en modo ${modo === 'solo' ? 'Solo' : 'Dúo'}!`, 'success');
}

// ──────────────────────────── SCORING / ROUND ────────────────────────────

function addPoint(tableId, lado) {
  const table = state.tables.find(t => t.id === tableId);
  if (!table) return;

  // Prevent scoring when table has no players
  const side = lado === 'A' ? table.ladoA : table.ladoB;
  if (!side.playerIds || side.playerIds.length === 0) return;

  // if we are just entering deuce (6-6), initialize serve turn
  if (table.ladoA.score === 6 && table.ladoB.score === 6) {
    table.turnoSaque = true; // A serves first
  }

  // Increment score normally
  if (lado === 'A') table.ladoA.score = table.ladoA.score + 1;
  else table.ladoB.score = table.ladoB.score + 1;

  // handle 4-0 'blanqueado' message: show once when entering 4-0
  const isBlanqueoA = table.ladoA.score === 4 && table.ladoB.score === 0;
  const isBlanqueoB = table.ladoB.score === 4 && table.ladoA.score === 0;
  if (!(isBlanqueoA || isBlanqueoB)) {
    // reset flag when not in blanqueo state
    table.blanqueoShown = false;
  }
  if ((isBlanqueoA || isBlanqueoB) && !table.blanqueoShown) {
    showToast('blanqueado, sos re malo', 'warning');
    table.blanqueoShown = true;
  }

  // after scoring, if deuce state (both >=6) flip serve turn for next rally
  if (table.ladoA.score >= 6 && table.ladoB.score >= 6) {
    table.turnoSaque = !table.turnoSaque;
  }

  saveState(state);

  // Animate the score bump
  const scoreEl = document.querySelector(`#table-${tableId} .side-${lado.toLowerCase()} .score-display`);
  if (scoreEl) {
    scoreEl.classList.remove('bump');
    void scoreEl.offsetWidth; // reflow
    scoreEl.classList.add('bump');
  }

  const winner = checkWinner(table.ladoA.score, table.ladoB.score);
  if (winner !== 0) {
    const ganadorLado = winner === 1 ? 'A' : 'B';
    // Short delay so user sees the final score
    setTimeout(() => processRoundEnd(tableId, ganadorLado));
  }

  render(state);
}

function processRoundEnd(tableId, ganadorLado) {
  const table = state.tables.find(t => t.id === tableId);
  if (!table) return;

  const winnerSide = ganadorLado === 'A' ? table.ladoA : table.ladoB;
  const loserSide  = ganadorLado === 'A' ? table.ladoB : table.ladoA;

  const winnerPlayerIds = [...winnerSide.playerIds];
  const loserPlayerIds  = [...loserSide.playerIds];

  const scoreFinalA = table.ladoA.score;
  const scoreFinalB = table.ladoB.score;

  // Record match
  const match = {
    id: state.matches.length + 1,
    tableId,
    modo: table.modo,
    ladoAPlayerIds: [...table.ladoA.playerIds],
    ladoBPlayerIds: [...table.ladoB.playerIds],
    ganadorLado,
    scoreFinalA,
    scoreFinalB,
    fecha: new Date().toISOString(),
  };
  state.matches.push(match);

  // Update player stats
  winnerPlayerIds.forEach(id => {
    const p = state.players.find(pl => pl.id === id);
    if (p) p.victorias++;
  });
  loserPlayerIds.forEach(id => {
    const p = state.players.find(pl => pl.id === id);
    if (p) p.derrotas++;
  });

  // Rotation: loser → bottom of queue, winner stays, next from queue enters
  if (table.modo === 'solo') {
    // Push the loser back to queue
    loserPlayerIds.forEach(id => state.queue.push(id));
    // Pull next from queue for the loser's spot
    if (state.queue.length > 0) {
      const nextId = state.queue.shift();
      loserSide.playerIds = [nextId];
    } else {
      loserSide.playerIds = [...loserPlayerIds]; // no one in queue — stay
    }
  } else {
    // Duo: push loser pair, pull next pair
    state.queue.push(loserPlayerIds);
    if (state.queue.length > 0) {
      const nextPair = state.queue.shift();
      loserSide.playerIds = Array.isArray(nextPair) ? nextPair : [nextPair];
    } else {
      loserSide.playerIds = loserPlayerIds;
    }
  }

  // Reset scores
  table.ladoA.score = 0;
  table.ladoB.score = 0;

  saveState(state);

  // Show winner overlay
  const winnerNames = getPlayerNames(winnerPlayerIds);
  const loserNames  = getPlayerNames(loserPlayerIds);
  showWinnerOverlay(
    `Mesa ${tableId}: ¡Ganó ${winnerNames}!`,
    `${getPlayerNames(match.ladoAPlayerIds)} ${scoreFinalA} – ${scoreFinalB} ${getPlayerNames(match.ladoBPlayerIds)}`
  );

  render(state);
}

// ──────────────────────────── RESET ────────────────────────────

function resetAll() {
  Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
  showToast('Datos reiniciados', 'warning');
  setTimeout(() => location.reload(), 600);
}

// ──────────────────────────── RENDERING ────────────────────────────

function render(s) {
  renderTables(s);
  renderQueue(s);
  renderRanking(s);
  updateControlStates(s);
}

// Ranking modal controls
function showRankingModal() {
  const modal = document.getElementById('ranking-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  state.settings.showRanking = true;
  saveState(state);
  updateControlStates(state);
}

function hideRankingModal() {
  const modal = document.getElementById('ranking-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  state.settings.showRanking = false;
  saveState(state);
  updateControlStates(state);
}

function renderTables(s) {
  const container = document.getElementById('tables-container');
  const emptyEl   = document.getElementById('tables-empty');

  const hasSides = s.tables.some(t => (t.ladoA.playerIds && t.ladoA.playerIds.length > 0) || (t.ladoB.playerIds && t.ladoB.playerIds.length > 0));
  emptyEl.classList.toggle('hidden', hasSides);

  // Remove old table cards
  container.querySelectorAll('.table-card').forEach(el => el.remove());

  if (!hasSides) return;

  s.tables.forEach(table => {
    if ((table.ladoA.playerIds.length === 0) && (table.ladoB.playerIds.length === 0)) return;

    const card = document.createElement('div');
    card.className = 'table-card';
    card.id = `table-${table.id}`;

    const header = document.createElement('div');
    header.className = 'table-card-header';
    header.innerHTML = `<h3>Mesa ${table.id}</h3><span class="table-mode-badge">${table.modo === 'solo' ? 'Solo' : 'Dúo'}</span>`;

    const scoreArea = document.createElement('div');
    scoreArea.className = 'score-area';

    // Side A
    const sideA = document.createElement('div');
    sideA.className = 'side-block side-a';
    const labelA = document.createElement('div'); labelA.className = 'side-label'; labelA.textContent = 'Lado A';
    const playersA = document.createElement('div'); playersA.className = 'side-players';
    (table.ladoA.playerIds || []).forEach(pid => {
      const wrap = document.createElement('span'); wrap.className = 'player-inline';
      const name = document.createElement('span'); name.className = 'player-name'; name.textContent = getPlayerName(pid);
      const del = document.createElement('button'); del.className = 'btn btn-danger btn-small'; del.title = 'Eliminar jugador'; del.textContent = '✖';
      del.addEventListener('click', (e) => { e.stopPropagation(); removePlayer(pid); });
      wrap.appendChild(name); wrap.appendChild(del);
      playersA.appendChild(wrap);
    });
    const scoreA = document.createElement('div'); scoreA.className = 'score-display'; scoreA.textContent = table.ladoA.score;
    const btnA = document.createElement('button'); btnA.className = 'btn-score'; btnA.dataset.table = table.id; btnA.dataset.side = 'A'; btnA.textContent = '+1';

    sideA.appendChild(labelA);
    sideA.appendChild(playersA);
    sideA.appendChild(scoreA);
    sideA.appendChild(btnA);

    // Side B
    const sideB = document.createElement('div');
    sideB.className = 'side-block side-b';
    const labelB = document.createElement('div'); labelB.className = 'side-label'; labelB.textContent = 'Lado B';
    const playersB = document.createElement('div'); playersB.className = 'side-players';
    (table.ladoB.playerIds || []).forEach(pid => {
      const wrap = document.createElement('span'); wrap.className = 'player-inline';
      const name = document.createElement('span'); name.className = 'player-name'; name.textContent = getPlayerName(pid);
      const del = document.createElement('button'); del.className = 'btn btn-danger btn-small'; del.title = 'Eliminar jugador'; del.textContent = '✖';
      del.addEventListener('click', (e) => { e.stopPropagation(); removePlayer(pid); });
      wrap.appendChild(name); wrap.appendChild(del);
      playersB.appendChild(wrap);
    });
    const scoreB = document.createElement('div'); scoreB.className = 'score-display'; scoreB.textContent = table.ladoB.score;
    const btnB = document.createElement('button'); btnB.className = 'btn-score'; btnB.dataset.table = table.id; btnB.dataset.side = 'B'; btnB.textContent = '+1';

    sideB.appendChild(labelB);
    sideB.appendChild(playersB);
    sideB.appendChild(scoreB);
    sideB.appendChild(btnB);

    const vs = document.createElement('div'); vs.className = 'score-vs'; vs.textContent = 'VS';

    scoreArea.appendChild(sideA);
    scoreArea.appendChild(vs);
    scoreArea.appendChild(sideB);

    // reset flag if we leave deuce territory (not tied ≥6)
    if (!(table.ladoA.score === table.ladoB.score && table.ladoA.score >= 6)) {
      table.deuceShown = false;
    }

    // only show the badge the first time we *enter* deuce
    if (table.ladoA.score === table.ladoB.score && table.ladoA.score >= 6 && !table.deuceShown) {
      const deuceBadge = document.createElement('div');
      deuceBadge.className = 'deuce-label';
      deuceBadge.textContent = 'deuce';
      scoreArea.appendChild(deuceBadge);
      table.deuceShown = true;
    }

    card.appendChild(header);
    card.appendChild(scoreArea);

    container.appendChild(card);
  });

  // Attach score button listeners
  container.querySelectorAll('.btn-score').forEach(btn => {
    btn.addEventListener('click', () => {
      addPoint(Number(btn.dataset.table), btn.dataset.side);
    });
  });
}

function renderQueue(s) {
  const list    = document.getElementById('queue-list');
  const emptyEl = document.getElementById('queue-empty');

  list.innerHTML = '';

  const entries = s.queue;
  emptyEl.classList.toggle('hidden', entries.length > 0);

  entries.forEach((entry, i) => {
    const li = document.createElement('li');
    li.style.animationDelay = `${i * 0.05}s`;

    const pos = document.createElement('span'); pos.className = 'queue-pos'; pos.textContent = (i + 1);
    li.appendChild(pos);

    const namesWrap = document.createElement('span'); namesWrap.className = 'queue-name';

    if (Array.isArray(entry)) {
      // render each member with delete button
      entry.forEach(pid => {
        const pspan = document.createElement('span'); pspan.className = 'player-inline';
        const name = document.createElement('span'); name.className = 'player-name'; name.textContent = getPlayerName(pid);
        const del = document.createElement('button'); del.className = 'btn btn-danger btn-small'; del.title = 'Eliminar jugador'; del.textContent = '✖';
        del.addEventListener('click', (e) => { e.stopPropagation(); removePlayer(pid); });
        pspan.appendChild(name); pspan.appendChild(del);
        namesWrap.appendChild(pspan);
      });
    } else {
      const pspan = document.createElement('span'); pspan.className = 'player-inline';
      const name = document.createElement('span'); name.className = 'player-name'; name.textContent = getPlayerName(entry);
      const del = document.createElement('button'); del.className = 'btn btn-danger btn-small'; del.title = 'Eliminar jugador'; del.textContent = '✖';
      del.addEventListener('click', (e) => { e.stopPropagation(); removePlayer(entry); });
      pspan.appendChild(name); pspan.appendChild(del);
      namesWrap.appendChild(pspan);
    }

    li.appendChild(namesWrap);
    list.appendChild(li);
  });
}

function renderRanking(s) {
  const container = document.getElementById('ranking-list');
  const emptyEl   = document.getElementById('ranking-empty');

  container.innerHTML = '';
  emptyEl.classList.toggle('hidden', s.players.length > 0);

  const sorted = [...s.players].sort((a, b) => {
    if (b.victorias !== a.victorias) return b.victorias - a.victorias;
    return a.derrotas - b.derrotas;
  });

  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    if (i === 0) row.classList.add('top-1');
    if (i === 1) row.classList.add('top-2');
    if (i === 2) row.classList.add('top-3');
    row.style.animationDelay = `${i * 0.04}s`;

    const medals = ['🥇', '🥈', '🥉'];
    const posDisplay = i < 3 ? medals[i] : `${i + 1}`;

    row.innerHTML = `
      <span class="rank-pos">${posDisplay}</span>
      <span class="rank-name">${p.nombre}</span>
      <span class="rank-stats">
        <span class="rank-wins">${p.victorias}W</span> /
        <span class="rank-losses">${p.derrotas}L</span>
      </span>
    `;
    container.appendChild(row);
  });
}

function updateControlStates(s) {
  const startBtn = document.getElementById('start-session-btn');
  const modo = s.settings.modo;
  const minPlayers = modo === 'solo' ? 4 : 8;
  const enoughPlayers = s.players.length >= minPlayers;

  startBtn.disabled = !enoughPlayers || s.settings.sessionActive;

  if (s.settings.sessionActive) {
    startBtn.textContent = '⏸ Sesión en curso';
  } else {
    startBtn.textContent = enoughPlayers
      ? '▶ Empezar Sesión'
      : `▶ Faltan ${minPlayers - s.players.length} jugadores`;
  }

  // Mode toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === s.settings.modo);
    btn.disabled = s.settings.sessionActive;
  });

  // Ranking toggle button
  const rankBtn = document.getElementById('toggle-ranking-btn');
  if (rankBtn) {
    rankBtn.textContent = s.settings.showRanking ? '🏆 Ocultar Ranking' : '🏆 Mostrar Ranking';
    rankBtn.classList.toggle('active', s.settings.showRanking);
  }
}

// ──────────────────────────── TOASTS ────────────────────────────

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 2800);
}

// ──────────────────────────── WINNER OVERLAY ────────────────────────────

function showWinnerOverlay(title, detail) {
  const overlay = document.getElementById('winner-overlay');
  document.getElementById('winner-title').textContent = title;
  document.getElementById('winner-detail').textContent = detail;
  overlay.classList.remove('hidden');
}

function hideWinnerOverlay() {
  document.getElementById('winner-overlay').classList.add('hidden');
}

// ──────────────────────────── EVENT LISTENERS ────────────────────────────

function initApp() {
  initStateIfEmpty();
  ensureSettingsDefaults();

  // Persist any new defaults
  saveState(state);

  // Add player
  document.getElementById('add-player-btn').addEventListener('click', () => {
    const input = document.getElementById('player-name-input');
    addPlayer(input.value);
    input.value = '';
    input.focus();
  });

  document.getElementById('player-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-player-btn').click();
    }
  });

  // Mode toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.settings.sessionActive) return;
      state.settings.modo = btn.dataset.mode;
      saveState(state);
      render(state);
    });
  });

  // Start session
  document.getElementById('start-session-btn').addEventListener('click', () => {
    startSession(state.settings.modo);
  });

  // Toggle ranking visibility
  const toggleRankBtn = document.getElementById('toggle-ranking-btn');
  if (toggleRankBtn) {
    toggleRankBtn.addEventListener('click', () => {
      if (state.settings.showRanking) hideRankingModal();
      else showRankingModal();
    });
  }

  // Reset
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('¿Reiniciar todos los datos? Esta acción no se puede deshacer.')) {
      resetAll();
    }
  });

  // Winner overlay OK
  document.getElementById('winner-ok-btn').addEventListener('click', hideWinnerOverlay);

  // Ranking modal close
  const rankClose = document.getElementById('ranking-close-btn');
  if (rankClose) rankClose.addEventListener('click', hideRankingModal);

  // If saved state had ranking open, show it
  if (state.settings.showRanking) showRankingModal();

  // First render
  render(state);
}

// ──────────────────────────── BOOT ────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);
