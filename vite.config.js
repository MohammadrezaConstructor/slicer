// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'fs';

// The minified bundle loses the libraries' licence comments, so the licence texts are embedded in
// the page (the "About & licence" window shows them): LICENSE and THIRD_PARTY_NOTICES.md.
function embedLicences() {
  const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
  return {
    name: 'embed-licences',
    transformIndexHtml(html) {
      const blocks = [
        `<script type="text/plain" id="licence-agpl">${esc(readFileSync('LICENSE', 'utf8'))}</script>`,
        `<script type="text/plain" id="licence-third-party">${esc(readFileSync('THIRD_PARTY_NOTICES.md', 'utf8'))}</script>`,
      ];
      return html.replace('</body>', `${blocks.join('\n')}\n</body>`);
    },
  };
}

// `npm run build` produces dist/index.html: one self-contained file that works offline.
export default defineConfig({
  base: './',
  plugins: [embedLicences(), viteSingleFile()],
  build: { target: 'es2020', chunkSizeWarningLimit: 4000, modulePreload: { polyfill: false } },
  worker: { format: 'iife' }, // classic worker: module workers from blob URLs fail on file://
});
