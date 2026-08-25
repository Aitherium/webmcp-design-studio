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
});
getStudioStore().subscribe((state) => {
  void registry.reconcile(state);
});
void registry.reconcile(getStudioStore().getState());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
