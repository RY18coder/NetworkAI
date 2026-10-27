import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Proxy API Gateway calls to the local Express backend during dev
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
