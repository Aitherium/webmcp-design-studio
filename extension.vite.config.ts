import { defineConfig } from 'vite'

// Extension bundle build — a SINGLE IIFE that works on any page (no React,
// no store): the gobbonet "add by URL" artifact. Output lands directly in
// public/ so the app build picks it up into dist/ (vite copies public/*).
// emptyOutDir is false on purpose: public/ is not a build-owned directory.
export default defineConfig({
  build: {
    outDir: 'public',
    emptyOutDir: false,
    lib: {
      entry: 'src/extension/index.ts',
      name: 'WebMCPAdapter',
      fileName: () => 'webmcp-adapter.js',
      formats: ['iife'],
    },
    // Rolldown-native minifier on purpose: this Vite ships without esbuild
    // (SAC blocks its native bindings on this host), and asking for the
    // esbuild minifier fails the build.
    minify: true,
    sourcemap: false,
  },
})
