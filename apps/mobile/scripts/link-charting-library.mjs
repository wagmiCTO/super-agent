// Copies TradingView's Charting Library into public/static/charting_library
// so the chart page can load it. The library is licensed and gitignored:
// point CHARTING_LIBRARY_DIR at a local copy (the licensee's own).
import { cp, stat } from 'node:fs/promises';

const src = process.env.CHARTING_LIBRARY_DIR;
if (!src) {
  console.error('CHARTING_LIBRARY_DIR is not set; the chart page will not load a library');
  process.exit(1);
}
await stat(`${src}/charting_library.standalone.js`);
await cp(src, new URL('../public/static/charting_library/', import.meta.url), { recursive: true });
console.log(`charting library copied from ${src}`);
