import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './brand/brand.css';
import './index.css';
import App from './App.tsx';
import { installModelContextPolyfill } from './webmcp/polyfill';
import { detectSurface, ToolRegistry } from './webmcp/registry';
import { getStudioStore } from './state/store';
import './dev/scriptedAgent'; // window.__judgeScript()

/**
 * WebMCP bootstrap:
 * 1. polyfill when no real API exists (document.modelContext, pre-150
 *    navigator.modelContext fallback) so the studio works everywhere;
 * 2. one ToolRegistry over that surface, reconciled after every store
 *    change — tools appear/disappear as design state changes.
 */
installModelContextPolyfill();
const registry = new ToolRegistry(detectSurface, {
  onStatus: (status) => getStudioStore().getState().setWebMCPStatus(status),
  onToolsChanged: (names) => getStudioStore().getState().setLiveTools(names),
  onTrace: (event) => getStudioStore().getState().pushProtocolTrace(event),
});
getStudioStore().subscribe((state, prev) => {
  // Reconcile only on DESIGN-state changes. The registry's own writes
  // (setWebMCPStatus / setLiveTools) also notify subscribers, and
  // reconcile() unconditionally re-emits status at the end — reconciling on
  // those would loop forever (measured 2026-08-26: reconcile→emitStatus→
  // setState→subscriber→reconcile starved the event loop before first
  // paint in Chrome). Tool availability only depends on the design slice,
  // so skipping the status/tools writes loses nothing.
  if (state.docs !== prev.docs || state.pendingBatch !== prev.pendingBatch ||
      state.currentDocId !== prev.currentDocId) {
    void registry.reconcile(state);
  }
});
void registry.reconcile(getStudioStore().getState());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
