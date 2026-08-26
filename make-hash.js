#!/usr/bin/env node
/*
 * make-hash.js — turn a dashboard password into the constant that goes in
 * netlify/functions/dashboard-data.mjs.
 *
 *   node make-hash.js "your password here"      # convenient
 *   node make-hash.js                           # safer: reads stdin, no shell history
 *
 * The second form is worth the extra keystroke. An argument is visible in
 * `history`, and in the process list to anyone else on the machine, for as long
 * as the command runs. Piped input is neither.
 *
 * This is a LOCAL developer tool. It is never imported by the site, never
 * deployed, and it writes nothing to disk — the hash goes to stdout and the
 * plaintext goes nowhere at all.
 *
 * CommonJS on purpose: package.json declares no "type", so a .js file using
 * `import` would work but print a module-detection warning on every run.
 *
 * ---------------------------------------------------------------------------
 * A word on what a bare SHA-256 does and does not buy you
 * ---------------------------------------------------------------------------
 * It keeps the plaintext out of the repository, which is the point. It is NOT
 * a slow password hash: SHA-256 is built to be fast, and a public repo hands
 * an attacker the hash to grind offline at billions of guesses a second.
 *
 * So the strength here is entirely in the password. A dictionary word with
 * digits and punctuation on the end falls in seconds — those are exactly the
 * patterns wordlist rules expand. A long random string does not fall at all,
 * because there is no list to draw it from.
 *
 * Generate one with:  openssl rand -base64 24
 */

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, 'netlify', 'functions', 'dashboard-data.mjs');
const CONSTANT = /const DASHBOARD_PASSWORD_SHA256 = '[^']*';/;

function hash(password) {
  return createHash('sha256').update(password, 'utf8').digest('hex');
}

/**
 * Write the digest straight into the function, so the password never has to be
 * copied, pasted, or read aloud. Only the hash is ever written.
 */
function install(digest) {
  let source;
  try {
    source = fs.readFileSync(TARGET, 'utf8');
  } catch {
    console.error(`Could not read ${TARGET}. Run this from the project root.`);
    process.exit(1);
  }

  if (!CONSTANT.test(source)) {
    console.error(
      `Could not find DASHBOARD_PASSWORD_SHA256 in ${TARGET}. Nothing written.`
    );
    process.exit(1);
  }

  fs.writeFileSync(
    TARGET,
    source.replace(CONSTANT, `const DASHBOARD_PASSWORD_SHA256 = '${digest}';`)
  );

  console.error('\nPassword set. Written to:');
  console.error(`  ${path.relative(process.cwd(), TARGET)}`);
  console.error('\nThe password itself was not written anywhere — only the hash below.');
  console.error('Commit and push, then log in with the password you just typed.\n');
}

function emit(password) {
  if (password === undefined || password === '') {
    console.error('No password given. Nothing to hash.');
    process.exit(1);
  }

  // A trailing newline from a pipe is not part of the password.
  const cleaned = password.replace(/\r?\n$/, '');

  if (cleaned === '') {
    console.error('No password given. Nothing to hash.');
    process.exit(1);
  }

  if (cleaned !== cleaned.trim()) {
    console.error(
      'Note: this password has leading or trailing whitespace, and it has been kept.\n' +
      '      If that was accidental, re-run without it — otherwise you will have to\n' +
      '      type it exactly that way at the dashboard.\n'
    );
  }

  console.error(`Password length: ${cleaned.length} characters`);
  if (cleaned.length < 16) {
    console.error(
      'Warning: a short password does not survive an offline attack on a public hash.\n' +
      '         Consider:  openssl rand -base64 24\n'
    );
  }

  const digest = hash(cleaned);

  // Only the hash goes to stdout, so `node make-hash.js | pbcopy` stays clean.
  console.log(digest);

  if (SET) install(digest);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

const args = process.argv.slice(2);
const SET = args.includes('--set');
const fromArgv = args.find((a) => a !== '--set');

if (fromArgv !== undefined) {
  emit(fromArgv);
} else {
  if (process.stdin.isTTY) {
    console.error('Reading the password from stdin. Type it, then press Ctrl-D:');
  }
  readStdin().then(emit);
}
