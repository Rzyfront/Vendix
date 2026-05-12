import { bootstrapApplication } from '@angular/platform-browser';
import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';
import localeEsCOExtra from '@angular/common/locales/extra/es-CO';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Register es-CO locale globally so DatePipe / CurrencyPipe with 'es-CO'
// (used across the admin panels — checkout, invoices, accounting reports)
// don't throw NG0701 "Missing locale data".
registerLocaleData(localeEsCO, 'es-CO', localeEsCOExtra);

if (typeof window !== 'undefined') {
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.includes('NG0505')) return;
    originalConsoleError(...args);
  };
}

if (typeof window !== 'undefined') {
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
      console.error(
        '[ChunkLoader] Dynamic import still failing after reload.',
        error,
      );
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
}

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err),
);
