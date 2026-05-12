import { Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { DianConfig } from '../../interfaces/invoice.interface';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

interface ChecklistItem {
  label: string;
  done: boolean;
  icon: string;
}

// TODO: reemplazar por URL oficial DIAN cuando exista constante en el dominio.
const DIAN_DOC_URL = '#';

/**
 * Contextual setup guide for DIAN configuration.
 *
 * Renders a checklist derived from the given DianConfig and a pill
 * indicating the current enablement status.
 *
 * - Sticky on desktop, scrolls normally on mobile.
 * - `config` is null when no config has been created yet — the checklist
 *   still renders with everything unchecked.
 */
@Component({
  selector: 'vendix-dian-setup-guide',
  standalone: true,
  imports: [NgClass, IconComponent],
  template: `
    <aside
      class="border border-border rounded-xl p-4 bg-white space-y-3
             md:sticky md:top-4"
    >
      <div class="flex items-center gap-2">
        <app-icon name="info" [size]="16" class="text-primary"></app-icon>
        <h3 class="text-sm font-semibold text-text-primary">Guia de habilitacion DIAN</h3>
      </div>

      <!-- Enablement Status Pill -->
      <div class="flex items-center justify-between">
        <span class="text-xs text-text-secondary">Estado</span>
        <span
          class="px-2 py-0.5 rounded-full text-[11px] font-medium"
          [ngClass]="statusPillClass()"
        >
          {{ statusLabel() }}
        </span>
      </div>

      <!-- Checklist -->
      <ul class="space-y-2 pt-2 border-t border-border">
        @for (item of checklist(); track item.label) {
          <li class="flex items-start gap-2 text-xs">
            <app-icon
              [name]="item.done ? 'check-circle' : 'circle'"
              [size]="14"
              [class]="item.done ? 'text-green-600 mt-0.5' : 'text-gray-300 mt-0.5'"
            ></app-icon>
            <span [ngClass]="item.done ? 'text-text-primary' : 'text-text-secondary'">
              {{ item.label }}
            </span>
          </li>
        }
      </ul>

      <!-- Help link -->
      <div class="pt-2 border-t border-border">
        <a
          [href]="docUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          <app-icon name="external-link" [size]="12"></app-icon>
          Que es la habilitacion DIAN?
        </a>
      </div>
    </aside>
  `,
})
export class DianSetupGuideComponent {
  readonly config = input.required<DianConfig | null>();

  readonly docUrl = DIAN_DOC_URL;

  readonly checklist = computed<ChecklistItem[]>(() => {
    const cfg = this.config();
    return [
      {
        label: 'Credenciales ingresadas (NIT + software)',
        done: !!(cfg?.nit && cfg?.software_id),
        icon: 'key',
      },
      {
        label: 'Certificado digital cargado (.p12)',
        done: !!cfg?.certificate_s3_key,
        icon: 'upload',
      },
      {
        label: 'Ambiente configurado',
        done: !!cfg?.environment,
        icon: 'globe',
      },
      {
        label: 'Set de pruebas completado',
        done: cfg?.enablement_status === 'testing' || cfg?.enablement_status === 'enabled',
        icon: 'zap',
      },
      {
        label: 'Produccion habilitada',
        done: cfg?.enablement_status === 'enabled',
        icon: 'check-circle',
      },
    ];
  });

  readonly statusLabel = computed(() => {
    const s = this.config()?.enablement_status ?? 'not_started';
    const labels: Record<string, string> = {
      not_started: 'No iniciado',
      testing: 'En pruebas',
      enabled: 'Habilitado',
      suspended: 'Suspendido',
    };
    return labels[s] || s;
  });

  readonly statusPillClass = computed(() => {
    const s = this.config()?.enablement_status ?? 'not_started';
    const classes: Record<string, string> = {
      not_started: 'bg-gray-100 text-gray-600',
      testing: 'bg-yellow-100 text-yellow-700',
      enabled: 'bg-green-100 text-green-700',
      suspended: 'bg-red-100 text-red-700',
    };
    return classes[s] || 'bg-gray-100 text-gray-600';
  });
}
