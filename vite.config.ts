import { defineConfig } from 'vite';

/**
 * The build.
 *
 * One thing worth configuring, and it is the shape of the output rather than
 * its size. The game is a little over half a megabyte, and almost all of it
 * is the part that does not change: seventy-three realms, two hundred and
 * twenty-two provinces, ninety-one kinds of soldier, thirty-nine buildings,
 * the blazons and the map's elevation. Shipping that in the same file as the
 * code means a one-line fix to the battle simulation invalidates the browser
 * cache for a hundred and eighty kilobytes of medieval history that has not
 * moved since the eleventh century.
 *
 * So the data goes in its own chunk, the renderer in another, and what is
 * left is the part that actually gets edited. It also quiets Vite's warning
 * about the size of a single bundle, which was the complaint that prompted
 * this, but the caching is the reason.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // `types.ts` goes with the data because the data is the only thing
          // that cannot do without it: every table in `core/data` imports it
          // and imports nothing else. Leaving it with the simulation makes
          // the two chunks import each other, which Rollup will build and
          // then rightly complain about.
          if (id.includes('/src/core/data/') || id.endsWith('/src/core/types.ts')) return 'data';
          if (id.includes('/src/render/') || id.includes('/src/audio/')) return 'presentation';
          if (id.includes('/src/core/')) return 'simulation';
          return undefined;
        },
      },
    },
  },
});
