/*
 * game.js — the puzzle loop: three attempts, refutations, win and loss.
 *
 * Owns a chess.js instance and drives the board. Reports what happened through
 * callbacks; it renders nothing itself and touches no storage.
 *
 * An attempt is a whole line, not a single move. The player gets `mateIn` moves
 * and the opponent answers each one, so a wrong first move no longer ends the
 * attempt — the player plays their idea out and sees where it falls short. The
 * attempt is judged at the end: checkmate is a solve, anything else is a fail.
 * Mating early counts too, since finding a faster mate is still finding a mate.
 *
 * While the player follows the stored solution the opponent's replies come from
 * the puzzle data. The moment they deviate, the data has nothing to say and the
 * replies are generated instead — see chooseDefence().
 */

import { Chess } from '../vendor/chess.js';

export const MAX_ATTEMPTS = 3;  // three attempts, then the day is over

const FAILURE_PAUSE = 1500; // ms the finished line stays up before the reset
const MOVE_PAUSE = 380;     // ms between moves when a line plays itself out

const COLOUR_NAME = { w: 'White', b: 'Black' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function createGame({ board, puzzle, onEvent }) {
  const chess = new Chess();
  const playerColour = new Chess(puzzle.fen).turn();
  const opponentColour = playerColour === 'w' ? 'b' : 'w';

  let solutionIndex = 0;   // ply cursor into puzzle.solution, while still on it
  let onLine = true;       // is the player still following the stored solution?
  let playerMoves = 0;     // player moves made this attempt
  let replies = [];        // opponent replies this attempt, for the failure line
  let results = [];        // finished attempts: "fail" | "solve"
  let phase = 'idle';      // idle | playing | busy | over

  const emit = (type, detail) => onEvent?.({ type, ...detail });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ------------------------------------------------------------- board sync */

  function markCheck() {
    board.clearMarks('check');
    if (!chess.isCheck()) return;
    const turn = chess.turn();
    for (const square of chess.findPiece({ type: 'k', color: turn })) {
      board.mark(square, 'check');
    }
  }

  /** Put the board back to the puzzle's starting position, ready for an attempt. */
  function resetPosition() {
    chess.load(puzzle.fen);
    solutionIndex = 0;
    onLine = true;
    playerMoves = 0;
    replies = [];
    board.setPosition(puzzle.fen);
    board.clearMarks();
    markCheck();
  }

  const attemptsUsed = () => results.length;
  const attemptsLeft = () => MAX_ATTEMPTS - results.length;

  /* --------------------------------------------------------------- defence */

  /** Would the player have mate in one, in the position as it stands? */
  function playerMatesNext() {
    return chess.moves({ verbose: true }).some((reply) => {
      chess.move(reply);
      const mate = chess.isCheckmate();
      chess.undo();
      return mate;
    });
  }

  /**
   * Material won by a capture, assuming the obvious recapture. A crude static
   * exchange: enough to tell a free piece from a losing trade, which is all the
   * difference between punishing a blunder and blundering back.
   */
  function captureGain(move) {
    const victim = VALUE[move.captured] || 0;
    chess.move(move);
    const recaptured = chess.attackers(move.to, playerColour).length > 0;
    chess.undo();
    return recaptured ? victim - (VALUE[move.piece] || 0) : victim;
  }

  /**
   * The opponent's reply once the player has left the solution line.
   *
   * Not an engine, but not a pacifist either. In priority order: deliver mate if
   * the player's line allowed one, then win material outright, then move the king
   * to safety, then trade or play on — always skipping anything that hands the
   * player mate next move. When in check the only captures considered are of the
   * checking piece, since nothing else addresses it.
   */
  function chooseDefence() {
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;

    // Punish the blunder: a line that lets the opponent mate gets mated.
    for (const move of moves) {
      chess.move(move);
      const mates = chess.isCheckmate();
      chess.undo();
      if (mates) return move;
    }

    const inCheck = chess.isCheck();
    // When in check, "the attacking piece" is specifically the one giving it.
    const kingSquare = chess.findPiece({ type: 'k', color: opponentColour })[0];
    const checkers = inCheck && kingSquare
      ? chess.attackers(kingSquare, playerColour)
      : [];

    // Rank the candidates first, then walk them in order and take the first that
    // does not hand the player mate next move. Scoring every legal move up front
    // is the same answer but quadratic — over three seconds in a crowded
    // middlegame — whereas this usually settles on the first candidate.
    const captures = moves.filter((m) =>
      m.captured && (!inCheck || checkers.includes(m.to)));
    const gain = new Map(captures.map((m) => [m, captureGain(m)]));

    // Free material first, biggest haul first. A losing trade is not "punishing".
    const winning = captures
      .filter((m) => gain.get(m) > 0)
      .sort((a, b) => gain.get(b) - gain.get(a));
    const taken = new Set(winning);

    const kingMoves = moves.filter((m) => m.piece === 'k' && !taken.has(m));
    kingMoves.forEach((m) => taken.add(m));

    const evenTrades = captures.filter((m) => !taken.has(m));
    evenTrades.forEach((m) => taken.add(m));

    const ordered = [...winning, ...kingMoves, ...evenTrades,
                     ...moves.filter((m) => !taken.has(m))];

    for (const move of ordered) {
      chess.move(move);
      const walksIntoMate = playerMatesNext();
      chess.undo();
      if (!walksIntoMate) return move;
    }

    // Every reply loses to mate: play the best-ranked one and take it.
    return ordered[0];
  }

  /**
   * Plain language for why the line came up short, drawn from the opponent's
   * own replies: the escape the player failed to account for.
   */
  function failureMessage() {
    const who = COLOUR_NAME[opponentColour];
    // The telling move is the last one made while in check — that is the escape.
    const pick = replies.filter((r) => r.wasCheck).at(-1) || replies.at(-1);
    if (!pick) return `${who} is not in checkmate.`;

    const { move, wasCheck } = pick;
    // If the escape was not the final reply the piece may have moved on since,
    // so name the move rather than a square the player can no longer see it on.
    const isFinal = pick === replies.at(-1);
    if (wasCheck) {
      if (move.piece === 'k') {
        return isFinal
          ? `${who}'s king escaped to ${move.to}.`
          : `${who}'s king escaped the check with ${move.san}.`;
      }
      if (move.captured) return `${who} captured the checking piece with ${move.san}.`;
      return `${who} blocked the check with ${move.san}.`;
    }
    if (move.piece === 'k') return `${who}'s king slipped away to ${move.to}.`;
    if (move.captured) return `${who} captured with ${move.san}.`;
    return `${who} had time for ${move.san}.`;
  }

  /* ------------------------------------------------------------ move intake */

  async function onPlayerMove({ from, to, promotion }) {
    if (phase !== 'playing') return;
    phase = 'busy';
    board.setInteractive(false);

    let move;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      phase = 'playing';
      board.setInteractive(true);
      return;
    }

    await board.applyMove(move);
    markCheck();
    playerMoves += 1;

    // Mate ends it, whether it arrived on schedule or early.
    if (chess.isCheckmate()) {
      await finishSolved(move);
      return;
    }

    // Track whether the player is still walking the stored line.
    if (onLine && move.san === puzzle.solution[solutionIndex]) {
      solutionIndex += 1;
    } else {
      onLine = false;
    }

    // The opponent answers every player move.
    if (chess.moves().length === 0) {
      // No legal reply and not mate: the player stalemated the opponent.
      await failAttempt(`Stalemate — ${COLOUR_NAME[opponentColour]} has no legal moves.`);
      return;
    }

    const scripted = onLine ? puzzle.solution[solutionIndex] : null;
    const wasCheck = chess.isCheck();

    await wait(MOVE_PAUSE);
    // The scripted move is provably legal for verified data, but a throw here
    // would strand the board mid-attempt with input disabled. Fall back instead.
    let reply = null;
    if (scripted) {
      try {
        reply = chess.move(scripted);
        solutionIndex += 1;
      } catch {
        onLine = false;
      }
    }
    if (!reply) reply = chess.move(chooseDefence());
    await board.applyMove(reply);
    markCheck();
    replies.push({ move: reply, wasCheck });

    // The reply may have ended the game against the player.
    if (chess.isCheckmate()) {
      await failAttempt(`${COLOUR_NAME[opponentColour]} mated you with ${reply.san}.`);
      return;
    }
    if (chess.isStalemate()) {
      await failAttempt('Stalemate — the position is drawn.');
      return;
    }
    if (chess.isDraw()) {
      await failAttempt('The position is drawn.');
      return;
    }

    // Out of moves for this attempt: judge it.
    if (playerMoves >= puzzle.mateIn) {
      await failAttempt(failureMessage());
      return;
    }

    emit('move-progress', { playerMoves, total: puzzle.mateIn });
    phase = 'playing';
    board.setInteractive(true);
  }

  /* ---------------------------------------------------------------- endings */

  async function failAttempt(message) {
    emit('attempt-failed', { message });

    results.push('fail');
    emit('attempts-changed', { results, attemptsLeft: attemptsLeft() });

    await wait(FAILURE_PAUSE);

    if (results.length >= MAX_ATTEMPTS) {
      await finishFailed();
      return;
    }

    resetPosition();
    emit('attempt-reset', { attemptsLeft: attemptsLeft() });
    emit('move-progress', { playerMoves: 0, total: puzzle.mateIn });
    phase = 'playing';
    board.setInteractive(true);
  }

  async function finishSolved(matingMove) {
    results.push('solve');
    phase = 'over';
    board.setInteractive(false);
    emit('attempts-changed', { results, attemptsLeft: attemptsLeft() });

    // Restrained celebration: a single pulse on the mating square.
    board.flash(matingMove.to, 'mate');
    emit('solved', {
      attemptsUsed: attemptsUsed(),
      results,
      early: playerMoves < puzzle.mateIn,
    });
  }

  async function finishFailed() {
    phase = 'over';
    board.setInteractive(false);
    emit('failed', { attemptsUsed: attemptsUsed(), results });

    // Show the answer: replay the whole solution from the start.
    resetPosition();
    emit('showing-solution', {});
    await wait(600);

    for (const san of puzzle.solution) {
      const move = chess.move(san);
      await board.applyMove(move);
      markCheck();
      await wait(MOVE_PAUSE);
    }

    const last = chess.history({ verbose: true }).at(-1);
    if (last) board.flash(last.to, 'mate');
    emit('solution-shown', {});
  }

  /* ------------------------------------------------------------------- api */

  return {
    /** Begin play. `priorResults` restores a day already in progress. */
    start(priorResults = []) {
      results = priorResults.slice();
      resetPosition();
      board.setOrientation(playerColour, puzzle.fen);
      board.setPosition(puzzle.fen);
      markCheck();
      phase = 'playing';
      board.setInteractive(true);
      emit('attempts-changed', { results, attemptsLeft: attemptsLeft() });
      emit('move-progress', { playerMoves: 0, total: puzzle.mateIn });
    },

    /** Replay a finished day's solution without touching stats. */
    async revealSolution() {
      phase = 'over';
      board.setInteractive(false);
      resetPosition();
      await wait(400);
      for (const san of puzzle.solution) {
        const move = chess.move(san);
        await board.applyMove(move);
        markCheck();
        await wait(MOVE_PAUSE);
      }
      const last = chess.history({ verbose: true }).at(-1);
      if (last) board.flash(last.to, 'mate');
    },

    onPlayerMove,
    legalMoves: (square) =>
      chess.moves({ square, verbose: true }).map((m) => ({
        to: m.to,
        promotion: m.promotion,
        enPassant: m.flags.includes('e'),
      })),

    get playerColour() { return playerColour; },
    get results() { return results.slice(); },
    get attemptsUsed() { return attemptsUsed(); },
    get isOver() { return phase === 'over'; },
  };
}
