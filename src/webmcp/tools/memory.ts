/**
 * Preference memory tools: remember-preference / recall-preference.
 * Persisted in IndexedDB scoped `studio:prefs:{key}` — survives reloads.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getPref, setPref } from '../../state/memory';
import { ToolError, argString } from './helpers';

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

export const MEMORY_TOOLS: ToolDefinition[] = [rememberPreferenceTool, recallPreferenceTool];
