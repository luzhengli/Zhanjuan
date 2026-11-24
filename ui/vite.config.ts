import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "."),
  base: "/__zhanjuan/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(import.meta.dirname, "../dist/ui"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
