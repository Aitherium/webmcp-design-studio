/**
 * Return convention for every tool: the MCP-style content shape from the
 * WebMCP README examples — `{content: [{type: 'text', text}]}`. The browser
 * JSON-stringifies whatever execute returns; this shape is what ChatGPT-style
 * agents parse natively, so we follow it everywhere.
 */

export interface ToolResult {
  content: [{ type: 'text'; text: string }];
}

export function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}
