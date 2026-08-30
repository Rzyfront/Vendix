import {
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ConfigFacade } from '../../../../core/store/config';
import { ThemeService } from '../../../../core/services';
import { toTitleCase } from '../../../../core/utils/format.utils';
import { LandingLayoutComponent } from '../../../../shared/components/layouts/landing-layout/landing-layout.component';
import { DynamicHeroCarouselComponent } from '../shared/dynamic-hero-carousel/dynamic-hero-carousel.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import {
  CrmLandingDocument,
  CrmBlock,
} from '../../blocks/landing-blocks.types';
import { BlockRendererComponent } from '../../blocks/block-renderer/block-renderer.component';
import { ContactBlockComponent } from '../../blocks/contact-block.component';
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
    BlockRendererComponent,
    ContactBlockComponent,
    IconComponent,
  ],
  template: `
    <app-landing-layout [brandName]="storeName()" [logoUrl]="logoUrl()">
      <div class="crm-landing" [style.--crm-primary]="primaryColor()" [style.--crm-secondary]="secondaryColor()">
        @if (loading()) {
          <section class="crm-state">
            <app-icon name="loader" [size]="22" />
            <span>Cargando…</span>
          </section>
        } @else if (document(); as doc) {
          @for (block of doc.blocks; track block.id; let i = $index) {
            <div #blockHost>
              @if (block.type === 'contact') {
                <app-contact-block
                  [props]="block.props"
                  (ctaClick)="scrollToForm()"
                />
                <section id="contacto" class="crm-contact-section max-w-xl mx-auto px-4 pb-20">
                  <div class="crm-contact-card bg-white rounded-3xl p-7 sm:p-9 border border-slate-200/90 shadow-xl">
                    <h3 class="text-xl font-bold text-slate-900 text-center mb-1.5">Envíanos un mensaje directo</h3>
                    <p class="text-xs sm:text-sm text-slate-500 text-center mb-6">Déjanos tus datos y un asesor se pondrá en contacto contigo en breve.</p>
                    
                    <div class="space-y-4">
                      <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">Nombre completo *</label>
                        <input
                          class="crm-field"
                          type="text"
                          placeholder="Tu nombre completo"
                          maxlength="80"
                          [value]="formName()"
                          (input)="onForm('name', $event)"
                        />
                      </div>
                      
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <label class="block text-xs font-semibold text-slate-700 mb-1.5">Correo electrónico</label>
                          <input
                            class="crm-field"
                            type="email"
                            placeholder="nombre@ejemplo.com"
                            maxlength="160"
                            [value]="formEmail()"
                            (input)="onForm('email', $event)"
                          />
                        </div>
                        <div>
                          <label class="block text-xs font-semibold text-slate-700 mb-1.5">Teléfono / WhatsApp</label>
                          <input
                            class="crm-field"
                            type="tel"
                            placeholder="Ej. 300 123 4567"
                            maxlength="30"
                            [value]="formPhone()"
                            (input)="onForm('phone', $event)"
                          />
                        </div>
                      </div>

                      <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">¿En qué podemos ayudarte? *</label>
                        <textarea
                          class="crm-field"
                          rows="4"
                          placeholder="Escribe aquí tu consulta o los productos de tu interés…"
                          maxlength="1000"
                          [value]="formMessage()"
                          (input)="onForm('message', $event)"
                        ></textarea>
                      </div>

                      @if (submitted()) {
                        <div class="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium text-center flex items-center justify-center gap-2">
                          <app-icon name="check-circle" [size]="18" color="#059669" />
                          <span>¡Gracias! Tu mensaje fue enviado con éxito. Te responderemos muy pronto.</span>
                        </div>
                      } @else {
                        @if (formError()) {
                          <p class="crm-form-error text-center text-xs text-rose-600 font-semibold">{{ formError() }}</p>
                        }
                        <button
                          type="button"
                          class="crm-submit-btn w-full py-3.5 px-6 rounded-full text-white font-bold text-sm shadow-md transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
                          [disabled]="sending()"
                          (click)="submitContact()"
                        >
                          @if (sending()) {
                            <app-icon name="loader" [size]="16" [spin]="true" color="white" />
                            <span>Enviando mensaje…</span>
                          } @else {
                            <app-icon name="mail" [size]="16" color="white" />
                            <span>Enviar mensaje</span>
                          }
                        </button>
                      }
                    </div>
                  </div>
                </section>
              } @else {
                <app-block-renderer
                  [block]="block"
                  [baseUrl]="ecommerceBaseUrl()"
                  (ctaClick)="goToStore()"
                  (secondaryCtaClick)="scrollToForm()"
                />
              }
            </div>
          }

          <!-- Floating WhatsApp Widget Button -->
          @if (enableWhatsappFloat()) {
            @if (whatsappUrl(); as waUrl) {
              <a
                [href]="waUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="crm-floating-whatsapp fixed bottom-6 right-6 z-50 inline-flex items-center gap-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-4 py-3 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 cursor-pointer"
              >
                <app-icon name="headphones" [size]="18" color="white" />
                <span class="text-xs sm:text-sm font-bold">¿Dudas? Chatea en vivo</span>
              </a>
            } @else {
              <a
                (click)="scrollToForm()"
                class="crm-floating-whatsapp fixed bottom-6 right-6 z-50 inline-flex items-center gap-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-4 py-3 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 cursor-pointer"
              >
                <app-icon name="headphones" [size]="18" color="white" />
                <span class="text-xs sm:text-sm font-bold">¿Dudas? Chatea en vivo</span>
              </a>
            }
          }
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

      /* Formulario de contacto público */
      .crm-contact-section {
        margin: 0 auto;
      }
      .crm-contact-card {
        background: #ffffff;
      }
      .crm-field {
        width: 100%;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 11px 14px;
        font-size: 0.9rem;
        font-family: inherit;
        background: #f8fafc;
        box-sizing: border-box;
        transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;
      }
      .crm-field:focus {
        outline: none;
        background: #ffffff;
        border-color: var(--crm-primary, #2563eb);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
      }
      textarea.crm-field {
        resize: vertical;
      }
      .crm-submit-btn {
        background: var(--crm-primary, #2563eb);
      }
      .crm-submit-btn:hover:not(:disabled) {
        filter: brightness(1.08);
        transform: translateY(-1px);
        box-shadow: 0 10px 15px -3px rgba(37, 99, 235, 0.3);
      }
      .crm-submit-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .crm-floating-whatsapp {
        box-shadow: 0 12px 24px -4px rgba(16, 185, 129, 0.45);
      }
    `,
  ],
})
export class StoreLandingComponent {
  private readonly configFacade = inject(ConfigFacade);
  private readonly themeService = inject(ThemeService);
  private readonly crmLandingService = inject(CrmLandingService);

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

  // Formulario de contacto (signals, zoneless-safe)
  readonly formName = signal('');
  readonly formEmail = signal('');
  readonly formPhone = signal('');
  readonly formMessage = signal('');
  readonly sending = signal(false);
  readonly submitted = signal(false);
  readonly formError = signal('');

  readonly primaryColor = computed(
    () => this.document()?.theme?.primary_color ?? '#1E40AF',
  );

  readonly secondaryColor = computed(
    () => this.document()?.theme?.secondary_color ?? '#0F172A',
  );

  readonly enableWhatsappFloat = computed(
    () => this.document()?.theme?.enable_whatsapp_float ?? true,
  );

  readonly whatsappUrl = computed(() => {
    const rawNumber = this.document()?.theme?.whatsapp_number?.trim();
    const rawMsg =
      this.document()?.theme?.whatsapp_message?.trim() ||
      '¡Hola! Vi su catálogo en la landing y quiero más información.';
    if (!rawNumber) return null;
    const cleanNumber = rawNumber.replace(/[^0-9]/g, '');
    return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(rawMsg)}`;
  });

  constructor() {
    this.loadDocument();

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

  onForm(field: 'name' | 'email' | 'phone' | 'message', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    switch (field) {
      case 'name':
        this.formName.set(value);
        break;
      case 'email':
        this.formEmail.set(value);
        break;
      case 'phone':
        this.formPhone.set(value);
        break;
      case 'message':
        this.formMessage.set(value);
        break;
    }
  }

  submitContact(): void {
    const name = this.formName().trim();
    const message = this.formMessage().trim();
    const email = this.formEmail().trim();
    const phone = this.formPhone().trim();

    if (!name || !message) {
      this.formError.set('Cuéntanos tu nombre y qué necesitas.');
      return;
    }
    if (!email && !phone) {
      this.formError.set('Déjanos tu correo o tu teléfono para responderte.');
      return;
    }

    this.sending.set(true);
    this.formError.set('');
    const payload: CrmContactPayload = {
      first_name: name,
      message,
      ...(email && { email }),
      ...(phone && { phone }),
    };
    this.crmLandingService.submitContact(payload).subscribe({
      next: () => {
        this.submitted.set(true);
        this.sending.set(false);
      },
      error: (err) => {
        this.sending.set(false);
        const apiError = err?.error?.message;
        this.formError.set(
          typeof apiError === 'string'
            ? apiError
            : 'No pudimos enviar tu mensaje. Intenta de nuevo.',
        );
      },
    });
  }

  goToStore(): void {
    const base = this.ecommerceBaseUrl();
    if (base) {
      window.location.href = `${base}/catalog`;
    }
  }

  scrollToForm(): void {
    document.getElementById('contacto')?.scrollIntoView({ behavior: 'smooth' });
  }
}
