import { mergeApplicationConfig, APP_INITIALIZER } from '@angular/core';
import {
  provideServerRendering,
  withRoutes,
  RenderMode,
} from '@angular/ssr';
import { Store } from '@ngrx/store';
import { appConfig } from './app.config';
import * as ConfigActions from './core/store/config/config.actions';
import { AppType } from './core/models/environment.enum';
import { vendixLandingPublicRoutes } from './routes/public/vendix_landing.public.routes';

/**
 * Server-side APP_INITIALIZER factory.
 *
 * During pre-rendering there is no real domain to resolve. We dispatch
 * initializeAppSuccess with the VENDIX_LANDING routes so that:
 * 1. The config reducer sets loading=false, error=null
 * 2. RouteManagerService picks up the routes via its initializeAppSuccess listener
 * 3. The root App template shows <router-outlet> instead of the loading spinner
 * 4. The router renders VendixLandingComponent for path '/'
 */
function initializeAppServer(store: Store): () => Promise<boolean> {
  return () => {
    store.dispatch(
      ConfigActions.initializeAppSuccess({
        config: {
          environment: AppType.VENDIX_LANDING,
          domainConfig: {
            hostname: 'vendix.store',
            domainType: 'PRIMARY',
            environment: AppType.VENDIX_LANDING,
            isVendixDomain: true,
            isMainVendixDomain: true,
          } as any,
          routes: vendixLandingPublicRoutes,
          layouts: [],
          branding: {} as any,
        },
      }),
    );

    return Promise.resolve(true);
  };
}

const serverConfig = {
  providers: [
    provideServerRendering(
      withRoutes([
        { path: '', renderMode: RenderMode.Prerender },
        { path: '**', renderMode: RenderMode.Client },
      ]),
    ),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAppServer,
      deps: [Store],
      multi: true,
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
