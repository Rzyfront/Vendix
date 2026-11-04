import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { switchMap } from 'rxjs/operators';

import { ConfigFacade } from '../../../../core/store/config';
import { ThemeService } from '../../../../core/services';
import { toTitleCase } from '../../../../core/utils/format.utils';
import { LandingLayoutComponent } from '../../../../shared/components/layouts/landing-layout/landing-layout.component';
import { DynamicHeroCarouselComponent } from '../shared/dynamic-hero-carousel/dynamic-hero-carousel.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { CrmLandingDocument } from '../../blocks/landing-blocks.types';
import { LandingPageService } from '../../../landing-page/landing-page.service';
import { StoreSeoService } from '../../../../private/modules/ecommerce/services/store-seo';
import { LandingDocumentViewComponent } from '../landing-document-view/landing-document-view.component';
import {
  IDLE_LEAD_STATE,
  LandingLeadState,
} from '../landing-document-view/landing-lead-form.component';
import { landingLogo } from '../landing-document-view/landing-view.util';
import {
  CrmLandingService,
  CrmContactPayload,
} from '../../services/crm-landing.service';

/**
 * Landing pública de tienda (STORE_LANDING) renderizada por bloques desde
 * el documento JSON publicado por el módulo CRM (QUI-719). Sirve SOLO
 * `published_json` (el backend filtra enabled + landing_enabled); sin
 * contenido publicado mantiene el render branded base con hero y acceso a login.
 */
@Component({
  selector: 'app-store-landing',
  standalone: true,
  imports: [
    CommonModule,
    LandingLayoutComponent,
    DynamicHeroCarouselComponent,
    IconComponent,
    LandingDocumentViewComponent,
  ],
  template: `
    <app-landing-layout [brandName]="storeName()" [logoUrl]="headerLogo()">
      <div class="crm-landing">
        @if (loading()) {
          <section class="crm-state">
            <app-icon name="loader" [size]="22" />
            <span>Cargando…</span>
          </section>
        } @else if (document(); as doc) {
          <app-landing-document-view
            [document]="doc"
            [ecommerceBaseUrl]="ecommerceBaseUrl()"
            [offer]="ownLanding()?.offer ?? null"
            [leadState]="leadState()"
            (ctaClick)="goToStore()"
            (leadSubmit)="submitContact($event)"
          />
        } @else {
          <!-- Fallback branded para tiendas sin landing CRM publicada -->
          <section class="relative h-screen">
            <app-dynamic-hero-carousel
              [slides]="heroSlides()"
            ></app-dynamic-hero-carousel>
          </section>

          @if (features().length) {
            <section
              id="features"
              class="min-h-screen bg-[var(--color-surface)] flex items-center py-20"
            >
              <div class="container mx-auto px-4 sm:px-6 lg:px-8">
                <div class="text-center mb-16">
                  <div
                    class="inline-flex items-center gap-2 bg-[var(--color-primary)] px-4 py-2 rounded-full mb-6"
                  >
                    <span
                      class="w-2 h-2 bg-[var(--color-accent)] rounded-full"
                    ></span>
                    <span class="text-sm font-medium text-[var(--color-accent)]"
                      >Nuestra Tienda</span
                    >
                  </div>
                  <h2
                    class="text-4xl md:text-5xl font-bold text-[var(--color-text-primary)] mb-6 tracking-tight"
                  >
                    Bienvenido a<br />
                    <span class="text-[var(--color-primary)]">{{ storeName() }}</span>
                  </h2>
                  <p
                    class="text-xl text-[var(--color-text-secondary)] max-w-3xl mx-auto leading-relaxed"
                  >
                    {{ heroDescription() || 'Explora lo que tenemos para ofrecerte.' }}
                  </p>
                </div>
                <div
                  class="grid md:grid-cols-2 lg:grid-cols-4 gap-2 md:p-4 max-w-7xl mx-auto"
                >
                  @for (feature of features(); track feature.title) {
                    <div
                      class="group bg-surface p-2 md:p-6 rounded-2xl border border-[var(--color-border)] hover:border-[var(--color-primary)]/30 hover:shadow-lg transition-all duration-300"
                    >
                      <div
                        class="w-12 h-12 bg-[var(--color-primary-light)] rounded-xl flex items-center justify-center mb-6 group-hover:scale-105 transition-transform duration-300"
                      >
                        <app-icon
                          name="star"
                          [size]="24"
                          color="var(--color-primary)"
                        ></app-icon>
                      </div>
                      <h3
                        class="text-xl font-semibold text-[var(--color-text-primary)] mb-3"
                      >
                        {{ feature.title }}
                      </h3>
                      <p class="text-[var(--color-text-secondary)] leading-relaxed">
                        {{ feature.description }}
                      </p>
                    </div>
                  }
                </div>
              </div>
            </section>
          }

          <!-- CTA Section -->
          <section
            class="min-h-[50vh] bg-[var(--color-primary)] relative overflow-hidden flex items-center"
          >
            <div
              class="container mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10"
            >
              <h2
                class="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight"
              >
                Acceso Personal
              </h2>
              <p
                class="text-xl text-white/90 mb-10 max-w-3xl mx-auto leading-relaxed"
              >
                Ingresa al sistema de punto de venta y gestión.
              </p>
              <div class="flex flex-col sm:flex-row gap-2 md:gap-4 justify-center">
                <a
                  href="/auth/login"
                  class="bg-white text-[var(--color-primary)] px-8 py-4 rounded-xl font-semibold hover:bg-gray-50 hover:shadow-xl transition-all duration-300"
                >
                  Iniciar Sesión
                </a>
              </div>
            </div>
            <!-- Decorative elements -->
            <div class="absolute top-0 left-0 w-full h-full opacity-10">
              <div
                class="absolute top-10 left-10 w-20 h-20 bg-white rounded-full"
              ></div>
              <div
                class="absolute bottom-10 right-10 w-32 h-32 bg-white rounded-full"
              ></div>
              <div
                class="absolute top-1/2 right-1/4 w-16 h-16 bg-white rounded-full"
              ></div>
            </div>
          </section>
        }
      </div>
    </app-landing-layout>

  `,
  styles: [
    `
      .crm-landing {
        min-height: 40vh;
      }
      .crm-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 96px 16px;
        color: var(--color-text-secondary, #6b7280);
      }
      .crm-state-empty h2 {
        margin: 0 0 6px;
        color: var(--color-text-primary, #111827);
      }
      .crm-state-empty p {
        margin: 0;
      }

    `,
  ],
})
export class StoreLandingComponent {
  private readonly configFacade = inject(ConfigFacade);
  private readonly themeService = inject(ThemeService);
  private readonly crmLandingService = inject(CrmLandingService);
  private readonly landingPage = inject(LandingPageService);
  private readonly storeSeo = inject(StoreSeoService);

  // Branding del host (header/footer del layout y fallback)
  readonly storeName = signal('Tienda');
  readonly logoUrl = signal<string | undefined>(undefined);
  readonly heroTitle = signal('Bienvenido');
  readonly heroDescription = signal('Explora lo que tenemos para ofrecerte.');
  readonly heroSlides = signal<any[]>([]);
  readonly features = signal<Array<{ title: string; description: string }>>([]);

  // Documento CRM
  readonly loading = signal(true);
  readonly document = signal<CrmLandingDocument | null>(null);
  readonly ecommerceBaseUrl = signal<string | null>(null);

  /** Lead form sending state; the form itself lives in the shared view. */
  readonly leadState = signal<LandingLeadState>(IDLE_LEAD_STATE);

  /**
   * Apps · landing page (Fase 6): set only on the landing's own domain, where
   * the offer block shows and leads go to the CRM pipeline with their origin.
   * On `{tienda}-store` it stays null and the page behaves as before.
   */
  readonly ownLanding = computed(() => this.landingPage.ownPage() ?? null);

  /** F6-A: the owner's landing logo, else the store branding logo. */
  readonly headerLogo = computed(() => landingLogo(this.document()) ?? this.logoUrl());

  constructor() {
    this.loadDocument();
    this.landingPage.load().subscribe();

    // F6-A: the owner's SEO, only when the published landing defines one; a
    // landing without it keeps today's metadata untouched. Only the landing's
    // own domain is indexable (backend robots/sitemap agree).
    effect(() => {
      const seo = this.document()?.seo;
      const title = seo?.title?.trim();
      const description = seo?.description?.trim();
      const image = seo?.image_url?.trim();
      if (!title && !description && !image) return;
      const own = !!this.ownLanding();
      this.storeSeo.apply(this, {
        title: title || this.storeName(),
        description: description || this.heroDescription(),
        canonicalPath: own ? '/' : null,
        robots: own ? 'index, follow' : 'noindex, follow',
        image: image || null,
        jsonLd: null,
      });
    });
    inject(DestroyRef).onDestroy(() => this.storeSeo.release(this));

    // Reactividad del branding (regression fix): getCurrentConfig() inicia en
    // null (signal async). El efecto re-dispara loadBranding() cuando la
    // config del dominio llega, restaurando la reactividad que el effect
    // original de este componente tenía antes de este PR. allowSignalWrites
    // porque loadBranding setea signals (storeName, heroSlides, ...).
    effect(
      () => {
        if (this.configFacade.getCurrentConfig()) {
          this.loadBranding();
        }
      },
      { allowSignalWrites: true },
    );
  }

  private loadBranding(): void {
    const appConfig = this.configFacade.getCurrentConfig();
    if (!appConfig) {
      this.buildHeroSlides('Store');
      return;
    }
    const domainConfig = appConfig.domainConfig;
    const name = toTitleCase(
      (
        domainConfig.store_name ||
        domainConfig.customConfig?.branding?.name ||
        domainConfig.store_slug ||
        'Tienda'
      ).replace(/[-_]+/g, ' ').trim(),
    );
    this.storeName.set(name);
    this.logoUrl.set(appConfig.branding?.logo?.url ?? undefined);

    const customConfig = domainConfig.customConfig || {};
    this.heroTitle.set(customConfig.title || `Bienvenido a ${name}`);
    this.heroDescription.set(
      customConfig.description || 'Explora lo que tenemos para ofrecerte.',
    );
    this.features.set(this.mapFeatures(customConfig.features || {}));
    this.buildHeroSlides(name);

    if (appConfig.branding) {
      this.themeService.applyBranding(appConfig.branding);
    }
  }

  private buildHeroSlides(storeName: string): void {
    this.heroSlides.set([
      {
        image: 'assets/images/carrusel/3.webp',
        message: `Operaciones ${storeName}`,
        subtitle:
          'Sistema de gestión operativa y punto de venta para personal autorizado.',
        buttonText: 'Iniciar Turno',
        buttonLink: '/auth/login',
      },
      {
        image: 'assets/images/carrusel/4.webp',
        message: 'Punto de Venta',
        subtitle:
          'Facturación rápida, control de caja e inventario en tiempo real.',
        buttonText: 'Acceder al POS',
        buttonLink: '/auth/login',
      },
    ]);
  }

  private mapFeatures(features: any): Array<{ title: string; description: string }> {
    return [
      {
        title: 'Punto de Venta',
        description: 'Facturación rápida y eficiente.',
      },
      {
        title: 'Control de Caja',
        description: 'Apertura, cierre y arqueos de caja.',
      },
      {
        title: 'Inventario Local',
        description: 'Consulta de stock y movimientos.',
      },
      {
        title: 'Pedidos',
        description: 'Gestión de órdenes y despachos.',
      },
    ];
  }

  private loadDocument(): void {
    this.crmLandingService.getLanding().subscribe({
      next: (res) => {
        this.document.set(res.data.document);
        this.ecommerceBaseUrl.set(res.data.ecommerce_base_url);
        this.loading.set(false);
      },
      error: () => {
        this.document.set(null);
        this.loading.set(false);
      },
    });
  }

  submitContact(payload: CrmContactPayload): void {
    this.leadState.set({ sending: true, submitted: false, error: '' });
    // Waits for the landing lookup (cached) so an early submission on the
    // landing's own domain still reaches the pipeline.
    this.landingPage
      .load()
      .pipe(
        switchMap((page) =>
          page
            ? this.landingPage.submitLead(payload)
            : this.crmLandingService.submitContact(payload),
        ),
      )
      .subscribe({
        next: () => this.leadState.set({ sending: false, submitted: true, error: '' }),
        error: (err) => {
          const apiError = err?.error?.message;
          this.leadState.set({
            sending: false,
            submitted: false,
            error:
              typeof apiError === 'string'
                ? apiError
                : 'No pudimos enviar tu mensaje. Intenta de nuevo.',
          });
        },
      });
  }

  goToStore(): void {
    const base = this.ecommerceBaseUrl();
    if (base) {
      window.location.href = `${base}/catalog`;
    }
  }
}
