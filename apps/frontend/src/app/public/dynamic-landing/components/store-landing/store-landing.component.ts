import {
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ConfigFacade } from '../../../../core/store/config';
import { ThemeService } from '../../../../core/services';
import { toTitleCase } from '../../../../core/utils/format.utils';
import { LandingLayoutComponent } from '../../../../shared/components/layouts/landing-layout/landing-layout.component';
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
 * contenido publicado muestra el estado vacío controlado.
 */
@Component({
  selector: 'app-store-landing',
  standalone: true,
  imports: [
    CommonModule,
    LandingLayoutComponent,
    BlockRendererComponent,
    ContactBlockComponent,
    IconComponent,
  ],
  template: `
    <app-landing-layout [brandName]="storeName()" [logoUrl]="logoUrl()">
      <div class="crm-landing" [style.--crm-primary]="primaryColor()">
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
                <section id="contacto" class="crm-contact-form">
                  <h3>Cuéntanos qué necesitas</h3>
                  <div class="crm-form-grid">
                    <input
                      class="crm-field"
                      type="text"
                      placeholder="Tu nombre *"
                      maxlength="80"
                      [value]="formName()"
                      (input)="onForm('name', $event)"
                    />
                    <input
                      class="crm-field"
                      type="email"
                      placeholder="Correo electrónico"
                      maxlength="160"
                      [value]="formEmail()"
                      (input)="onForm('email', $event)"
                    />
                    <input
                      class="crm-field"
                      type="tel"
                      placeholder="Teléfono / WhatsApp"
                      maxlength="30"
                      [value]="formPhone()"
                      (input)="onForm('phone', $event)"
                    />
                  </div>
                  <textarea
                    class="crm-field"
                    rows="4"
                    placeholder="¿En qué podemos ayudarte? *"
                    maxlength="1000"
                    [value]="formMessage()"
                    (input)="onForm('message', $event)"
                  ></textarea>

                  @if (submitted()) {
                    <p class="crm-form-ok">
                      ¡Gracias! Tu mensaje llegó a la tienda y te responderán
                      pronto.
                    </p>
                  } @else {
                    @if (formError()) {
                      <p class="crm-form-error">{{ formError() }}</p>
                    }
                    <button
                      type="button"
                      class="crm-submit"
                      [disabled]="sending()"
                      (click)="submitContact()"
                    >
                      {{ sending() ? 'Enviando…' : 'Enviar mensaje' }}
                    </button>
                  }
                </section>
              } @else {
                <app-block-renderer
                  [block]="block"
                  [baseUrl]="ecommerceBaseUrl()"
                  (ctaClick)="goToStore()"
                />
              }
            </div>
          }
        } @else {
          <section class="crm-state crm-state-empty">
            <h2>Muy pronto</h2>
            <p>Esta tienda aún no tiene publicada su página.</p>
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
      .crm-contact-form {
        max-width: 560px;
        margin: 0 auto;
        padding: 24px 16px 48px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .crm-contact-form h3 {
        text-align: center;
        margin: 0 0 4px;
        font-size: 1.1rem;
      }
      .crm-form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .crm-form-grid input:first-child {
        grid-column: 1 / -1;
      }
      .crm-field {
        width: 100%;
        border: 1px solid var(--color-border, #d1d5db);
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 0.9rem;
        font-family: inherit;
        background: var(--bg-surface, #fff);
        box-sizing: border-box;
      }
      .crm-field:focus {
        outline: 2px solid var(--crm-primary, #3b82f6);
        border-color: transparent;
      }
      textarea.crm-field {
        resize: vertical;
      }
      .crm-submit {
        align-self: center;
        border: 0;
        background: var(--crm-primary, #3b82f6);
        color: #fff;
        font-weight: 600;
        padding: 11px 26px;
        border-radius: 999px;
        cursor: pointer;
      }
      .crm-submit:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .crm-form-ok {
        text-align: center;
        color: #15803d;
        font-weight: 500;
        margin: 0;
      }
      .crm-form-error {
        text-align: center;
        color: #dc2626;
        font-size: 0.85rem;
        margin: 0;
      }
      @media (max-width: 480px) {
        .crm-form-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class StoreLandingComponent {
  private readonly configFacade = inject(ConfigFacade);
  private readonly themeService = inject(ThemeService);
  private readonly crmLandingService = inject(CrmLandingService);

  // Branding del host (header/footer del layout)
  readonly storeName = signal('Tienda');
  readonly logoUrl = signal<string | undefined>(undefined);

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
    () => this.document()?.theme?.primary_color ?? '#3b82f6',
  );

  constructor() {
    this.loadBranding();
    this.loadDocument();
  }

  private loadBranding(): void {
    const appConfig = this.configFacade.getCurrentConfig();
    if (!appConfig) return;
    const domainConfig = appConfig.domainConfig;
    this.storeName.set(
      toTitleCase(
        (
          domainConfig.store_name ||
          domainConfig.store_slug ||
          'Tienda'
        ).replace(/[-_]+/g, ' ').trim(),
      ),
    );
    this.logoUrl.set(appConfig.branding?.logo?.url ?? undefined);
    if (appConfig.branding) {
      this.themeService.applyBranding(appConfig.branding);
    }
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
