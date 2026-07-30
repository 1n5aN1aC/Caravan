import { createReadStream, existsSync, statSync, type Stats } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientMessage } from '@caravan/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { Hub, type Connection } from './hub.js';

const here = fileURLToPath(new URL('.', import.meta.url));
/** The built web client, served from the same origin as the socket. */
export const WEB_ROOT = resolve(here, '../../web/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  // Audio. Without these the browser gets `application/octet-stream`, which
  // Safari in particular will refuse to play. `.opus` in an Ogg container is
  // `audio/ogg` — `audio/opus` is not a thing browsers agree on.
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
  // Images.
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

/**
 * Vite writes everything under `assets/` with a content hash in its filename,
 * so a given URL there can never change meaning — it can be cached for a year
 * and never revalidated. Everything else (chiefly `index.html`, the document
 * that names those hashes) must be rechecked on every load, or a deploy would
 * be invisible to anyone holding a stale copy.
 *
 * Decided from the resolved file rather than the URL, so that a request which
 * fell back to index.html is never cached as if it were the asset it asked
 * for — and so the separator is whatever this platform actually uses.
 */
function cacheControl(file: string): string {
  const within = relative(WEB_ROOT, file);
  return within.startsWith(`assets${sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

/**
 * A validator for the conditional requests browsers send once something has
 * fallen out of their cache but is still on disk. Size and mtime are enough to
 * distinguish any two builds; this is a static file server, not a CDN.
 */
function etagFor(stats: Stats): string {
  return `"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
}

/** True when the client already holds this exact version. */
function isFresh(req: IncomingMessage, etag: string, lastModified: string): boolean {
  const ifNoneMatch = req.headers['if-none-match'];
  // `If-None-Match` wins outright when present — it is the precise check, and a
  // client sending both expects the date to be ignored.
  if (ifNoneMatch) {
    return ifNoneMatch.split(',').some((candidate) => candidate.trim() === etag);
  }
  const ifModifiedSince = req.headers['if-modified-since'];
  if (!ifModifiedSince) return false;
  const since = Date.parse(ifModifiedSince);
  // `Last-Modified` has one-second resolution, so compare against the value we
  // actually sent rather than the raw mtime, which carries milliseconds.
  return Number.isFinite(since) && Date.parse(lastModified) <= since;
}

/**
 * Parses a single-range `Range` header against a known file size. Multi-range
 * requests are answered in full instead, which is allowed and which no media
 * element asks for anyway.
 *
 * Returns `undefined` for "send the whole thing" and `null` for a range that
 * cannot be satisfied, which is a 416 rather than a 200.
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;

  let start: number;
  let end: number;
  if (rawStart === '') {
    // A suffix range: `bytes=-500` means the last 500 bytes.
    if (rawEnd === '') return undefined;
    const length = Number(rawEnd);
    if (length === 0) return null;
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (start > end || start >= size) return null;
  return { start, end };
}

export interface CaravanServer {
  http: Server;
  hub: Hub;
  /** The bound port — useful when starting on port 0 in tests. */
  port(): number;
  close(): Promise<void>;
}

/**
 * Wires the hub to a WebSocket server and the built client to the same origin.
 * Exported rather than inlined into main so end-to-end tests can start a real
 * server on an ephemeral port.
 */
export function createCaravanServer(): CaravanServer {
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (!existsSync(WEB_ROOT)) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('web client not built — run `pnpm build`');
      return;
    }
    // Serve the SPA, falling back to index.html so a deep link still loads.
    const requested = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!));
    let file = join(WEB_ROOT, requested);
    if (!file.startsWith(WEB_ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(WEB_ROOT, 'index.html');
    }

    const stats = statSync(file);
    const etag = etagFor(stats);
    const lastModified = stats.mtime.toUTCString();
    const headers: Record<string, string> = {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': cacheControl(file),
      etag,
      'last-modified': lastModified,
      // Media elements will not seek — and Safari will not play at all —
      // without knowing ranges are on offer.
      'accept-ranges': 'bytes',
    };

    if (isFresh(req, etag, lastModified)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    const range = parseRange(req.headers.range, stats.size);
    if (range === null) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${stats.size}` });
      res.end();
      return;
    }
    if (range) {
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${range.start}-${range.end}/${stats.size}`,
        'content-length': String(range.end - range.start + 1),
      });
      createReadStream(file, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    res.writeHead(200, { ...headers, 'content-length': String(stats.size) });
    createReadStream(file).pipe(res);
  });

  const hub = new Hub();
  const wss = new WebSocketServer({ server: http });

  wss.on('connection', (socket: WebSocket) => {
    const connection: Connection = {
      send: (message) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
      close: () => socket.close(),
    };

    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return connection.send({ t: 'error', message: 'malformed message', resync: false });
      }
      const result = ClientMessage.safeParse(parsed);
      if (!result.success) {
        // Anything failing the schema never reaches the hub, let alone the engine.
        return connection.send({ t: 'error', message: 'invalid message', resync: false });
      }
      hub.handle(connection, result.data);
    });

    socket.on('close', () => hub.disconnect(connection));
    socket.on('error', () => hub.disconnect(connection));
  });

  const sweep = setInterval(() => hub.tick(), 5_000);
  sweep.unref();

  return {
    http,
    hub,
    port: () => {
      const address = http.address();
      if (address === null || typeof address === 'string') {
        throw new Error('server is not listening on a TCP port');
      }
      return address.port;
    },
    close: () =>
      new Promise<void>((done) => {
        clearInterval(sweep);
        wss.close();
        for (const client of wss.clients) client.terminate();
        http.close(() => done());
      }),
  };
}
