#!/usr/bin/env node
/**
 * check-license-notice — every shipped artifact carries the licence notice.
 *
 * This repo is Business Source License 1.1: source-available, NOT open source.
 * The LICENSE file protects the REPO. This check protects the ARTIFACT — a
 * minified bundle lifted onto somebody else's origin still has to say whose it
 * is and what the terms are, and the extension IIFE is explicitly designed to
 * be dropped onto a third-party page.
 *
 * WHY THIS EXISTS AS A GATE AND NOT A CONFIG LINE. The notice was applied twice
 * and silently vanished twice, both times with `npm run build` exiting 0:
 *
 *   1. `build.rollupOptions.output.banner` — this Vite is ROLLDOWN-backed, so
 *      that key is accepted and IGNORED. No error, no warning.
 *   2. `build.rolldownOptions.output.banner` — applied, then eaten by the
 *      minifier. No error, no warning.
 *
 * In both cases the build succeeded, the chunk was emitted at the same content
 * hash, and the notice was absent. Every cheap signal said shipped. Only
 * reading the bytes could tell the difference, so reading the bytes is the
 * rule. The banner is applied by a `generateBundle` plugin (license-banner.ts),
 * which runs after minification — but the point is that nothing is trusted:
 * this asserts the OUTPUT, not the configuration.
 *
 * Exit 0 every artifact carries it · 1 one does not · 2 could not judge
 * (nothing was built) — never 0 on silence, because "I could not look" is not
 * "nothing is wrong".
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = 'Business Source License 1.1';
const CONTACT = 'licensing@aitherium.com';
const HEAD_BYTES = 1200;

const root = process.cwd();
const targets = [];

const assetDir = join(root, 'dist', 'assets');
if (existsSync(assetDir)) {
  for (const f of readdirSync(assetDir)) {
    if (f.endsWith('.js')) targets.push(join(assetDir, f));
  }
}
for (const rel of [
  ['public', 'webmcp-adapter.js'],
  ['dist', 'webmcp-adapter.js'],
]) {
  const p = join(root, ...rel);
  if (existsSync(p)) targets.push(p);
}

const html = join(root, 'dist', 'index.html');

if (targets.length === 0) {
  console.error('[check-license-notice] NOT JUDGED — no built JS artifacts found. Run the build first.');
  process.exit(2);
}
if (!existsSync(html)) {
  console.error('[check-license-notice] NOT JUDGED — dist/index.html missing.');
  process.exit(2);
}

let bad = 0;
for (const p of targets) {
  const head = readFileSync(p).subarray(0, HEAD_BYTES).toString('utf8');
  if (!head.includes(MARKER)) {
    console.error(`[check-license-notice] MISSING notice: ${p.slice(root.length + 1)}`);
    bad++;
  }
}
if (!readFileSync(html, 'utf8').includes(CONTACT)) {
  console.error('[check-license-notice] MISSING notice: dist/index.html');
  bad++;
}

if (bad > 0) {
  console.error(
    `[check-license-notice] ${bad} artifact(s) shipped without the licence notice.\n` +
    '  The banner is applied by licenseBanner() in license-banner.ts via generateBundle.\n' +
    '  Do NOT "fix" this with output.banner — that has silently failed twice (see header).'
  );
  process.exit(1);
}
console.log(`[check-license-notice] OK — ${targets.length} JS artifact(s) + index.html carry the BUSL-1.1 notice.`);
