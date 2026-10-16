import { ChangeDetectionStrategy, Component, mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideServerRendering, RenderMode, withRoutes } from '@angular/ssr';
import { of } from 'rxjs';
import { appConfig } from './app/app.config';
import { VendixLandingComponent } from './app/public/landing/vendix-landing/vendix-landing.component';
import { PublicPlansService } from './app/public/pricing/services/public-plans.service';
import { environment } from './environments/environment';
import { loadMarketingPreviewPlans } from './marketing-preview-plans';

// Build-only entry. Never used by main.server.ts or the shared neutral shell.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [VendixLandingComponent],
  template: '<app-vendix-landing />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class MarketingPreviewComponent {}

export default async (context?: { platformRef?: unknown }) => {
  // Reject before Angular starts; serialization hooks deliberately swallow exceptions.
  const plans = await loadMarketingPreviewPlans(environment.apiUrl);
  const config = mergeApplicationConfig(appConfig, {
    providers: [
      provideRouter([{ path: '', pathMatch: 'full', children: [] }]),
      provideServerRendering(withRoutes([{ path: '', renderMode: RenderMode.Prerender }])),
      { provide: PublicPlansService, useValue: { list$: of(plans) } },
    ],
  });
  return bootstrapApplication(
    MarketingPreviewComponent,
    config,
    context as Parameters<typeof bootstrapApplication>[2],
  );
};
