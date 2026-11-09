import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build: all JS/CSS inlined into dist/index.html so the result opens
// offline from file:// in Chrome (no CDN, no network).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  // charset 'ascii': escape every non-ASCII char in the JS bundle as \uXXXX. fast-xml-parser's XML-name regex contains
  // the Unicode noncharacter U+EFFFF literally; inlined raw into the HTML it made Vite's HTML parser fail
  // (noncharacter-in-input-stream → HTTP 500 when the release HTML is served through the dev server). Behaviour unchanged.
  esbuild: { charset: 'ascii' },
  build: { modulePreload: { polyfill: false }, outDir: 'dist', assetsInlineLimit: 100000000, cssCodeSplit: false },
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], setupFiles: ['./tests/setup-dom.ts'] },
} as any);
