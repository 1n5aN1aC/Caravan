import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
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
};

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
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
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
