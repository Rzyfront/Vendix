import { Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  BadgeComponent,
  BadgeVariant,
} from '../../../../../../shared/components/badge/badge.component';
import type { SubscriptionFiscalStatus } from '../../../subscriptions/interfaces/fiscal-billing.interface';

interface ChecklistItem {
  label: string;
  done: boolean;
}

/**
 * Guía contextual de habilitación DIAN para la plataforma.
 *
 * Equivalente de `vendix-dian-setup-guide` (tiendas), que no se pudo reutilizar
 * tal cual porque lee `DianConfig` del dominio de tienda y aquí la forma es
 * `SubscriptionFiscalStatus`. Lo que sí se conserva es el patrón: checklist
 * derivado del estado real + píldora de habilitación, pegajosa en escritorio.
 *
 * El checklist se deriva, nunca se guarda: un paso "marcado" que no refleje el
 * backend es peor que no tener guía.
 */
@Component({
  selector: 'app-platform-dian-guide',
  standalone: true,
  imports: [NgClass, IconComponent, BadgeComponent],
  template: `
    <aside
      class="border border-border rounded-xl p-4 bg-[var(--color-surface)] space-y-3 md:sticky md:top-4"
    >
      <div class="flex items-center gap-2">
        <app-icon name="info" [size]="16" class="text-primary"></app-icon>
        <h3 class="text-sm font-semibold text-text-primary">
          Guía de habilitación DIAN
        </h3>
      </div>

      <div class="flex items-center justify-between">
        <span class="text-xs text-text-secondary">Estado</span>
        <app-badge [variant]="statusVariant()" size="xs">
          {{ statusLabel() }}
        </app-badge>
      </div>

      <ul class="space-y-2 pt-2 border-t border-border">
        @for (item of checklist(); track item.label) {
          <li class="flex items-start gap-2 text-xs">
            <app-icon
              [name]="item.done ? 'check-circle' : 'circle'"
              [size]="14"
              [class]="
                item.done ? 'text-success mt-0.5' : 'text-text-secondary mt-0.5'
              "
            ></app-icon>
            <span
              [ngClass]="item.done ? 'text-text-primary' : 'text-text-secondary'"
            >
              {{ item.label }}
            </span>
          </li>
        }
      </ul>

      <p
        class="text-[11px] leading-relaxed text-text-secondary pt-2 border-t border-border"
      >
        La DIAN exige aprobar el set de 50 documentos con el NIT propio antes de
        habilitar producción. Guardar credenciales no habilita: el veredicto lo
        da la DIAN sobre el set enviado.
      </p>
    </aside>
  `,
})
export class PlatformDianGuideComponent {
  readonly status = input<SubscriptionFiscalStatus | null>(null);

  readonly checklist = computed<ChecklistItem[]>(() => {
    const status = this.status();
    const settings = status?.settings ?? null;
    const config = status?.dian_config ?? null;
    const lastTest = settings?.last_test_result ?? null;

    return [
      {
        label: 'Entidad emisora y NIT de la plataforma',
        done: !!config?.nit,
      },
      {
        label: 'Software ID y PIN emitidos por la DIAN',
        done: !!config?.software_id && !!config?.software_pin_encrypted,
      },
      {
        label: 'Certificado de firma P12 cargado',
        done: !!config?.has_certificate,
      },
      {
        label: 'Resolución de numeración asignada',
        done: !!settings?.invoice_resolution_id,
      },
      {
        label: 'Test de conexión con la DIAN exitoso',
        done: lastTest?.ok === true,
      },
      {
        label: 'Set de pruebas aprobado (habilitación)',
        done: config?.enablement_status === 'enabled',
      },
      {
        label: 'Emisión activa en producción',
        done: settings?.is_enabled === true && settings.environment === 'production',
      },
    ];
  });

  readonly statusLabel = computed<string>(() => {
    const config = this.status()?.dian_config ?? null;
    if (!config) return 'Sin configurar';
    switch (config.enablement_status) {
      case 'enabled':
        return 'Habilitado';
      case 'in_progress':
      case 'testing':
        return 'En habilitación';
      case 'rejected':
        return 'Rechazado';
      default:
        return config.enablement_status || 'Pendiente';
    }
  });

  readonly statusVariant = computed<BadgeVariant>(() => {
    const enablement = this.status()?.dian_config?.enablement_status;
    if (enablement === 'enabled') return 'success';
    if (enablement === 'rejected') return 'error';
    if (!enablement) return 'neutral';
    return 'warning';
  });
}
