/*
 * pieces.js — the "mpchess" piece set.
 *
 * Copyright (c) Maxime Chupin. Licensed GPL-3.0-or-later.
 *   https://github.com/chupinmaxime/mpchess-pieces
 *   https://github.com/lichess-org/lila/tree/master/public/piece/mpchess
 *
 * This set is copyleft, which is why Daily Mate as a whole is distributed under
 * GPLv3 — see LICENSE at the project root and THIRD-PARTY-NOTICES.md.
 *
 * The unmodified originals are in vendor/mpchess/. Inlining them here required
 * no rewriting at all: unlike most sets, mpchess carries no ids, no <style>
 * blocks and no gradients — every rule is an inline style attribute — so all
 * twelve can share one document without renaming anything. The symbol bodies
 * are byte-identical to the source files, and the generator asserts that no id,
 * <style> or url(#..) reference has appeared before emitting.
 *
 * Twelve symbols rather than six: white and black are separate artwork, so
 * colour cannot come from CSS. Nothing here sets fill or stroke.
 */

const VIEWBOX = "0 0 10 10";

const SYMBOLS = {
  wK: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.542 294.178c1.078 0 1.125.858 1.125 1.495H2.069c0-.65.046-1.495 1.124-1.495z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"M4.48 288.116v.484h-.537v.753h.537c0 .582-.142.476-.533.717-2.418-.972-3.734 2.055-.939 4.107l3.715-.014c2.848-2.038 1.504-5.064-.913-4.077-.46-.253-.545-.111-.545-.733h.548v-.753h-.548v-.484zm1.929 3.058c.644.065.894.873-.79 2.028v-1.617c.312-.315.497-.44.79-.41zm-2.962.008c.272.01.402.139.675.415v1.616c-1.683-1.154-1.433-1.962-.789-2.027a.85.85 0 0 1 .114-.004z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:.37229237;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/></g></g>",
  wQ: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.542 294.178c1.078 0 1.125.858 1.125 1.495H2.069c0-.65.046-1.495 1.124-1.495z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"M15.014 3.873a3.016 3.016 0 0 0-3.018 3.016 3.016 3.016 0 0 0 1.91 2.804l-.373 8.116-3.984-6.524a3.016 3.016 0 0 0 .53-1.709 3.016 3.016 0 0 0-3.017-3.015 3.016 3.016 0 0 0-3.015 3.015 3.016 3.016 0 0 0 2.504 2.97l4.773 14.69h15.147l4.76-14.6a3.016 3.016 0 0 0 2.595-2.982 3.016 3.016 0 0 0-3.015-3.015 3.016 3.016 0 0 0-3.016 3.015 3.016 3.016 0 0 0 .455 1.584l-4.072 6.57-.319-8.128a3.016 3.016 0 0 0 1.875-2.791 3.016 3.016 0 0 0-3.015-3.016 3.016 3.016 0 0 0-3.016 3.016 3.016 3.016 0 0 0 .854 2.103l-1.702 8.817-1.625-8.88a3.016 3.016 0 0 0 .8-2.04 3.016 3.016 0 0 0-3.016-3.016z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:1.51181102;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1;stroke-miterlimit:4;stroke-dasharray:none\" transform=\"scale(.26458)\"/></g></g>",
  wR: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.542 294.178c1.078 0 1.125.858 1.125 1.495H2.069c0-.65.046-1.495 1.124-1.495z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"m6.74 294.177-.567-3.253H3.569l-.561 3.253z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1;stroke-miterlimit:4;stroke-dasharray:none\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"m6.66 289.342-.8-.222-.173.439-.328-.002v-.624l-1.002.017v.607h-.292l-.21-.436-.784.307s-.008 1.53.404 1.521h2.781c.412 0 .404-1.606.404-1.606z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1;stroke-miterlimit:4;stroke-dasharray:none\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/></g></g>",
  wB: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.542 294.178c1.078 0 1.125.858 1.125 1.495H2.069c0-.65.046-1.495 1.124-1.495zm.01-.014c.202-.292 1.198-2.21-.75-4.165 0 0-.783 1.088-.913 2.696l-.477-.001c-.009-1.476 1.01-3.004 1.01-3.004.82-1.66-1.874-1.665-1.13 0-2.275 2.009-1.262 4.219-1.095 4.474z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/></g></g>",
  wN: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.545 294.15H3.201c.046-1.268 1.457-1.942 1.521-2.553.065-.612-.223-.77-.223-.77s-.197.736-.448.886-.836.291-.836.291-.41.37-.651.344c-.242-.025-.449-.603-.449-.603l.82-1.306.417-.926.392-.428.168-.628.473.552c2.601 0 3.165 3.352 2.16 5.14zm-.003.028c1.078 0 1.125.858 1.125 1.495H2.069c0-.65.046-1.495 1.124-1.495z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:.38604324;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/></g></g>",
  wP: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M18.875 10.234a3.938 3.938 0 0 0-3.938 3.938 3.938 3.938 0 0 0 1.27 2.889l-2.234.959v2.33l2.643-.008c-1.555 10.05-6.007 6.96-6.007 12.527h16.657c0-5.646-4.56-2.232-6.124-12.53l2.64-.04v-2.315l-2.21-.945a3.938 3.938 0 0 0 1.242-2.867 3.938 3.938 0 0 0-3.939-3.938z\" style=\"fill:#fff;fill-opacity:1;stroke:#000;stroke-width:1.51181102;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"scale(.26458)\"/></g></g>",
  bK: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.542 294.178c1.078 0 1.125.858 1.125 1.495H2.069c0-.65.046-1.495 1.124-1.495z\" style=\"fill:#000;fill-opacity:1;stroke:none;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"M4.48 287.937v.468h-.537v.727h.537c0 .563-.142.46-.533.694-2.418-.94-3.734 1.985-.939 3.968l3.715-.013c2.848-1.97 1.504-4.894-.913-3.94-.46-.245-.545-.107-.545-.709h.548v-.727h-.548v-.468zm1.929 2.955c.644.063.894.844-.79 1.96v-1.563c.312-.305.497-.425.79-.397m-2.962.008c.272.01.402.134.675.401v1.562c-1.683-1.115-1.433-1.897-.789-1.959a.85.85 0 0 1 .114-.004\" style=\"fill:#000;fill-opacity:1;stroke:none;stroke-width:.36596447;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/></g></g>",
  bQ: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.542 294.178c1.078 0 1.125.858 1.125 1.495H2.069c0-.65.046-1.495 1.124-1.495z\" style=\"fill:#000;fill-opacity:1;stroke:none;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"M3.917 287.996a.743.747 0 0 0-.743.746.743.747 0 0 0 .47.694l-.092 2.01-.982-1.615a.743.747 0 0 0 .13-.424.743.747 0 0 0-.742-.746.743.747 0 0 0-.743.746.743.747 0 0 0 .617.736l1.176 3.636h3.733l1.173-3.614a.743.747 0 0 0 .64-.738.743.747 0 0 0-.744-.747.743.747 0 0 0-.743.747.743.747 0 0 0 .112.392l-1.003 1.626-.079-2.012a.743.747 0 0 0 .462-.69.743.747 0 0 0-.743-.747.743.747 0 0 0-.743.746.743.747 0 0 0 .21.52l-.419 2.183-.4-2.198a.743.747 0 0 0 .196-.505.743.747 0 0 0-.743-.746\" style=\"fill:#000;fill-opacity:1;stroke:none;stroke-width:.37341464;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/></g></g>",
  bR: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.542 294.178c1.078 0 1.125.858 1.125 1.495H2.069c0-.65.046-1.495 1.124-1.495z\" style=\"fill:#000003;fill-opacity:1;stroke:none;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"m6.74 293.78-.567-2.412H3.569l-.561 2.412z\" style=\"fill:#000003;fill-opacity:1;stroke:none;stroke-width:.33243936;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"m6.66 289.342-.8-.222-.173.439-.328-.002v-.624l-1.002.017v.607h-.292l-.21-.436-.784.307s-.008 1.53.404 1.521h2.781c.412 0 .404-1.606.404-1.606z\" style=\"fill:#000003;fill-opacity:1;stroke:none;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1;stroke-miterlimit:4;stroke-dasharray:none\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/></g></g>",
  bB: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.542 294.178c1.078 0 1.125.858 1.125 1.495H2.069c0-.65.046-1.495 1.124-1.495z\" style=\"fill:#000002;fill-opacity:1;stroke:none;stroke-width:.38604325;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"M6.552 293.804c.202-.274 1.198-2.07-.75-3.903 0 0-.783 1.02-.913 2.526h-.477c-.009-1.383 1.01-2.815 1.01-2.815.82-1.555-1.874-1.56-1.13 0-2.275 1.882-1.262 3.953-1.095 4.192z\" style=\"fill:#000002;fill-opacity:1;stroke:none;stroke-width:.37369174;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/></g></g>",
  bN: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M6.5422 294.1782c1.0776 0 1.1247.8573 1.1247 1.4946H2.0688c0-.649.0465-1.4946 1.1241-1.4946z\" style=\"fill:#000;fill-opacity:1;stroke:none;stroke-width:.38604324;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/><path d=\"M6.4242 293.7612H3.3096c.0424-1.2235 1.357-1.8739 1.4169-2.4641.0598-.5903-.208-.7423-.208-.7423s-.1836.7095-.4175.8545c-.234.145-.7784.2813-.7784.2813s-.382.3571-.6072.3323c-.2252-.025-.4179-.5822-.4179-.5822l.7646-1.261.3874-.894.3656-.413.1566-.6066.4401.5334c2.4231 0 2.9485 3.2354 2.0124 4.9617\" style=\"fill:#000;fill-opacity:1;stroke:none;stroke-width:.36607537;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"matrix(1.07361 0 0 1 -.233 -286.97)\"/></g></g>",
  bP: "<g style=\"fill:#fff;fill-opacity:1\"><g style=\"fill:#fff;fill-opacity:1;stroke-width:.09651081;stroke-miterlimit:4;stroke-dasharray:none\"><path d=\"M18.875 10.234a3.938 3.938 0 0 0-3.938 3.938 3.938 3.938 0 0 0 1.27 2.889l-2.234.959v2.33l2.643-.008c-1.555 10.05-6.007 6.96-6.007 12.527h16.657c0-5.646-4.56-2.232-6.124-12.53l2.64-.04v-2.315l-2.21-.945a3.938 3.938 0 0 0 1.242-2.867 3.938 3.938 0 0 0-3.939-3.938\" style=\"fill:#000004;fill-opacity:1;stroke:none;stroke-width:1.51181102;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1\" transform=\"scale(.26458)\"/></g></g>",
};

export const PIECE_NAMES = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
};

/** Shown in the app's credit line. */
export const PIECE_CREDIT = {
  name: 'mpchess',
  author: 'Maxime Chupin',
  authorUrl: 'https://github.com/chupinmaxime/mpchess-pieces',
  licence: 'GPL-3.0-or-later',
};

/** One <symbol> per piece and colour, injected once and shared by every <use>. */
export const PIECE_SPRITE =
  '<svg class="piece-sprite" aria-hidden="true" focusable="false" width="0" height="0">' +
  Object.entries(SYMBOLS).map(([name, body]) =>
    `<symbol id="pc-${name}" viewBox="${VIEWBOX}">${body}</symbol>`
  ).join('') +
  '</svg>';

let injected = false;

/** Put the symbol definitions in the document. Safe to call repeatedly. */
export function installPieceSprite(doc = document) {
  if (injected && doc === document) return;
  if (doc.querySelector('.piece-sprite')) { injected = true; return; }
  doc.body.insertAdjacentHTML('afterbegin', PIECE_SPRITE);
  injected = true;
}

const cache = new Map();

/** An <svg> referencing the shared symbol for this piece and colour. */
export function pieceSVG(type, colour) {
  const key = colour + type;
  if (!cache.has(key)) {
    cache.set(
      key,
      `<svg class="piece-svg" viewBox="${VIEWBOX}" aria-hidden="true" focusable="false">` +
        `<use href="#pc-${colour}${type.toUpperCase()}"/>` +
      `</svg>`
    );
  }
  return cache.get(key);
}
