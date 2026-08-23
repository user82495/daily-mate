/*
 * board.js — SVG/DOM chess board renderer and input handler.
 *
 * Knows nothing about chess rules. It renders a position, animates moves it is
 * told to make, and reports move *intents* to its owner. Legality comes from a
 * `legalMoves(square)` callback supplied by the game layer.
 *
 * Pieces are absolutely-positioned elements moved with CSS transforms, which
 * makes animation a transition rather than a re-render.
 */

import { pieceSVG, PIECE_NAMES, installPieceSprite } from './pieces.js';

const FILES = 'abcdefgh';
const PROMO_ORDER = ['q', 'r', 'b', 'n'];
const DRAG_THRESHOLD = 4; // px before a press becomes a drag

const fileOf = (sq) => FILES.indexOf(sq[0]);
const rankOf = (sq) => Number(sq[1]) - 1;
const squareAt = (file, rank) => FILES[file] + (rank + 1);

export function createBoard(root, options = {}) {
  const opts = {
    orientation: 'w',
    legalMoves: () => [],
    onMove: () => {},
    ...options,
  };

  let orientation = opts.orientation;
  let interactive = false;
  let selected = null;
  let drag = null;
  let promotion = null; // pending { from, to, moves }
  const pieces = new Map(); // square -> { el, type, colour }
  const marks = new Map(); // square -> Map<type, el>

  installPieceSprite();

  root.classList.add('board');
  root.innerHTML = `
    <div class="board-squares" aria-hidden="true"></div>
    <div class="board-marks"></div>
    <div class="board-pieces"></div>
    <div class="board-promo" hidden></div>
  `;
  const squaresEl = root.querySelector('.board-squares');
  const marksEl = root.querySelector('.board-marks');
  const piecesEl = root.querySelector('.board-pieces');
  const promoEl = root.querySelector('.board-promo');

  /* ---------------------------------------------------------------- layout */

  // Screen column/row for a square, honouring board orientation.
  function coords(sq) {
    const f = fileOf(sq);
    const r = rankOf(sq);
    return orientation === 'w'
      ? { col: f, row: 7 - r }
      : { col: 7 - f, row: r };
  }

  function squareFromCoords(col, row) {
    return orientation === 'w'
      ? squareAt(col, 7 - row)
      : squareAt(7 - col, row);
  }

  function place(el, sq) {
    const { col, row } = coords(sq);
    el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  }

  function buildSquares() {
    const frag = document.createDocumentFragment();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = squareFromCoords(col, row);
        const el = document.createElement('div');
        const dark = (fileOf(sq) + rankOf(sq)) % 2 === 0;
        el.className = `sq ${dark ? 'sq-dark' : 'sq-light'}`;
        el.dataset.square = sq;
        if (row === 7) {
          const f = document.createElement('span');
          f.className = 'coord coord-file';
          f.textContent = sq[0];
          el.append(f);
        }
        if (col === 0) {
          const r = document.createElement('span');
          r.className = 'coord coord-rank';
          r.textContent = sq[1];
          el.append(r);
        }
        frag.append(el);
      }
    }
    squaresEl.replaceChildren(frag);
  }

  /* ---------------------------------------------------------------- pieces */

  function makePiece(type, colour, sq) {
    const el = document.createElement('div');
    el.className = 'piece';
    el.dataset.colour = colour;
    el.dataset.type = type;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label',
      `${colour === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[type]} on ${sq}`);
    el.innerHTML = pieceSVG(type, colour);
    place(el, sq);
    piecesEl.append(el);
    return el;
  }

  function addPiece(type, colour, sq) {
    const rec = { el: makePiece(type, colour, sq), type, colour };
    pieces.set(sq, rec);
    return rec;
  }

  function removePiece(sq, { fade = false } = {}) {
    const rec = pieces.get(sq);
    if (!rec) return;
    pieces.delete(sq);
    if (fade) {
      rec.el.classList.add('is-captured');
      setTimeout(() => rec.el.remove(), 220);
    } else {
      rec.el.remove();
    }
  }

  function relabel(rec, sq) {
    rec.el.setAttribute('aria-label',
      `${rec.colour === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[rec.type]} on ${sq}`);
  }

  /** Rebuild the whole position from a FEN. Instant, no animation. */
  function setPosition(fen) {
    clearMarks();
    cancelSelection();
    pieces.clear();
    piecesEl.replaceChildren();
    const rows = fen.split(' ')[0].split('/');
    rows.forEach((row, i) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) {
          file += Number(ch);
          continue;
        }
        const colour = ch === ch.toUpperCase() ? 'w' : 'b';
        addPiece(ch.toLowerCase(), colour, squareAt(file, 7 - i));
        file++;
      }
    });
  }

  /**
   * Animate a move that has already been validated by the game layer.
   * `move` is a chess.js verbose move.
   * @returns {Promise<void>} resolves when the animation settles.
   */
  function applyMove(move, { duration = 260 } = {}) {
    const rec = pieces.get(move.from);
    if (!rec) {
      return Promise.resolve();
    }

    // En passant removes a pawn that is not on the destination square.
    if (move.flags.includes('e')) {
      const capturedSq = move.to[0] + (move.color === 'w' ? '5' : '4');
      removePiece(capturedSq, { fade: true });
    } else if (pieces.has(move.to)) {
      removePiece(move.to, { fade: true });
    }

    pieces.delete(move.from);
    pieces.set(move.to, rec);
    rec.el.style.setProperty('--move-dur', `${duration}ms`);
    rec.el.classList.add('is-moving');
    place(rec.el, move.to);
    relabel(rec, move.to);

    // Castling drags the rook along with the king.
    if (move.flags.includes('k') || move.flags.includes('q')) {
      const rank = move.color === 'w' ? '1' : '8';
      const kingside = move.flags.includes('k');
      const rookFrom = (kingside ? 'h' : 'a') + rank;
      const rookTo = (kingside ? 'f' : 'd') + rank;
      const rook = pieces.get(rookFrom);
      if (rook) {
        pieces.delete(rookFrom);
        pieces.set(rookTo, rook);
        rook.el.style.setProperty('--move-dur', `${duration}ms`);
        rook.el.classList.add('is-moving');
        place(rook.el, rookTo);
        relabel(rook, rookTo);
      }
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        rec.el.classList.remove('is-moving');
        if (move.promotion) {
          rec.type = move.promotion;
          rec.el.dataset.type = move.promotion;
          rec.el.innerHTML = pieceSVG(move.promotion, rec.colour);
          rec.el.classList.add('is-promoting');
          setTimeout(() => rec.el.classList.remove('is-promoting'), 260);
          relabel(rec, move.to);
        }
        resolve();
      }, duration);
    });
  }

  /* ----------------------------------------------------------------- marks */

  function mark(sq, type) {
    if (!marks.has(sq)) marks.set(sq, new Map());
    const bySq = marks.get(sq);
    if (bySq.has(type)) return;
    const el = document.createElement('div');
    el.className = `mark mark-${type}`;
    place(el, sq);
    marksEl.append(el);
    bySq.set(type, el);
  }

  function clearMarks(type) {
    for (const [sq, bySq] of marks) {
      for (const [t, el] of bySq) {
        if (type && t !== type) continue;
        el.remove();
        bySq.delete(t);
      }
      if (bySq.size === 0) marks.delete(sq);
    }
  }

  /** Brief pulse on a square — used for the mating move. */
  function flash(sq, type = 'flash') {
    mark(sq, type);
    setTimeout(() => {
      const bySq = marks.get(sq);
      const el = bySq?.get(type);
      if (el) {
        el.remove();
        bySq.delete(type);
        if (bySq.size === 0) marks.delete(sq);
      }
    }, 1200);
  }

  /* ----------------------------------------------------------------- input */

  function showSelection(sq) {
    selected = sq;
    clearMarks('selected');
    clearMarks('dest');
    clearMarks('dest-capture');
    mark(sq, 'selected');
    for (const m of opts.legalMoves(sq)) {
      mark(m.to, pieces.has(m.to) || m.enPassant ? 'dest-capture' : 'dest');
    }
  }

  function cancelSelection() {
    selected = null;
    clearMarks('selected');
    clearMarks('dest');
    clearMarks('dest-capture');
  }

  function movesTo(from, to) {
    return opts.legalMoves(from).filter((m) => m.to === to);
  }

  function squareFromPoint(clientX, clientY) {
    const rect = root.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return squareFromCoords(col, row);
  }

  function commit(from, to) {
    const candidates = movesTo(from, to);
    if (candidates.length === 0) return false;
    if (candidates.some((m) => m.promotion)) {
      openPromotion(from, to, candidates);
      return true;
    }
    cancelSelection();
    opts.onMove({ from, to });
    return true;
  }

  function onPointerDown(event) {
    if (!interactive || promotion || event.button > 0) return;
    const sq = squareFromPoint(event.clientX, event.clientY);
    if (!sq) return;

    // Completing a tap-tap move.
    if (selected && sq !== selected && movesTo(selected, sq).length) {
      event.preventDefault();
      commit(selected, sq);
      return;
    }

    const rec = pieces.get(sq);
    const canPick = rec && opts.legalMoves(sq).length > 0;
    if (!canPick) {
      if (selected) cancelSelection();
      return;
    }

    event.preventDefault();
    const wasSelected = selected === sq;
    showSelection(sq);
    drag = {
      from: sq,
      rec,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      wasSelected,
    };
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic pointers have no capture target */
    }
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    if (!drag.moved) {
      drag.moved = true;
      drag.rec.el.classList.add('is-dragging');
    }
    const { col, row } = coords(drag.from);
    drag.rec.el.style.transform =
      `translate(calc(${col * 100}% + ${dx}px), calc(${row * 100}% + ${dy}px))`;

    const over = squareFromPoint(event.clientX, event.clientY);
    if (over !== drag.overSquare) {
      drag.overSquare = over;
      clearMarks('hover');
      if (over && movesTo(drag.from, over).length) mark(over, 'hover');
    }
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    try {
      root.releasePointerCapture(event.pointerId);
    } catch {
      /* not captured */
    }
    clearMarks('hover');
    d.rec.el.classList.remove('is-dragging');

    const to = squareFromPoint(event.clientX, event.clientY);

    if (!d.moved) {
      // A tap: keep the selection, or toggle it off if it was already selected.
      if (d.wasSelected) cancelSelection();
      return;
    }

    if (to && to !== d.from && commit(d.from, to)) return;

    // Illegal drop — snap home.
    d.rec.el.classList.add('is-snapping');
    place(d.rec.el, d.from);
    setTimeout(() => d.rec.el.classList.remove('is-snapping'), 160);
    cancelSelection();
  }

  function onPointerCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    d.rec.el.classList.remove('is-dragging');
    place(d.rec.el, d.from);
    clearMarks('hover');
    cancelSelection();
  }

  /* ------------------------------------------------------------- promotion */

  function openPromotion(from, to, candidates) {
    const colour = pieces.get(from).colour;
    const available = PROMO_ORDER.filter((t) =>
      candidates.some((m) => m.promotion === t));
    const { col, row } = coords(to);
    // Open downward unless that would run off the bottom of the board.
    const down = row <= 3;
    promoEl.className = `board-promo ${down ? 'opens-down' : 'opens-up'}`;
    promoEl.style.transform =
      `translate(${col * 100}%, ${(down ? row : row - available.length + 1) * 100}%)`;
    promoEl.innerHTML = available
      .map((t) => `<button type="button" class="promo-choice" data-piece="${t}"
             aria-label="Promote to ${PIECE_NAMES[t]}">${pieceSVG(t, colour)}</button>`)
      .join('');
    if (!down) promoEl.append(...[...promoEl.children].reverse());
    promoEl.hidden = false;
    root.classList.add('is-promoting');
    promotion = { from, to };
  }

  function closePromotion() {
    promoEl.hidden = true;
    promoEl.replaceChildren();
    root.classList.remove('is-promoting');
    promotion = null;
  }

  promoEl.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    const button = event.target.closest('.promo-choice');
    if (!button) return;
    const { from, to } = promotion;
    closePromotion();
    cancelSelection();
    opts.onMove({ from, to, promotion: button.dataset.piece });
  });

  // Tapping away from an open picker cancels the promotion. Capture phase, so
  // it runs before the board's own handler — but never for the picker itself.
  root.addEventListener('pointerdown', (event) => {
    if (!promotion || event.target.closest('.board-promo')) return;
    event.preventDefault();
    event.stopPropagation();
    const rec = pieces.get(promotion.from);
    if (rec) place(rec.el, promotion.from);
    closePromotion();
    cancelSelection();
  }, true);

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  buildSquares();

  /* ------------------------------------------------------------------- api */

  return {
    setPosition,
    applyMove,
    mark,
    clearMarks,
    flash,
    get orientation() {
      return orientation;
    },
    setOrientation(next, fen) {
      if (next === orientation) return;
      orientation = next;
      buildSquares();
      for (const [sq, rec] of pieces) place(rec.el, sq);
      for (const [sq, bySq] of marks) for (const el of bySq.values()) place(el, sq);
      if (fen) setPosition(fen);
    },
    setInteractive(value) {
      interactive = value;
      root.classList.toggle('is-interactive', value);
      if (!value) {
        cancelSelection();
        closePromotion();
      }
    },
    get isInteractive() {
      return interactive;
    },
    pieceAt: (sq) => pieces.get(sq) ?? null,
  };
}
