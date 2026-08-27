// Built by build_webml_cdn.mjs — the app ships a copy at public/workers/.
import('https://weights.aitherium.com/webml-text.esm.js?v=2')
  .then((m) => m.runWebMLWorker(self, { loadTransformers: null }))
  .catch((e) => self.postMessage({ type: "error", message: "runtime import failed: " + (e && e.message) }));
