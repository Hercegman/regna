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
 * So the data goes in its own chunk, the renderer and the sound in another,
 * and what is left is the part that actually gets edited.
 *
 * `codeSplitting` rather than `manualChunks`, because Vite 8 bundles with
 * Rolldown rather than Rollup and Rolldown does not honour the old hook. It
 * does not complain about it either: the build succeeds and quietly folds
 * the chunks back together, which is a failure that shows up nowhere except
 * in the list of files it wrote. Groups are tried in order and the first
 * match wins, which is why `data` is written before `simulation` —
 * `core/data` is inside `core`.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        codeSplitting: {
          // Off, or the first group that matches drags everything it imports in
          // behind it: the renderer imports the simulation, so `presentation`
          // swallowed `simulation` whole and the chunk simply stopped
          // existing — a build that succeeds and quietly does the opposite of
          // what it was asked.
          includeDependenciesRecursively: false,
          groups: [
            // `types.ts` goes with the data because the data is the only
            // thing that cannot do without it: every table in `core/data`
            // imports it and imports nothing else. Leaving it with the
            // simulation makes the two chunks import each other.
            { name: 'data', test: /[\\/]src[\\/]core[\\/](data[\\/]|types\.ts)/ },
            { name: 'presentation', test: /[\\/]src[\\/](render|audio)[\\/]/ },
            { name: 'simulation', test: /[\\/]src[\\/]core[\\/]/ },
          ],
        },
      },
    },
  },
});
