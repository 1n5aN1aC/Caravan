import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Keeps production stack traces readable — this is a debugging tool, not a
  // shipping app.
  build: { sourcemap: true },
  test: { environment: 'jsdom' },
  server: {
    host: '0.0.0.0', // reachable from other machines on the LAN
    port: 5173,
    // In dev the client and server are separate origins; proxy the socket so
    // the client can always just talk to its own origin.
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
