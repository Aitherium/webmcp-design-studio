/**
 * Brand tokens — dark-first design system values.
 *
 * Ported from the Aitherium design language (`.ELEMENT` tokens) as plain
 * constants so the SPA owns its theme without any runtime dependency.
 * The same values are exposed as CSS custom properties in `brand.css`.
 */
export const tokens = {
  /** Brand accent — cyan. */
  accent_primary: '#2AD7D7',
  /** Bridge accent — blue. */
  accent_bridge: '#1A83DB',
  /** Secondary accent — violet. */
  accent_secondary: '#907AE9',
  /** Deepest background. */
  bg_deep: '#000103',
  /** Base surface background. */
  bg_base: '#02060D',
  /** Raised surface background. */
  bg_surface: '#02060D',
  /** Elevated surface / border. */
  bg_elevated: '#162330',
  border: '#162330',
  text_primary: '#EEEEEE',
  text_secondary: '#9BA6B1',
  text_muted: '#69737D',
  success: '#70DDB1',
  warn: '#EAB532',
  danger: '#FF9189',
} as const;

export type BrandToken = keyof typeof tokens;

/** The four studio design palettes — canvas backgrounds reuse these. */
export type PaletteId = 'neon' | 'paper' | 'ocean' | 'ember';

export interface DesignPalette {
  id: PaletteId;
  /** Human/agent-facing name. */
  name: string;
  /** Flat canvas background color. */
  background: string;
  /** Two-stop gradient used when a design asks for a `gradient` background. */
  gradient: readonly [string, string];
  /** Primary accent (headlines, buttons). */
  accent: string;
  /** Secondary accent (sub-lines). */
  accentAlt: string;
  /** Default element text color on this palette. */
  text: string;
  /** Muted text color. */
  muted: string;
  /** Card/surface color on this palette. */
  surface: string;
}

export const DESIGN_PALETTES: Record<PaletteId, DesignPalette> = {
  neon: {
    id: 'neon',
    name: 'Neon',
    background: '#02060D',
    gradient: ['#02060D', '#0A1A2F'],
    accent: '#2AD7D7',
    accentAlt: '#907AE9',
    text: '#EEEEEE',
    muted: '#9BA6B1',
    surface: '#0A0F1A',
  },
  paper: {
    id: 'paper',
    name: 'Paper',
    background: '#F7F3EA',
    gradient: ['#F7F3EA', '#E8E0D0'],
    accent: '#1A83DB',
    accentAlt: '#C24A2E',
    text: '#1C1A17',
    muted: '#6B6459',
    surface: '#FFFFFF',
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    background: '#02121F',
    gradient: ['#02121F', '#06324F'],
    accent: '#4FC3F7',
    accentAlt: '#70DDB1',
    text: '#EAF6FF',
    muted: '#8FB4C8',
    surface: '#07202F',
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    background: '#170A07',
    gradient: ['#170A07', '#3A1508'],
    accent: '#FF9189',
    accentAlt: '#EAB532',
    text: '#FFF0EA',
    muted: '#C9A79E',
    surface: '#24110B',
  },
};

/** Design sizes (px). `flyer` is the classic US-letter landscape ratio. */
export const DESIGN_SIZES = {
  poster: { width: 1080, height: 1440 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  flyer: { width: 2100, height: 1485 },
} as const;

export type DesignSizeId = keyof typeof DESIGN_SIZES;

export const DESIGN_SIZE_IDS = Object.keys(DESIGN_SIZES) as DesignSizeId[];
export const PALETTE_IDS = Object.keys(DESIGN_PALETTES) as PaletteId[];
