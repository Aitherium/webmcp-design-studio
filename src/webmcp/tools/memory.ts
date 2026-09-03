/**
 * Preference memory tools: remember-preference / recall-preference.
 * Persisted in IndexedDB scoped `studio:prefs:{key}` — survives reloads.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getPref, setPref } from '../../state/memory';
import { ToolError, argNumber, argString } from './helpers';
import { EmbedderUnavailableError, searchPrefs } from '../../webml/prefEmbedder';

export const rememberPreferenceTool: ToolDefinition = {
  name: 'remember-preference',
  title: 'Remember preference',
  description:
    'Persist a preference (for example the user\'s brand color, store name, or address) scoped to this studio. Survives reloads. Use recall-preference to read it back later.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', maxLength: 100, description: 'Preference key (e.g. brand_color)' },
      value: { type: 'string', maxLength: 5000, description: 'Preference value' },
    },
    required: ['key', 'value'],
  },
  async execute(args) {
    try {
      const key = argString(args, 'key', { required: true, maxLength: 100 })!;
      const value = argString(args, 'value', { required: true, maxLength: 5000 })!;
      await setPref(key, value);
      return ok(JSON.stringify({ saved: true, key }));
    } catch (err) {
      return fail(`could not save preference: ${err instanceof ToolError ? err.message : String(err)}`);
    }
  },
};

export const recallPreferenceTool: ToolDefinition = {
  name: 'recall-preference',
  title: 'Recall preference',
  description: 'Recall a previously saved preference. Returns {key, value} or {key, found: false}.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', maxLength: 100, description: 'Preference key (e.g. brand_color)' },
    },
    required: ['key'],
  },
  annotations: { readOnlyHint: true },
  async execute(args) {
    try {
      const key = argString(args, 'key', { required: true, maxLength: 100 })!;
      const value = await getPref(key);
      if (value === null) return ok(JSON.stringify({ key, found: false }));
      return ok(JSON.stringify({ key, value }));
    } catch (err) {
      return fail(`could not recall preference: ${err instanceof ToolError ? err.message : String(err)}`);
    }
  },
};

export const searchPreferencesTool: ToolDefinition = {
  name: 'search-preferences',
  title: 'Search preferences by meaning',
  description:
    'Find saved preferences by MEANING, not exact key: "what did the user say about colours" finds ' +
    'brand_color. Ranks every remembered preference with the aither-code-embed model (0.6B, 1024-dim) ' +
    'running INSIDE this tab; nothing leaves the device. The 396 MB model downloads once, only after ' +
    'the human has accepted the on-device consent chip in the agent panel; without that consent this ' +
    'tool returns an error naming it, and recall-preference (exact key) still works. An empty store ' +
    'answers instantly with no download. Returns {query, results:[{key,value,score}], searched}.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', maxLength: 500, description: 'Natural-language question or topic' },
      limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Max results (default 5)' },
    },
    required: ['query'],
  },
  annotations: { readOnlyHint: true },
  async execute(args) {
    try {
      const query = argString(args, 'query', { required: true, maxLength: 500 })!;
      const limit = argNumber(args, 'limit', { min: 1, max: 10, integer: true }) ?? 5;
      const result = await searchPrefs(query, { limit });
      return ok(JSON.stringify(result));
    } catch (err) {
      const msg = err instanceof ToolError || err instanceof EmbedderUnavailableError ? err.message : String(err);
      return fail(`could not search preferences: ${msg}`);
    }
  },
};

export const MEMORY_TOOLS: ToolDefinition[] = [
  rememberPreferenceTool,
  recallPreferenceTool,
  searchPreferencesTool,
];
