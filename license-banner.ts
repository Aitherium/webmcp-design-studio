import type { Plugin } from 'vite'

// ONE copy of the legal banner and ONE way of applying it, imported by BOTH
// vite configs.
//
// There are two build outputs -- the app bundle (vite.config.ts) and the
// standalone extension IIFE (extension.vite.config.ts, which is designed to be
// dropped onto somebody ELSE's page and is therefore the most copyable artifact
// this repo produces). Two hand-maintained copies of one notice drift; that is
// not a risk, it is what happens.
export const LEGAL_BANNER = `/*! WebMCP Design Studio
 * Copyright (c) 2026 David Parkhurst (Aitherium). All rights reserved.
 * Licensed under the Business Source License 1.1 -- source-available, NOT open source.
 * Non-production use is free. Personal, non-commercial production use is free.
 * Commercial or organizational production use, including internal company use
 * and any hosted or managed service offering substantially similar
 * functionality, requires a commercial licence: licensing@aitherium.com
 * Converts to Apache License 2.0 on 2030-02-07.
 * https://github.com/Aitherium/webmcp-design-studio
 */
`

// Why a plugin and not `output.banner`:
//
// This Vite is ROLLDOWN-backed. `build.rollupOptions.output.banner` is accepted
// and SILENTLY IGNORED (wrong key), and `build.rolldownOptions.output.banner`
// is applied and then eaten by the minifier. Both produced a build with rc=0,
// an emitted chunk, and no notice -- every signal green, the notice gone. The
// only reason that was caught is that the assertion below reads the BYTES.
//
// `generateBundle` runs after render and after minification, so prepending
// here is the last word.
export function licenseBanner(): Plugin {
  return {
    name: 'aitherium-license-banner',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue
        if (file.code.includes('Business Source License 1.1')) continue
        file.code = LEGAL_BANNER + file.code
      }
    },
  }
}
