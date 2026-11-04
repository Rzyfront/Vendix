import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TenantFacade } from '../../core/store';
import { StoreSeoService } from '../../private/modules/ecommerce/services/store-seo';
import { withPageSeo } from '../app-page/app-page-seo';
import { StoreHomeService } from './store-home.service';
import { StoreHomeDomainFallback, StoreHomeViewComponent } from './store-home-view.component';

/**
 * `/` of the store's `{tienda}-store` domain once the store home is published
 * (Apps · STORE_HOME, Fase 5). It loads the public read and applies the
 * page's SEO; `StoreHomeViewComponent` draws it (the editor's preview draws
 * with the same view, F6-B).
 */
@Component({
  selector: 'app-store-home',
  standalone: true,
  imports: [StoreHomeViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-store-home-view [home]="home()" [fallback]="fallback()" />`,
})
export class StoreHomeComponent {
  private readonly tenant = inject(TenantFacade);
  readonly home = toSignal(inject(StoreHomeService).load(), {
    initialValue: undefined,
  });
  private readonly domainConfig = this.tenant.domainConfig;

  /** Brand the domain resolver already sends (store settings). */
  readonly fallback = computed<StoreHomeDomainFallback>(() => {
    const config = this.domainConfig();
    const brand = config?.customConfig?.branding ?? null;
    return {
      name: config?.store_name || brand?.name || null,
      slug: config?.store_slug || null,
      logoUrl: config?.store_logo_url || brand?.logo_url || null,
      primaryColor: brand?.primary_color || null,
    };
  });

  private readonly name = computed(
    () =>
      this.home()?.store_name ||
      this.home()?.branding.name ||
      this.fallback().name ||
      this.fallback().slug ||
      'Tienda',
  );

  private readonly seo = inject(StoreSeoService);
  private readonly seoOwner = {};
  private readonly seoSync = effect(() => {
    const page = this.home()?.page ?? null;
    if (!page?.seo) return;
    const name = this.name();
    this.seo.apply(
      this.seoOwner,
      withPageSeo(
        { title: name, description: name, canonicalPath: '/', robots: 'index, follow', image: null },
        page,
      ),
    );
  });
  private readonly seoCleanup = inject(DestroyRef).onDestroy(() => this.seo.release(this.seoOwner));
}
