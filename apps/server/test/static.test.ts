import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCaravanServer, WEB_ROOT, type CaravanServer } from '../src/server.js';

/**
 * The static half of the server: caching, conditional requests, and the range
 * support media playback depends on. These run against the real `web/dist`, so
 * they need a built client — without one every request is a 503 and the suite
 * skips rather than fails, the same way it would on a fresh checkout.
 */

let server: CaravanServer;
let base: string;

/**
 * Some content-hashed file Vite actually emitted, whatever this build has.
 * Resolved at collection time, because that is when `skipIf` reads it.
 */
const asset = (() => {
  try {
    return readdirSync(join(WEB_ROOT, 'assets'))[0];
  } catch {
    return undefined;
  }
})();

beforeAll(async () => {
  server = createCaravanServer();
  await new Promise<void>((done) => server.http.listen(0, () => done()));
  base = `http://127.0.0.1:${server.port()}`;
});

afterAll(async () => {
  await server.close();
});

describe.skipIf(!asset)('static assets', () => {
  it('caches hashed assets for a year and index.html not at all', async () => {
    const hashed = await fetch(`${base}/assets/${asset}`);
    expect(hashed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const document = await fetch(`${base}/`);
    expect(document.headers.get('cache-control')).toBe('no-cache');
  });

  it('does not let a missing hashed URL inherit the immutable header', async () => {
    // Unknown paths fall back to index.html; caching that for a year under an
    // asset URL would pin a wrong document forever.
    const missing = await fetch(`${base}/assets/not-a-real-file-00000000.js`);
    expect(missing.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers a repeat request with 304 rather than the body', async () => {
    const first = await fetch(`${base}/assets/${asset}`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await fetch(`${base}/assets/${asset}`, {
      headers: { 'if-none-match': etag! },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');

    const byDate = await fetch(`${base}/assets/${asset}`, {
      headers: { 'if-modified-since': first.headers.get('last-modified')! },
    });
    expect(byDate.status).toBe(304);
  });

  it('serves byte ranges, which is what media elements ask for', async () => {
    const whole = await fetch(`${base}/assets/${asset}`);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    const body = new Uint8Array(await whole.arrayBuffer());

    const partial = await fetch(`${base}/assets/${asset}`, {
      headers: { range: 'bytes=2-5' },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 2-5/${body.length}`);
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(body.slice(2, 6));

    // An open-ended range runs to the last byte, which is how a player resumes.
    const tail = await fetch(`${base}/assets/${asset}`, { headers: { range: 'bytes=1-' } });
    expect(tail.status).toBe(206);
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(body.slice(1));

    // A suffix range counts back from the end instead.
    const suffix = await fetch(`${base}/assets/${asset}`, { headers: { range: 'bytes=-3' } });
    expect(suffix.status).toBe(206);
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(body.slice(-3));
  });

  it('rejects a range that starts past the end of the file', async () => {
    const off = await fetch(`${base}/assets/${asset}`, {
      headers: { range: 'bytes=99999999-' },
    });
    expect(off.status).toBe(416);
    expect(off.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);
  });
});
