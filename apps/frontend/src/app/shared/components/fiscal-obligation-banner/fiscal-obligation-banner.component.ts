import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AuthFacade } from '../../../core/store/auth/auth.facade';
import {
  FISCAL_AREA_LABELS,
  FiscalArea,
} from '../../../core/models/fiscal-status.model';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-fiscal-obligation-banner',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    @if (visible()) {
      <div class="fiscal-banner" role="status">
        <div class="fiscal-banner__icon" aria-hidden="true">
          <app-icon name="receipt" [size]="18" />
        </div>
        <div class="fiscal-banner__content">
          <strong>{{ title() }}</strong>
          <span>{{ detail() }}</span>
        </div>
        <a
          class="fiscal-banner__cta"
          routerLink="/admin/settings/fiscal/wizard"
          [queryParams]="{ areas: pendingAreas().join(',') }"
        >
          Configurar
          <app-icon name="chevron-right" [size]="14" />
        </a>
        <button
          type="button"
          class="fiscal-banner__dismiss"
          aria-label="Ocultar aviso fiscal"
          (click)="dismiss()"
        >
          <app-icon name="close" [size]="16" />
        </button>
      </div>
    }
  `,
  styles: [
    `
      .fiscal-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-height: 3.25rem;
        padding: 0.65rem 1rem;
        border-bottom: 1px solid color-mix(in srgb, var(--primary-color, #2563eb) 22%, transparent);
        background: color-mix(in srgb, var(--primary-color, #2563eb) 7%, var(--surface-color, #ffffff));
        color: var(--text-primary, #111827);
      }

      .fiscal-banner__icon {
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        border-radius: 0.5rem;
        color: var(--primary-color, #2563eb);
        background: color-mix(in srgb, var(--primary-color, #2563eb) 12%, transparent);
        flex: 0 0 auto;
      }

      .fiscal-banner__content {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        font-size: 0.86rem;
        line-height: 1.25rem;
        flex: 1 1 auto;
      }

      .fiscal-banner__content span {
        color: var(--text-secondary, #4b5563);
      }

      .fiscal-banner__cta,
      .fiscal-banner__dismiss {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        border: 0;
        background: transparent;
        color: var(--primary-color, #2563eb);
        font-weight: 600;
        font-size: 0.85rem;
        text-decoration: none;
        white-space: nowrap;
      }

      .fiscal-banner__dismiss {
        width: 2rem;
        height: 2rem;
        justify-content: center;
        color: var(--text-secondary, #4b5563);
        cursor: pointer;
      }

      @media (max-width: 640px) {
        .fiscal-banner {
          align-items: flex-start;
          padding: 0.75rem;
        }

        .fiscal-banner__content {
          font-size: 0.8rem;
        }

        .fiscal-banner__cta {
          align-self: center;
        }
      }
    `,
  ],
})
export class FiscalObligationBannerComponent {
  private readonly authFacade = inject(AuthFacade);

  readonly pendingAreas = this.authFacade.pendingFiscalObligations;

  readonly title = computed(() => {
    const labels = this.areaLabels();
    if (labels.length === 1) {
      return `${labels[0]} puede ayudarte a vender mejor`;
    }
    return 'Activa el manejo fiscal cuando estés listo';
  });

  readonly detail = computed(() => {
    const labels = this.areaLabels();
    if (labels.length === 1 && this.pendingAreas()[0] === 'payroll') {
      return 'Detectamos empleados activos; puedes centralizar pagos, desprendibles y soportes sin bloquear tu operación.';
    }
    if (labels.length === 1 && this.pendingAreas()[0] === 'invoicing') {
      return 'Detectamos señales comerciales; puedes habilitar facturación electrónica para vender a empresas y ordenar tus soportes.';
    }
    return `Detectamos señales para ${labels.join(', ')}; la activación te ayuda con DIAN, IVA, soportes y cierres contables.`;
  });

  readonly visible = computed(() => {
    if (this.pendingAreas().length === 0) return false;
    const dismissedUntil =
      this.authFacade.userSettings()?.config?.fiscal_banner_dismissed_until;
    if (!dismissedUntil) return true;
    return new Date(dismissedUntil).getTime() <= Date.now();
  });

  dismiss(): void {
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const current = this.authFacade.userSettings() || {};
    this.authFacade.updateUserSettings({
      ...current,
      config: {
        ...(current.config || {}),
        fiscal_banner_dismissed_until: until,
      },
    });
  }

  private areaLabels(): string[] {
    return this.pendingAreas().map((area: FiscalArea) => FISCAL_AREA_LABELS[area]);
  }
}
