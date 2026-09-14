/**
 * The TradeAgent mark — the single source of truth for the logo.
 *
 * A bull in shades inside the gun barrel every spy title has opened with since
 * 1962, which is also a scope. Drawn on a 64x64 grid.
 *
 * `ink` is the structural colour, `acc` the one accent. Passing the same value
 * for both gives the one-colour version, which is the one that has to survive
 * a stamp, a sticker and a monochrome sponsor wall.
 *
 * Everything in design/brand/logo/ is generated from this file by export.mjs —
 * never edit an exported asset by hand.
 */

/** Head-on portrait: horns, wraparound shades, bow tie. */
export const portrait = (ink, acc) => `
  <path d="M18.4 24.6C13 23 8 19.6 5.4 13.4c5.6 3 10.2 6 14.2 8Z" fill="${ink}"/>
  <path d="M45.6 24.6c5.4-1.6 10.4-5 13-11.2-5.6 3-10.2 6-14.2 8Z" fill="${ink}"/>
  <path d="M18 26c0-5 3.5-8 8-8.5h12c4.5.5 8 3.5 8 8.5v6c0 9-5.5 15.5-14 18-8.5-2.5-14-9-14-18Z" fill="${ink}"/>
  <path d="M20.5 29 43.5 27.4l.5 5.1c-4 4-8 5-10.4 2.3-1-1-2.2-1-3.2 0-2.4 2.7-6.4 1.7-10.4-2.3Z" fill="${acc}"/>
  <path d="M32 51.2 24.5 56v-7.4L32 51.4l7.5-2.8V56Z" fill="${acc}"/>`;

/** The full mark: the portrait inside the barrel. */
export const mark = (ink, acc) => `
  <circle cx="32" cy="32" r="26.5" fill="none" stroke="${acc}" stroke-width="3"/>
  <path d="M32 5.5v4.4M58.5 32h-4.4M32 58.5v-4.4M5.5 32h4.4"
        fill="none" stroke="${acc}" stroke-width="2.1" stroke-linecap="round"/>
  <g transform="translate(11.5 10.5) scale(0.64)">${portrait(ink, acc)}</g>`;

/** A standalone .svg document. */
export const svg = (ink, acc, { size = 64, title = 'TradeAgent' } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${title}">
  <title>${title}</title>
${mark(ink, acc).trim().split('\n').map((l) => '  ' + l.trim()).join('\n')}
</svg>
`;

/** Brand colours, lifted from the two skins the app can wear. */
export const PALETTE = {
  terminal: { ink: '#E4F3F0', acc: '#50D2C1', bg: '#060F0D', onAcc: '#05201C' },
  paper: { ink: '#0E100F', acc: '#836EF9', bg: '#FBFAF9', onAcc: '#FFFFFF' },
};
