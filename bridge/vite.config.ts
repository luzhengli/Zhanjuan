import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: path.resolve(import.meta.dirname, "."),
    emptyOutDir: false,
    sourcemap: false,
    minify: false,
    lib: {
      entry: path.resolve(import.meta.dirname, "../src/bridge/inspector-bridge.ts"),
      name: "ZhanjuanBridge",
      formats: ["iife"],
      fileName: () => "inspector-bridge.js",
    },
  },
});
