// Built by build_webml_cdn.mjs — the app ships a copy at public/workers/ AND at
// public/ root, because the runtime factory resolves DEFAULT_ENTRY_URL =
// './bonsai-worker-entry.js' relative to the bundle's own URL (the site root).
// Same-origin import on purpose: the worker chain must not depend on the CDN
// (weights.aitherium.com) — the studio is self-contained on the host that serves it.
// The startup heartbeat disarms the loader's no-message timeout: it measures
// "did the worker start", not "did the load finish" (slow-but-alive must not
// read as dead — measured 2026-08-27).
self.postMessage({ type: "status", phase: "worker-started" });
import('/webml-text.esm.js?v=2')
  .then((m) => m.runWebMLWorker(self, { loadTransformers: null }))
  .catch((e) => self.postMessage({ type: "error", message: "runtime import failed: " + (e && e.message) }));
