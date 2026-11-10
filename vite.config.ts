import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Set by the GitHub Pages workflow to /<repo>/; "/" for local dev.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  test: { environment: "node" },
});
