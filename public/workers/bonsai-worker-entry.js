// Built by build_webml_cdn.mjs — the app ships a copy at public/workers/.
import { runWebMLWorker } from 'https://weights.aitherium.com/webml-text.esm.js';
// transformers.js is never needed for the Bonsai clean-room kernels runtime.
runWebMLWorker(self, { loadTransformers: null });
