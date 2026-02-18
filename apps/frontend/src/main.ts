import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

const CHUNK_RELOAD_ATTEMPT_KEY = 'vendix:chunk-reload-attempted';

function isDynamicImportFailure(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';

  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('Outdated Optimize Dep')
  );
}

function reloadOnceForStaleChunk(error: unknown): void {
  if (!isDynamicImportFailure(error)) return;

  if (sessionStorage.getItem(CHUNK_RELOAD_ATTEMPT_KEY) === '1') {
    console.error('[ChunkLoader] Dynamic import still failing after reload.', error);
    return;
  }

  sessionStorage.setItem(CHUNK_RELOAD_ATTEMPT_KEY, '1');
  window.location.reload();
}

window.addEventListener('vite:preloadError', (event: Event) => {
  event.preventDefault();
  const preloadEvent = event as Event & { payload?: unknown };
  reloadOnceForStaleChunk(preloadEvent.payload);
});

window.addEventListener('unhandledrejection', (event) => {
  reloadOnceForStaleChunk(event.reason);
});

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
