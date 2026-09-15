/**
 * Puts TradingView's Charting Library where the chart page can load it, on a
 * machine that has no local copy — which is every build machine.
 *
 * The library is licensed: it is not in this repository and must not be. So a
 * deployment keeps its own copy somewhere private (a private repository's
 * tarball, an object store, a signed URL) and hands the build two variables:
 *
 *   CHARTING_LIBRARY_URL     a .tgz of the library directory
 *   CHARTING_LIBRARY_TOKEN   optional, sent as `Authorization: Bearer …`
 *
 * With no URL set this does nothing and says so: a laptop already has the
 * library from `npm run link:chart`, and a build without one draws the chart
 * page's "unavailable" line instead of failing the deploy.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';

const run = promisify(execFile);
const OUT = new URL('../public/static/charting_library/', import.meta.url);
const TMP = new URL('../public/static/.charting_library.tgz', import.meta.url);

const url = process.env.CHARTING_LIBRARY_URL;
if (!url) {
  console.log('CHARTING_LIBRARY_URL is not set; leaving the chart library as it is');
  process.exit(0);
}

// A copy already in place is the laptop's own: do not overwrite it.
try {
  await stat(new URL('charting_library.standalone.js', OUT));
  console.log('charting library already present; skipping the download');
  process.exit(0);
} catch {
  // nothing there yet, which is the case this script exists for
}

const token = process.env.CHARTING_LIBRARY_TOKEN;
const res = await fetch(url, {
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    // A GitHub release asset is served as JSON metadata unless this asks for
    // the bytes themselves.
    ...(/api\.github\.com/.test(url) ? { Accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28' } : {}),
  },
  redirect: 'follow',
});
if (!res.ok || !res.body) {
  // Loud, but not fatal. A site that will not deploy because a chart could
  // not be fetched is a worse outcome than a site with the chart page's
  // "unavailable" line on it; the build log says which happened.
  // Never print the URL: it can carry a signature.
  console.error(`charting library download failed: HTTP ${res.status} — building without a chart`);
  process.exit(0);
}

await mkdir(new URL('../public/static/', import.meta.url), { recursive: true });
await pipeline(Readable.fromWeb(res.body), createWriteStream(TMP));
await mkdir(OUT, { recursive: true });

// `--strip-components 1` so both shapes work: an archive of the directory and
// an archive of its contents under one wrapper (which is what GitHub sends).
try {
  await run('tar', ['xzf', TMP.pathname, '-C', OUT.pathname, '--strip-components', '1']);
} catch (e) {
  console.error(`charting library could not be unpacked: ${e.message} — building without a chart`);
}
await rm(TMP, { force: true });

try {
  await stat(new URL('charting_library.standalone.js', OUT));
  console.log('charting library fetched');
} catch {
  console.error('the archive had no charting_library.standalone.js — building without a chart');
}
