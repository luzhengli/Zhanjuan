import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(async ({ command }) => {
  const plugins = [react(), tailwindcss()];
  if (command === "serve") {
    const { zhanjuanVite } = await import("../bridge/vite-source-tag.mjs");
    plugins.unshift(
      zhanjuanVite({
        project: "zhanjuan-demo",
        mode: "demo",
      }),
    );
  }

  return {
    root: path.resolve(import.meta.dirname, "."),
    plugins,
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
    },
  };
});
