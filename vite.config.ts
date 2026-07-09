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
});
