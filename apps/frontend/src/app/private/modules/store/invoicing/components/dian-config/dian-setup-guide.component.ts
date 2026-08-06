import { Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { DianConfig } from '../../interfaces/invoice.interface';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  BadgeComponent,
  BadgeVariant,
} from '../../../../../../shared/components/badge/badge.component';
import {
  dianEnablementLabel,
  dianEnablementVariant,
  isProductionEnabled,
  isTestSetApproved,
} from '../../../../../../core/utils/dian-enablement-status.util';

interface ChecklistItem {
  label: string;
  done: boolean;
}

/**
 * Lo único que esta guía lee de `last_test_result`, que llega como `any`.
 *
 * Se declara en vez de usar `Record<string, any>` porque el proyecto compila con
 * `noPropertyAccessFromIndexSignature`: sobre un índice, `test?.zip_key` no
 * compila y `test?.['zip_key']` compila pero no verifica nada.
 */
interface TestResultEvidence {
  resolution_id?: number | null;
  zip_key?: string | null;
  executed_at?: string | null;
}

/**
 * Guía contextual de habilitación DIAN para tiendas.
 *
 * Paridad de contenido con `app-platform-dian-guide`. Los dos componentes siguen
 * separados porque leen formas distintas (`DianConfig` aquí,
 * `SubscriptionFiscalStatus` allá), pero la regla de estado —qué cuenta como set
 * aprobado, qué etiqueta lleva cada estado— vive en
 * `core/utils/dian-enablement-status.util`, con un solo dueño. Estaba duplicada y
 * cada copia estaba mal de forma distinta.
 *
 * EL CHECKLIST SE DERIVA, NUNCA SE GUARDA: un paso marcado que no refleje el
 * backend es peor que no tener guía. Corolario: si un dato no sobrevive a un
 * refresco, su paso no se marca.
 */
@Component({
  selector: 'vendix-dian-setup-guide',
  standalone: true,
  imports: [NgClass, IconComponent, BadgeComponent],
  template: `
    <aside
      class="border border-border rounded-xl p-4 bg-[var(--color-surface)] space-y-3
             md:sticky md:top-4"
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
        La DIAN exige aprobar el set de habilitación con tu propio NIT antes de
        emitir en producción. Guardar credenciales no habilita: el veredicto lo da
        la DIAN sobre el set enviado, y puede tardar desde minutos hasta horas. La
        cantidad exacta de documentos la fija la DIAN por set y la muestra su
        portal en «Total de documentos requeridos».
      </p>
    </aside>
  `,
})
export class DianSetupGuideComponent {
  readonly config = input.required<DianConfig | null>();

  readonly checklist = computed<ChecklistItem[]>(() => {
    const cfg = this.config();
    // `last_test_result` es la única evidencia DURABLE de haber llegado a hablar
    // con la DIAN: el test de conexión solo escribe un audit log que esta lectura
    // no trae, así que marcar su paso desde memoria se caería al refrescar.
    const test = (cfg?.last_test_result ?? null) as TestResultEvidence | null;

    return [
      {
        label: 'NIT y tipo de contribuyente registrados',
        done: !!cfg?.nit && !!cfg?.nit_type,
      },
      {
        label: 'Software ID y PIN emitidos por la DIAN',
        done: !!cfg?.software_id && !!cfg?.software_pin_encrypted,
      },
      {
        label: 'Certificado de firma P12 cargado',
        done: !!cfg?.certificate_s3_key,
      },
      {
        label: 'Set de pruebas asignado por la DIAN',
        done: !!cfg?.test_set_id,
      },
      {
        label: 'Resolución de numeración asignada',
        done: !!test?.resolution_id,
      },
      {
        // Evidencia MÁS fuerte que el test de conexión, que da por «conectado» un
        // SOAP Fault —o sea, la DIAN rechazando la autenticación—. Si existe un
        // ZipKey, entonces conexión, WS-Security y firma del certificado
        // funcionaron las tres: la DIAN acusó recibo de un lote firmado.
        label: 'Conexión y firma verificadas con la DIAN',
        done: !!(test?.zip_key || test?.executed_at),
      },
      {
        // `testing` significa EN CURSO y NO cuenta. Marcarlo como completado era
        // el bug: un tenant con la DIAN sin haber juzgado nada veía el paso verde.
        label: 'Set de pruebas aprobado (habilitación)',
        done: isTestSetApproved(cfg?.enablement_status),
      },
      {
        label: 'Emisión activa en producción',
        done:
          isProductionEnabled(cfg?.enablement_status) &&
          cfg?.environment === 'production',
      },
    ];
  });

  readonly statusLabel = computed(() =>
    this.config() ? dianEnablementLabel(this.config()!.enablement_status) : 'Sin configurar',
  );

  readonly statusVariant = computed<BadgeVariant>(() =>
    this.config()
      ? (dianEnablementVariant(this.config()!.enablement_status) as BadgeVariant)
      : 'neutral',
  );
}
