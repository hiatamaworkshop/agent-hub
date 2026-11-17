// A resolver for running the TypeScript sources with Node's own type stripping, without tsx (C173; design.md §5).
// The sources import `./x.js` and the file on disk is `./x.ts` (TypeScript's NodeNext convention), which Node does not
// resolve by itself. This hook points such an import at the .ts file when only that one exists; a real .js file
// (src/shared/card-state.js) is left alone. Used by `npm run test:coverage` only: Node's type stripping keeps every line
// and column of the source, so the coverage figures are those of the files as written. tsx rewrites the source, and
// Node's coverage then counts lines of the rewritten text (checked 2026-11-16, design.md §5).
// Usage: node --import ./tools/dev/ts-resolve.mjs <file.ts>
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
      const js = new URL(specifier, context.parentURL)
      const ts = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL)
      if (!existsSync(js) && existsSync(ts)) return nextResolve(ts.href, context)
    }
    return nextResolve(specifier, context)
  },
})
