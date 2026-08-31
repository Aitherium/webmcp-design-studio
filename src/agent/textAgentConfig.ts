/**
 * The BYOK text-agent configuration (WebMCP Challenge 2026-08-30): a visitor
 * can drive the studio's 14 WebMCP tools with their OWN OpenAI-compatible
 * endpoint + API key + model, alongside the on-device Bonsai lane and the
 * fleet brain. Persisted per browser so the choice survives reloads (the
 * same pattern as the image provider panel).
 */
export type TextAgentMode = 'on-device' | 'fleet' | 'custom';

export interface TextAgentConfig {
  mode: TextAgentMode;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const TEXT_AGENT_KEY = 'webmcp.textAgent.v1';

export function loadTextAgentConfig(): TextAgentConfig {
  try {
    const raw = localStorage.getItem(TEXT_AGENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TextAgentConfig>;
      if (parsed.mode === 'on-device' || parsed.mode === 'fleet' || parsed.mode === 'custom') {
        return {
          mode: parsed.mode,
          baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
          apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
          model: typeof parsed.model === 'string' ? parsed.model : '',
        };
      }
    }
  } catch {
    /* corrupt storage — default */
  }
  // Default: on the PUBLIC origins the FLEET brain is the first-visit default
  // — instant, no model download, no consent chip; a judge lands and clicks a
  // starter chip (measured 2026-08-31: the on-device default made the first
  // demo wait minutes for the 4B). On-device stays the default everywhere
  // else (localhost dev, private deployments) where speed of first use is not
  // the demo. A stored choice always wins over the default.
  const isPublicOrigin =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'studio.aitherium.com' ||
      window.location.hostname === 'studio-preview.aitherium.com');
  return { mode: isPublicOrigin ? 'fleet' : 'on-device', baseUrl: '', apiKey: '', model: '' };
}

export function saveTextAgentConfig(cfg: TextAgentConfig): void {
  try {
    localStorage.setItem(TEXT_AGENT_KEY, JSON.stringify(cfg));
  } catch {
    /* quota / private mode — the session continues, unsaved */
  }
}
