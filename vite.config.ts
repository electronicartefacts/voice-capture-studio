import { defaultClientConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/voice-capture-studio/",
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@app": "/src/app",
      "@domains": "/src/domains",
      "@shared": "/src/shared",
    },
    // onnxruntime-web must load its WASM runtime from public/ort/ at runtime
    // instead of bundling 50 MB of duplicate binaries into dist/assets.
    conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react/") ||
            id.includes("node_modules/scheduler")
          ) {
            return "react-vendor";
          }

          if (id.includes("domains/corpus/data/canonicalCorpus")) {
            return "corpus-data";
          }

          return undefined;
        },
      },
    },
  },
});
