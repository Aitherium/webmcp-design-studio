#!/usr/bin/env node
/**
 * check-built-html — no unsubstituted Vite placeholder may reach production.
 *
 * Vite substitutes `%VITE_X%` in index.html ONLY for vars that are defined. An
 * unset one is passed through verbatim, so a missing build var does not fail
 * the build, does not warn, and ships a literal `%VITE_X%` to every visitor.
 *
 * Measured 2026-09-02 on the live site: `%VITE_OT_TOKEN%` was being served
 * inside the block commented "Origin-trial token for WebMCP" -- the single
 * block a judge reading source for a WebMCP submission is most likely to open.
 * Nothing was broken (the guard refused to inject a bogus meta) and nothing
 * said a word.
 *
 * Exit 0 clean · 1 a placeholder survived · 2 could not judge (no built
 * index.html) -- never 0 on silence, because "I could not look" is not "fine".
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--self-test')) {
  const cases = [
    ['finds an unsubstituted placeholder', '<script>var t = "%VITE_OT_TOKEN%";</script>', 1],
    ['passes a substituted one', '<script>var t = "A7xReal.Token";</script>', 0],
    ['passes a page with no placeholder at all', '<html><body>hi</body></html>', 0],
    ['is not fooled by a bare percent sign', '<p>100% done</p>', 0],
    ['catches any VITE var, not just the token', '<b>%VITE_API_BASE%</b>', 1],
  ];
  let ok = true;
  for (const [name, html, want] of cases) {
    const got = [...html.matchAll(/%VITE_[A-Z0-9_]+%/g)].length ? 1 : 0;
    const pass = got === want;
    console.log(`  [${pass ? 'ok' : 'FAIL'}] ${name}`);
    ok = ok && pass;
  }
  console.log(ok ? 'self-test ok' : 'self-test FAILED');
  process.exit(ok ? 0 : 1);
}

const dist = process.argv[2] ?? 'dist';
const html = join(dist, 'index.html');

if (!existsSync(html)) {
  console.error(`[check-built-html] COULD NOT JUDGE: ${html} does not exist — build first. Exit 2.`);
  process.exit(2);
}

const src = readFileSync(html, 'utf8');
const leftovers = [...src.matchAll(/%VITE_[A-Z0-9_]+%/g)].map((m) => m[0]);

if (leftovers.length) {
  const unique = [...new Set(leftovers)];
  console.error(`[check-built-html] ${unique.length} unsubstituted placeholder(s) reached ${html}:`);
  for (const p of unique) console.error(`  ${p}  — the env var was not set at build time`);
  console.error('  Set it (VITE_X=… npm run build) or remove the reference. Exit 1.');
  process.exit(1);
}

// State which mode shipped, so an absent token is a STATED outcome rather than
// a silence someone discovers by viewing source in production.
console.log(
  `[check-built-html] ${html} clean — no unsubstituted placeholders. Origin-trial token: ` +
  (process.env.VITE_OT_TOKEN
    ? 'BAKED'
    : 'ABSENT — the page falls back to the polyfill and the StatusBar shows amber ' +
      'naming chrome://flags/#enable-webmcp-testing (a supported path, not a break)')
);
process.exit(0);
