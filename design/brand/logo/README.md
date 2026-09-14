# TradeAgent mark

Generated — do not edit anything in this folder by hand. Change
`design/brand/mark.mjs` and run `node design/brand/export.mjs`.

The mark is a bull in shades inside a gun barrel, which is also a scope.

## Which file to use

| Need | File |
|---|---|
| Anywhere vector is possible | `svg/mark-terminal.svg` or `svg/mark-paper.svg` |
| Inside text, inheriting its colour | `svg/mark-mono.svg` |
| Print, stamp, sticker, sponsor wall | `svg/mark-black.svg` / `svg/mark-white.svg` |
| On a filled brand button or badge | `svg/mark-on-accent-*.svg` |
| iOS app icon | `app-icon/app-icon-<skin>-ios-180.png` |
| Android | `app-icon/app-icon-<skin>-android-192.png`, `-512`, `-maskable-512` |
| Store listing | `app-icon/app-icon-<skin>-store-1024.png` |
| Browser tab | `favicon/favicon-<skin>.ico` plus the PNGs beside it |
| Raster at a known size | `png/mark-<skin|black|white>-<size>.png` |

`<skin>` is `terminal` (dark, mint) or `paper` (off-white, purple) — whichever
theme the app ships in. See `design/path/tradeagent-proto.html` for both.

## Rules

- Never redraw the mark to fit a space: scale it.
- Keep clear space of at least half the mark's width on every side.
- Below 24px use a favicon or app-icon file, not a scaled-down large one.
- The accent may be dropped (the one-colour files), the structure may not.
