import { existsSync } from 'node:fs';
import { createCaravanServer, WEB_ROOT } from './server.js';

const PORT = Number(process.env.PORT ?? 8787);
const server = createCaravanServer();

server.http.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use — another Caravan server is probably still running.\n` +
        `Stop it, or start this one on another port: PORT=8788 pnpm start`,
    );
    process.exit(1);
  }
  throw error;
});

server.http.listen(PORT, () => {
  console.log(`Caravan server on http://localhost:${PORT}`);
  if (!existsSync(WEB_ROOT)) {
    console.log('(no built client yet — run `pnpm build`)');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
