/*
 * player.js — the device's anonymous identifier.
 *
 * There is exactly one of these and everything keys off it: analytics, stats,
 * results and push. It is a random UUID minted in this browser, stored in
 * localStorage, and meaningless anywhere else.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OLD KEY IS STILL THE CANONICAL ONE
 * ---------------------------------------------------------------------------
 * Daily Mate already had an anonymous id under `dailymate.anon.v1`, and the
 * `plays` table is keyed on it. Minting a second id under a new name would
 * quietly split every returning player in two: their history under one key,
 * their streak under another. So `dailymate.anon.v1` remains the source of
 * truth, and the same value is mirrored to `dm_player_id` for anything that
 * looks for that name.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT MINTED ON PAGE LOAD
 * ---------------------------------------------------------------------------
 * privacy.html and the README both promise that someone who opens Daily Mate
 * and walks away is never given an identifier and makes no request at all.
 * Minting on load would make those documents false. The id is created on the
 * first action that actually needs one — finishing a puzzle, opening the stats
 * page, or enabling notifications — all of which are deliberate.
 */

const ID_KEY = 'dailymate.anon.v1';   // canonical, and what `plays` is keyed on
const MIRROR_KEY = 'dm_player_id';    // same value, under the newer name

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** crypto.randomUUID needs a secure context; this covers plain-HTTP dev. */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mirror(id) {
  try {
    if (localStorage.getItem(MIRROR_KEY) !== id) localStorage.setItem(MIRROR_KEY, id);
  } catch {
    // Mirroring is a convenience; never let it be the thing that fails.
  }
}

/**
 * The player id, minting one if this device has never needed it.
 *
 * @returns {string|null} null when storage is unavailable (private browsing),
 *          in which case every caller degrades to "no server features" rather
 *          than inventing an id that would be new on every page load.
 */
export function playerId() {
  try {
    const existing = localStorage.getItem(ID_KEY);
    if (existing && UUID_RE.test(existing)) {
      mirror(existing);
      return existing;
    }
    // An id may exist only under the mirror if storage was written by a newer
    // build first. Adopt it rather than minting a third value.
    const mirrored = localStorage.getItem(MIRROR_KEY);
    if (mirrored && UUID_RE.test(mirrored)) {
      localStorage.setItem(ID_KEY, mirrored);
      return mirrored;
    }
    const fresh = uuid();
    localStorage.setItem(ID_KEY, fresh);
    mirror(fresh);
    return fresh;
  } catch {
    return null;
  }
}

/**
 * The player id **only if one already exists** — never mints.
 *
 * For callers that want to behave differently for a brand-new visitor without
 * giving them an identifier just by asking.
 *
 * @returns {string|null}
 */
export function existingPlayerId() {
  try {
    const existing = localStorage.getItem(ID_KEY) || localStorage.getItem(MIRROR_KEY);
    return existing && UUID_RE.test(existing) ? existing : null;
  } catch {
    return null;
  }
}

export { ID_KEY, MIRROR_KEY, UUID_RE };
