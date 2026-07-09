import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/voice-capture-studio/",
  resolve: {
    alias: {
      "@app": "/src/app",
      "@domains": "/src/domains",
      "@shared": "/src/shared",
    },
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
