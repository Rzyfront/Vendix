import { ChangeDetectionStrategy, Component, inject, Injectable, mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { BEFORE_APP_SERIALIZED } from '@angular/platform-server';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServerRendering, RenderMode, withRoutes } from '@angular/ssr';
import { catchError, tap, throwError, timeout } from 'rxjs';
import { appConfig } from './app/app.config';
import { VendixLandingComponent } from './app/public/landing/vendix-landing/vendix-landing.component';
import { PublicPlansResponse, PublicPlansService } from './app/public/pricing/services/public-plans.service';
import { environment } from './environments/environment';

@Injectable()
class MarketingPreviewStatus {
  plansReady = false;
  plansFailed = false;
}

// Build-only entry. Never used by main.server.ts or the shared neutral shell.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [VendixLandingComponent],
  template: '<app-vendix-landing />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class MarketingPreviewComponent {}

function previewPlans() {
  const http = inject(HttpClient);
  const status = inject(MarketingPreviewStatus);
  return {
    list$: http.get<PublicPlansResponse>(`${environment.apiUrl}/public/plans`).pipe(
      timeout(10000),
      tap((response) => {
        if (response.success !== true || !Array.isArray(response.data) || response.data.length === 0) {
          throw new Error('Marketing preview requires a non-empty public plans response');
        }
        status.plansReady = true;
      }),
      catchError((error: unknown) => {
        status.plansFailed = true;
        return throwError(() => error);
      }),
    ),
  };
}

const config = mergeApplicationConfig(appConfig, {
  providers: [
    MarketingPreviewStatus,
    provideRouter([{ path: '', pathMatch: 'full', children: [] }]),
    provideServerRendering(withRoutes([{ path: '', renderMode: RenderMode.Prerender }])),
    { provide: PublicPlansService, useFactory: previewPlans },
    {
      provide: BEFORE_APP_SERIALIZED,
      multi: true,
      useFactory: () => {
        const status = inject(MarketingPreviewStatus);
        return () => {
          if (!status.plansReady || status.plansFailed) {
            throw new Error('Marketing preview refused: public plans unavailable; curated fallback must not be published');
          }
        };
      },
    },
  ],
});

export default (context?: { platformRef?: unknown }) =>
  bootstrapApplication(MarketingPreviewComponent, config, context as Parameters<typeof bootstrapApplication>[2]);
