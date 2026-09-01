/**
 * Return convention for every tool: the MCP-style content shape from the
 * WebMCP README examples — `{content: [{type: 'text', text}]}`. The browser
 * JSON-stringifies whatever execute returns; this shape is what ChatGPT-style
 * agents parse natively, so we follow it everywhere.
 *
 * `isError` is the MCP-standard failure signal (absent/omitted = success for
 * any hand-built result). The registry's execute wrapper reads it, so the
 * protocol feed's verdict reflects the tool's OWN answer — a `fail()` return
 * records ✗, never ✓.
 */

export interface ToolResult {
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}

export function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: false };
}

export function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
