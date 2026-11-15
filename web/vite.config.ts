import { defineConfig } from "vite";

export default defineConfig({
  // WS-Host im LAN: der Companion serviert die gebaute PWA selbst (staticDir);
  // dev mode proxied /ws an den lokalen Companion.
  server: {
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:8791",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
