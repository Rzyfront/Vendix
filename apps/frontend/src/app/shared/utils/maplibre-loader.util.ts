/**
 * Single lazy loader for `maplibre-gl` (v6+).
 *
 * v6 is ESM-only and has NO default export, and it locates its Web Worker with
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Inside an esbuild
 * chunk that resolves next to the chunk (→ 404), so with a bundler the worker
 * URL must be set explicitly before the first `new Map(...)`. The worker and
 * its `maplibre-gl-shared.mjs` sibling are copied by angular.json (assets) to
 * `/maplibre/`.
 *
 * Every map component must go through this loader instead of calling
 * `import('maplibre-gl')` directly, so the worker URL is always configured.
 */
export const MAPLIBRE_WORKER_URL = '/maplibre/maplibre-gl-worker.mjs';

let maplibrePromise: Promise<any> | null = null;

export function loadMaplibre(): Promise<any> {
  if (!maplibrePromise) {
    maplibrePromise = import('maplibre-gl')
      .then((maplibregl: any) => {
        maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
        return maplibregl;
      })
      .catch((err) => {
        // Allow a later retry (e.g. a transient chunk-load failure).
        maplibrePromise = null;
        throw err;
      });
  }
  return maplibrePromise;
}
