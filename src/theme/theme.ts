import { Platform, useColorScheme, useWindowDimensions, type TextStyle } from 'react-native';
import { useStore } from '@/data/store';

/*
 * Bachat "Black & gold" palette (GOLD_SPEC.md): black page, near-black cards,
 * white text, gold #D4AF37 only as an accent. Dark is the default.
 * Green / red are only for meaning: on track / over.
 */
export interface Colors {
  page: string;
  card: string;
  /** Selected pills, inputs, bar tracks. */
  muted: string;
  border: string;
  text: string;
  textMuted: string;
  /** Axis labels, dashed lines, disabled. */
  textFaint: string;
  accent: string;
  /** Text/icons drawn on the accent. */
  onAccent: string;
  accentSoft: string;
  good: string;
  goodSoft: string;
  bad: string;
  badSoft: string;
  warn: string;
  warnSoft: string;
  purple: string;
  /** Scrim behind sheets/menus. */
  scrim: string;
  dark: boolean;
}

/** "Black & gold" (default): mostly black and white; gold only for links, primary buttons, the logo and headline lines. */
export const DARK: Colors = {
  page: '#000000',
  card: '#0D0D0D',
  muted: '#1F1F1F',
  border: '#262626',
  text: '#FFFFFF',
  textMuted: '#A6A6A6',
  textFaint: '#5E5E5E',
  accent: '#D4AF37',
  onAccent: '#000000',
  /** Use sparingly — never for big fills. */
  accentSoft: '#2A2410',
  good: '#4CC38A',
  goodSoft: '#12261C',
  bad: '#E5484D',
  badSoft: '#2B1214',
  warn: '#D4AF37',
  warnSoft: '#2A2410',
  purple: '#B9A2F0',
  scrim: 'rgba(0,0,0,0.7)',
  dark: true,
};

/** Light variant: warm white page, dark gold accent (AA on white). */
export const LIGHT: Colors = {
  page: '#FAFAF7',
  card: '#FFFFFF',
  muted: '#F1EFEA',
  border: '#E7E5DF',
  text: '#000000',
  textMuted: '#4B4A48',
  textFaint: '#8A8884',
  accent: '#8C6D17',
  onAccent: '#FFFFFF',
  accentSoft: '#F4EBD3',
  good: '#1E7F5A',
  goodSoft: '#E3F2EA',
  bad: '#C8323F',
  badSoft: '#FBE6E8',
  warn: '#8C6D17',
  warnSoft: '#F4EBD3',
  purple: '#7A5CC8',
  scrim: 'rgba(0,0,0,0.35)',
  dark: false,
};

/** Settings → Appearance → Accent "White": plain white (dark) / black (light) instead of gold. */
const DARK_MONO: Colors = { ...DARK, accent: '#FFFFFF', onAccent: '#000000', accentSoft: '#1F1F1F' };
const LIGHT_MONO: Colors = { ...LIGHT, accent: '#000000', onAccent: '#FFFFFF', accentSoft: '#F1EFEA' };

/** Current colours: Settings → Appearance (Dark / Light / System, Gold / White accent). Returns stable objects. */
export function useColors(): Colors {
  const choice = useStore((s) => s.settings.theme);
  const accent = useStore((s) => s.settings.accent);
  const system = useColorScheme();
  const light = choice === 'light' || (choice === 'system' && system === 'light');
  if (accent === 'white') return light ? LIGHT_MONO : DARK_MONO;
  return light ? LIGHT : DARK;
}

/** Selected tab / sidebar pill: white with black text (dark), black with white text (light). */
export function selectedPill(c: Colors): { bg: string; fg: string } {
  return { bg: c.text, fg: c.page };
}

/** Optional serif for big hero numbers (Settings → Appearance → Large numbers: Serif). */
export const SERIF_FONT: string =
  Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' }) ?? 'Georgia';

/** Money amounts: the app's sans, tabular digits so columns of amounts line up. */
export const AMOUNT_STYLE: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Style for big hero numbers. Default (and the same on phone and laptop): the
 * app's sans, bold, tabular digits. "serif" is an opt-in Appearance choice.
 */
export function heroFont(numberFont: 'serif' | 'sans' | undefined): TextStyle {
  return numberFont === 'serif'
    ? { fontFamily: SERIF_FONT, fontWeight: '600', fontVariant: ['tabular-nums'] }
    : { fontWeight: '700', fontVariant: ['tabular-nums'] };
}

const HERO_SERIF: TextStyle = heroFont('serif');
const HERO_SANS: TextStyle = heroFont('sans');

/** Hook form of heroFont() that follows the user's setting (stable object). */
export function useHeroFont(): TextStyle {
  const f = useStore((s) => s.settings.numberFont);
  return f === 'serif' ? HERO_SERIF : HERO_SANS;
}

/** ≥ 840 px wide (laptop / tablet / desktop browser): sidebar + two columns. */
export const WIDE_BREAKPOINT = 840;

export function useWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}

/** Chart series colours for dashboard-style charts (dark and light sets, same order). */
const SERIES_DARK = ['#2F80ED', '#F2994A', '#BB6BD9', '#27AE60', '#00CEC9', '#F2C94C', '#E84393', '#22A6F2', '#FF7F50', '#9B51E0', '#A3E635', '#3CB371'];
const SERIES_LIGHT = ['#1E5BD9', '#C75A00', '#8E24AA', '#1E7F5A', '#007EA7', '#E09B00', '#D81B60', '#0277BD', '#E76F2F', '#6A1B9A', '#6B8F00', '#2E8B57'];

export function seriesColor(i: number, dark: boolean): string {
  const list = dark ? SERIES_DARK : SERIES_LIGHT;
  return list[((i % list.length) + list.length) % list.length];
}

/** Category chip tints (stable per name; "Others" grey). */
const CHIP_TINTS = ['#A78BFA', '#F5B83D', '#2DD4BF', '#F472B6', '#60A5FA', '#A3E635', '#FB923C'];
export function chipTint(name: string): string {
  const k = name.trim().toLowerCase();
  if (!k || k.startsWith('other')) return '#94A3B8';
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return CHIP_TINTS[Math.abs(h) % CHIP_TINTS.length];
}

export const FONT = {
  /** Big numbers and page heroes. */
  hero: 34,
  title: 20,
  body: 15,
  small: 13,
  tiny: 11,
};
