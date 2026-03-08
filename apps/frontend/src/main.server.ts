import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

/**
 * Server entry point for Angular SSR / pre-rendering.
 *
 * The Angular SSR runtime calls this function with `{ platformRef }` — the
 * platform created by `platformServer()`. We must forward it as the third
 * argument to `bootstrapApplication` so Angular reuses that platform instead
 * of creating a new one (which would throw NG0401: PLATFORM_NOT_FOUND).
 */
const bootstrap = (serverContext?: { platformRef?: unknown }) =>
  bootstrapApplication(App, config, serverContext as any);

export default bootstrap;
