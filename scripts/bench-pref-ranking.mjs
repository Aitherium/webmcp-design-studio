// Ranking bench for search-preferences: 12 realistic studio preferences x 12 agent questions,
// scored top-1 with the REAL shipped embedder in host Chromium (node scripts/bench-pref-ranking.mjs
// from a tree with playwright installed).
// Baseline 2026-09-03, aither-code-embed (code-search student): 6/12 top-1 for EVERY variant --
// shipped code prefix, raw query, a prefs-tuned Instruct prefix, and lexical hybrids at 0.15/0.3.
// Inference-time levers are exhausted; the misses are semantic (business name vs audience, slogan
// vs logo style, phone vs audience). The fix is a preferences-trained embedder; this file is its
// acceptance test. Do not lower the bar to make a number move.
import { chromium } from 'playwright';
const PREFS = [
  ['brand_color','#ff6600 burnt orange'],['secondary_color','deep navy #1a2b4c'],['store_name',"Garg's Repair Shop"],
  ['store_address','12 Main St, Portland, OR'],['phone','+1 503 555 0142'],['tagline','Fast honest repairs'],
  ['font_preference','Inter for body, Space Grotesk for headings'],['tone','friendly, plain-spoken, no jargon'],
  ['logo_style','flat monochrome mark, no gradients'],['opening_hours','Mon-Sat 9am-6pm'],
  ['target_audience','small-business owners and homeowners'],['social_handle','@gargrepairs on Instagram'],
];
const QUERIES = [
  ['what colour does the user like','brand_color'],['the second colour in the palette','secondary_color'],
  ['what is the business called','store_name'],['where is the shop located','store_address'],
  ['how do customers call them','phone'],['slogan','tagline'],['which typeface for headlines','font_preference'],
  ['how should the copy sound','tone'],['how should the logo look','logo_style'],['when are they open','opening_hours'],
  ['who are we designing for','target_audience'],['instagram account','social_handle'],
];
// WEIGHTS_URL lets a candidate GGUF be scored in the REAL runtime before the studio ships it
// (2026-09-03: the aither-studio-embed recipe trains with an EMPTY query prefix, so the
// candidate is scored on the 'raw (no prefix)' row; the shipped code-embed on its prefix row).
const WEIGHTS = process.env.WEIGHTS_URL || 'https://artifact.aitherium.com/aither-code-embed-v1/aither-code-embed.q4_k_m.gguf';
console.log('weights:', WEIGHTS);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://studio.aitherium.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
const out = await page.evaluate(async ({ PREFS, QUERIES, WEIGHTS }) => {
  const w = new Worker('/workers/code-embed-wasm-worker.js');
  const pending = new Map(); let seq = 0;
  const ready = new Promise((res, rej) => { w.addEventListener('message', e => { const m = e.data; if (m.type==='ready') res(); if (m.type==='error') rej(new Error(m.message)); if (m.type==='embed-result'||m.type==='embed-error') { const p = pending.get(m.requestId); if (!p) return; pending.delete(m.requestId); m.type==='embed-result' ? p.res(m.vectors) : p.rej(new Error(m.error)); } }); });
  w.postMessage({ type: 'load', modelId: WEIGHTS });
  const t0 = Date.now(); await ready; const loadMs = Date.now() - t0;
  const embed = (texts, mode) => new Promise((res, rej) => { const id = 'r' + (++seq); pending.set(id, { res, rej }); w.postMessage({ type: 'embed', requestId: id, texts, mode }); });
  const cos = (a, b) => { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/Math.sqrt(na*nb); };
  const STOP = new Set(['the','a','an','is','are','do','does','what','which','who','how','when','where','for','of','to','in','on','they','them','we','user','like','should','their','and','or']);
  const norm = t => t.replace(/our$/, 'or').replace(/s$/, '');
  const toks = s => s.toLowerCase().split(/[^a-z0-9@#]+/).filter(t => t && !STOP.has(t)).map(norm);
  const lex = (q, d) => { const Q = toks(q), D = new Set(toks(d)); if (!Q.length) return 0; let hit = 0; for (const t of Q) if (D.has(t)) hit++; return hit / Q.length; };
  const docs = PREFS.map(([k, v]) => `${k}: ${v}`);
  const docVecs = await embed(docs, 'document');
  const variants = {
    'code-prefix (shipped)': await embed(QUERIES.map(q => q[0]), 'query'),
    'raw (no prefix)': await embed(QUERIES.map(q => q[0]), 'document'),
    'prefs-instruct': await embed(QUERIES.map(q => `Instruct: Given a question about a user's saved design preferences, retrieve the preference that answers it\nQuery: ${q[0]}`), 'document'),
  };
  const score = (qvs, lexW) => { let top1 = 0, margins = []; const misses = []; for (let i = 0; i < QUERIES.length; i++) { const rows = PREFS.map(([k], j) => ({ k, s: cos(qvs[i], docVecs[j]) + lexW * lex(QUERIES[i][0], docs[j]) })).sort((x, y) => y.s - x.s); if (rows[0].k === QUERIES[i][1]) top1++; else misses.push(`${QUERIES[i][0]} -> ${rows[0].k} (want ${QUERIES[i][1]})`); margins.push(rows[0].s - rows[1].s); } return { top1: `${top1}/${QUERIES.length}`, meanMargin: +(margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(4), misses }; };
  const table = {};
  for (const [name, qvs] of Object.entries(variants)) for (const lw of [0, 0.15, 0.3]) table[`${name} + lex*${lw}`] = score(qvs, lw);
  return { loadMs, table };
}, { PREFS, QUERIES, WEIGHTS });
console.log('load ms:', out.loadMs);
for (const [k, v] of Object.entries(out.table)) console.log(k.padEnd(34), 'top1', v.top1, 'margin', v.meanMargin, v.misses.length ? ' misses: ' + v.misses.join(' | ') : '');
await browser.close();
