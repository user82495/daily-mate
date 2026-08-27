/*
 * push.js — the notification opt-in.
 *
 * Shown once, after a first completed puzzle, and never on page load. Asking a
 * stranger for notification permission before they have played is how a site
 * gets permanently blocked at the browser level, which would cost the players
 * who actually wanted it.
 *
 * iOS is a special case worth naming: Safari only exposes Web Push to a PWA
 * that has been added to the home screen. Calling Notification.requestPermission
 * in a normal iOS tab does nothing useful, so on iOS-outside-standalone the
 * panel offers the Add to Home Screen hint instead of a prompt that cannot work.
 */

import { fetchVapidKey, savePushSubscription } from './api.js';

const $ = (id) => document.getElementById(id);

const STATE_KEY = 'dailymate.push.v1';
const DEFAULT_HOUR = 9;

/* --------------------------------------------------------------- environment */

/** iPadOS 13+ reports itself as a Mac, so touch points are part of the test. */
function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function pushSupported() {
  return 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/* -------------------------------------------------------------------- state */

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeState(next) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...readState(), ...next }));
  } catch {
    // Worst case the panel offers itself again tomorrow. Not worth failing over.
  }
}

/* ----------------------------------------------------------------- subscribe */

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribe(hour) {
  const { key } = (await fetchVapidKey()) || {};
  if (!key) return false; // push is not configured on this deploy

  const registration = await navigator.serviceWorker.ready;

  // An existing subscription is reused: re-subscribing with the same key
  // returns the same endpoint anyway, and the row is keyed on endpoint.
  const subscription =
    (await registration.pushManager.getSubscription())
    || (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const saved = await savePushSubscription({ subscription, notifyHour: hour, timezone });
  return saved !== null;
}

/* ------------------------------------------------------------------ the panel */

function hourOptions(selected) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    const label = new Date(2026, 0, 1, h).toLocaleTimeString([], {
      hour: 'numeric',
      hour12: undefined,
    });
    out.push(`<option value="${h}"${h === selected ? ' selected' : ''}>${label}</option>`);
  }
  return out.join('');
}

function renderPrompt(panel, onDone) {
  panel.innerHTML = `
    <p class="push-ask">Want a nudge when tomorrow's puzzle drops?</p>
    <div class="push-row">
      <label class="push-time">At
        <select id="push-hour">${hourOptions(DEFAULT_HOUR)}</select>
      </label>
      <button class="push-yes" id="push-yes" type="button">Yes, remind me</button>
      <button class="push-no" id="push-no" type="button">No thanks</button>
    </div>
    <p class="push-status" id="push-status" role="status" aria-live="polite"></p>
  `;
  panel.hidden = false;

  const status = $('push-status');

  $('push-no').addEventListener('click', () => {
    writeState({ dismissed: true });
    panel.hidden = true;
    onDone?.();
  });

  $('push-yes').addEventListener('click', async () => {
    const hour = Number($('push-hour').value);
    $('push-yes').disabled = true;

    let permission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = 'denied';
      }
    }

    if (permission !== 'granted') {
      // Denial is final until the player changes it in browser settings, so
      // never offer this again.
      writeState({ dismissed: true, denied: true });
      status.textContent = 'Notifications are blocked in your browser settings.';
      $('push-yes').disabled = false;
      return;
    }

    const ok = await subscribe(hour);
    if (ok) {
      writeState({ subscribed: true, hour });
      panel.innerHTML = `<p class="push-ask">Reminder set. See you tomorrow ♟️</p>`;
    } else {
      status.textContent = 'Could not set that up. Try again tomorrow.';
      $('push-yes').disabled = false;
    }
    onDone?.();
  });
}

function renderIOSHint(panel) {
  panel.innerHTML = `
    <p class="push-ask">Want a nudge when tomorrow's puzzle drops?</p>
    <p class="push-hint">
      On iPhone and iPad, reminders only work once Daily Mate is on your home
      screen. Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>,
      and open it from there.
    </p>
    <div class="push-row">
      <button class="push-no" id="push-no" type="button">Got it</button>
    </div>
  `;
  panel.hidden = false;
  $('push-no').addEventListener('click', () => {
    // Not "dismissed" — they may well add it to the home screen later, and the
    // real prompt should be waiting when they do.
    writeState({ iosHintSeen: true });
    panel.hidden = true;
  });
}

/**
 * Offer notifications, if this is the right moment and the right browser.
 *
 * Call only after a puzzle has actually been completed.
 */
export function maybeOfferNotifications({ onDone } = {}) {
  const panel = $('push-panel');
  if (!panel) return;

  const state = readState();
  if (state.subscribed || state.dismissed || state.denied) return;

  // iOS outside standalone: no amount of asking will produce a subscription.
  if (isIOS() && !isStandalone()) {
    if (!state.iosHintSeen) renderIOSHint(panel);
    return;
  }

  if (!pushSupported()) return;
  if (Notification.permission === 'denied') {
    writeState({ denied: true });
    return;
  }

  renderPrompt(panel, onDone);
}
