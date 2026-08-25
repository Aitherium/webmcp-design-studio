/**
 * Vitest setup — runs before every test file in the jsdom environment.
 * Installs the in-memory IndexedDB fake so `state/memory.ts` exercises its
 * real IndexedDB code path (open/upgrade/transaction/put/get/clear).
 */
import { createFakeIndexedDB } from './fake-indexeddb';

Object.defineProperty(globalThis, 'indexedDB', {
  value: createFakeIndexedDB(),
  configurable: true,
  writable: true,
});
