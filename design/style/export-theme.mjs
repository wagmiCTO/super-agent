/**
 * Turns the prototype's token blocks into the app's theme.
 *
 *   node design/style/export-theme.mjs
 *
 * The prototype is where a theme is designed and argued about; this copies the
 * settled values into `apps/mobile/src/constants/theme.ts` so the two cannot
 * drift. Never hand-edit the generated file — change the `:root` blocks in
 * `design/path/tradeagent-proto.html` and run this.
 *
 * The gray set is deliberately left behind: it is the prototype's control for
 * user runs, not a skin the app ships.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTO = join(HERE, '..', 'path', 'tradeagent-proto.html');
const OUT = join(HERE, '..', '..', 'apps', 'mobile', 'src', 'constants', 'theme.ts');

const html = readFileSync(PROTO, 'utf8');

const block = (selector) => {
  const m = new RegExp(`${selector} \\{([\\s\\S]*?)\\n  \\}`).exec(html);
  if (!m) throw new Error(`no token block for ${selector}`);
  return Object.fromEntries([...m[1].matchAll(/(--[a-zA-Z0-9-]+):\s*([^;]+);/g)]
    .map(([, k, v]) => [k, v.trim()]));
};

/** Resolve `var(--x)` chains down to literal values. */
const resolve = (t) => {
  const out = { ...t };
  for (let pass = 0; pass < 6; pass++)
    for (const k of Object.keys(out))
      out[k] = out[k].replace(/var\((--[a-zA-Z0-9-]+)\)/g, (m, ref) => out[ref] ?? m);
  return out;
};

const GRAY = block(':root');
const THEMES = {
  paper: resolve({ ...GRAY, ...block('html\\[data-theme="paper"\\]') }),
  terminal: resolve({ ...GRAY, ...block('html\\[data-theme="terminal"\\]') }),
};

// ------------------------------------------------------------------ shaping
// CSS says "16px"; React Native wants 16. CSS says a font stack; React Native
// wants one family name per weight, because fontWeight does not pick a face
// for a custom font on Android.

const px = (v) => {
  const n = Number(String(v).replace('px', ''));
  if (!Number.isFinite(n)) throw new Error(`not a length: ${v}`);
  return n;
};

const COLOR = ['ground', 'paper', 'raised', 'soft', 'line', 'hair',
  'ink', 'body', 'text2', 'muted', 'dim', 'onInk',
  'accent', 'onAccent', 'fill', 'onFill',
  'up', 'onUp', 'down', 'onDown',
  'danger', 'onDanger', 'danger-soft',
  'scrim', 'glass', 'glow', 'chip', 'onChip',
  'shadow-phone', 'shadow-menu', 'ring', 'ring-0',
  'chart-line', 'chart-line2', 'chart-grid', 'chart-axis',
  'chart-up', 'chart-down', 'chart-zone', 'chart-band',
  'btn-line', 'card-bg', 'card-line', 'onAccentDim',
  'risk-calm', 'risk-warm', 'risk-hot'];

const RADIUS = ['r-xs', 'r-sm', 'r-md', 'r-lg', 'r-xl'];
const SPACE = ['s1', 's2', 's3', 's4', 's5', 's6'];
const TYPE = ['t-2xs', 't-xs', 't-sm', 't-md', 't-lg', 't-xl', 't-2xl', 't-3xl', 't-hero', 't-mega'];
const SIZE = ['btn-h', 'ud-h', 'bw'];

/** camelCase, because `theme.riskCalm` reads better than `theme['risk-calm']`. */
const camel = (k) => k.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

// The faces each skin asks for, mapped to the families expo-google-fonts
// registers. A weight the family does not ship snaps to its nearest sibling.
const FACES = {
  paper: {
    display: { 400: 'SpaceGrotesk_400Regular', 500: 'SpaceGrotesk_500Medium', 600: 'SpaceGrotesk_600SemiBold', 700: 'SpaceGrotesk_700Bold' },
    num: { 400: 'SpaceMono_400Regular', 500: 'SpaceMono_400Regular', 600: 'SpaceMono_700Bold', 700: 'SpaceMono_700Bold' },
  },
  terminal: {
    display: { 400: 'Archivo_400Regular', 500: 'Archivo_500Medium', 600: 'Archivo_600SemiBold', 700: 'Archivo_700Bold' },
    num: { 400: 'JetBrainsMono_400Regular', 500: 'JetBrainsMono_400Regular', 600: 'JetBrainsMono_600SemiBold', 700: 'JetBrainsMono_700Bold' },
  },
};

// expo-google-fonts lays each face out as <weightDir>/<Family_Weight>.ttf.
const PKG = { SpaceGrotesk: 'space-grotesk', SpaceMono: 'space-mono', Archivo: 'archivo', JetBrainsMono: 'jetbrains-mono' };
const fontRequire = (family) => {
  const [name, weight] = family.split('_');
  return `require('@expo-google-fonts/${PKG[name]}/${weight}/${family}.ttf')`;
};
const FONT_LIST = [...new Set(
  Object.values(FACES).flatMap((skin) => Object.values(skin).flatMap((kind) => Object.values(kind))),
)].sort().map((f) => `  ${f}: ${fontRequire(f)},`).join('\n');

const shape = (name) => {
  const t = THEMES[name];
  const pick = (keys, fn) => Object.fromEntries(keys.map((k) => [camel(k), fn(t[`--${k}`], k)]));
  return {
    color: pick(COLOR, (v, k) => { if (v === undefined) throw new Error(`${name}: missing --${k}`); return v; }),
    radius: pick(RADIUS, px),
    space: pick(SPACE, px),
    type: pick(TYPE, px),
    size: pick(SIZE, px),
    heading: { weight: Number(t['--h1-weight']), tracking: Number(String(t['--h1-track']).replace('em', '')) },
    tracking: Number(String(t['--track']).replace('em', '')),
    elevated: t['--elev'] !== 'none',
    faces: FACES[name],
  };
};

const shaped = { paper: shape('paper'), terminal: shape('terminal') };

// ------------------------------------------------------------------- emit

const union = (keys) => keys.map((k) => `'${camel(k)}'`).join(' | ');
const j = (v, indent) => JSON.stringify(v, null, 2).split('\n').join('\n' + ' '.repeat(indent));

const body = `/**
 * GENERATED by \`node design/style/export-theme.mjs\` — do not edit.
 *
 * The values come from the token blocks in
 * \`design/path/tradeagent-proto.html\`, which is where a theme is designed.
 * Change them there and re-run, or the app and the prototype drift apart.
 *
 * Two rules the token names encode, worth keeping in mind when using them:
 *
 *  - \`fill\`/\`onFill\` is the strong filled surface (primary button, banner);
 *    \`accent\`/\`onAccent\` is the brand mark. They are the same colour in one
 *    skin and different in the other, so never substitute one for the other.
 *  - \`up\`/\`down\` are market direction and \`riskCalm\`/\`riskWarm\`/\`riskHot\`
 *    are how much can still go wrong. A hot day happens on winning positions
 *    too, so these never share a token.
 */

/** Every family the two skins need; load them all before rendering. */
export const FONT_FACES = {
${FONT_LIST}
} as const;

export type ThemeName = 'paper' | 'terminal';

export type ThemeColor = ${union(COLOR)};
type RadiusKey = ${union(RADIUS)};
type SpaceKey = ${union(SPACE)};
type TypeKey = ${union(TYPE)};
type SizeKey = ${union(SIZE)};
export type Weight = 400 | 500 | 600 | 700;

/**
 * Declared rather than inferred: with \`as const\` each skin gets its own
 * literal types, and indexing the union of the two collapses to \`never\`.
 */
export type Theme = {
  color: Record<ThemeColor, string>;
  radius: Record<RadiusKey, number>;
  space: Record<SpaceKey, number>;
  type: Record<TypeKey, number>;
  size: Record<SizeKey, number>;
  heading: { weight: number; tracking: number };
  tracking: number;
  elevated: boolean;
  faces: { display: Record<Weight, string>; num: Record<Weight, string> };
};

export const Themes: Record<ThemeName, Theme> = {
  paper: ${j(shaped.paper, 2)},
  terminal: ${j(shaped.terminal, 2)},
};

/** Paper ships first; Terminal exists so hardcoded values fail loudly. */
export const DEFAULT_THEME: ThemeName = 'paper';

/**
 * React Native picks a face by family name, not by \`fontWeight\`: on Android a
 * weight on a custom family is ignored. Always go through this.
 */
export function face(theme: Theme, kind: 'display' | 'num', weight: Weight = 400): string {
  return theme.faces[kind][weight];
}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, body);

const n = Object.keys(shaped.paper.color).length;
console.log(`theme.ts written — 2 skins, ${n} colours + ${RADIUS.length + SPACE.length + TYPE.length + SIZE.length} metrics each`);
