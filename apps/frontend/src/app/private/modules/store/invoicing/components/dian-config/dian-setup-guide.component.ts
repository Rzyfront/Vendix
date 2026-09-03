import { Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import {
  DianConfig,
  InvoiceResolution,
} from '../../interfaces/invoice.interface';
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
  /**
   * El paso ocurre FUERA de Vendix y ninguna lectura nuestra lo puede probar.
   *
   * Es un tercer estado y no un `done: false` a secas porque los otros ocho se
   * derivan de evidencia: ahí, gris significa «esto todavía no pasó». Aplicar
   * esa lectura a un hecho que no observamos dejaría un paso condenado a no
   * ponerse verde nunca, y el comerciante leería como bloqueo lo que en realidad
   * es un trámite suyo en otro portal. Marcarlo `done` sería peor: inventar
   * evidencia es exactamente la mentira que esta guía existe para no contar.
   */
  external?: boolean;
  /** Dónde se hace y qué se rompe si no se hace. Sólo para los pasos externos. */
  hint?: string;
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
 * `invoice_resolutions.document_type` existe en la base con default
 * `sales_invoice` y el backend lo devuelve, pero `InvoiceResolution` todavía no
 * lo declara. Se ensancha acá —sin tocar el contrato compartido— y una
 * resolución sin el campo se lee como factura de venta, que es el default de la
 * columna: comparar en estricto contra un campo que el tipo no declara
 * reproduciría el mismo paso gris que este arreglo elimina.
 */
type ResolutionWithDocumentType = InvoiceResolution & {
  document_type?: string | null;
};

/**
 * Lo ÚNICO que el checklist juzga de una resolución: si está activa y qué
 * documento numera.
 *
 * Se acepta esta forma mínima en vez de `InvoiceResolution` completa porque la
 * pantalla donde el comerciante se queda atascado —el detalle de una
 * habilitación— trabaja con `FiscalReadinessResolution`, la fila del agregado de
 * estado fiscal, que no carga `organization_id` ni `store_id` ni obliga a
 * `resolution_number`. Exigir la fila ancha era lo único que impedía montar la
 * guía junto al panel de rangos, y una guía que no se puede montar no le ahorra
 * el rodeo a nadie.
 */
export interface SetupGuideResolution {
  is_active: boolean;
  document_type?: string | null;
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
            <!-- El paso externo no usa el circulo vacio de los demas: ahi vacio
                 significa «te falta hacerlo dentro de Vendix», y este no se hace
                 aqui ni lo podemos ver. El icono de enlace externo dice a donde
                 va sin prometer que lo estemos vigilando.
                 (Sin backticks: este comentario vive dentro del template literal
                 del componente y un backtick lo corta.) -->
            <app-icon
              [name]="
                item.external
                  ? 'external-link'
                  : item.done
                    ? 'check-circle'
                    : 'circle'
              "
              [size]="14"
              [class]="
                item.done && !item.external
                  ? 'text-success mt-0.5'
                  : 'text-text-secondary mt-0.5'
              "
            ></app-icon>
            <span class="min-w-0">
              <span
                [ngClass]="
                  item.done && !item.external
                    ? 'text-text-primary'
                    : 'text-text-secondary'
                "
              >
                {{ item.label }}
              </span>
              @if (item.hint; as hint) {
                <span
                  class="block text-[11px] leading-relaxed text-text-secondary"
                >
                  {{ hint }}
                </span>
              }
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

  /**
   * Resoluciones del tenant. Opcional a propósito: hoy hay consumidores que sólo
   * pasan «config», y no deben perder nada por no pasarla.
   */
  readonly resolutions = input<SetupGuideResolution[]>([]);

  /**
   * ¿El tenant tiene resolución de numeración de factura de venta vigente?
   *
   * POR QUÉ NO SE MIRA «last_test_result»: esa es evidencia del último envío, no
   * del tenant. Un tenant con tres resoluciones activas cuyo último lote no
   * persistió «resolution_id» veía este paso gris mientras el de conexión y firma
   * salía verde — un lote firmado y enviado sin resolución es imposible, así que
   * la guía se contradecía a sí misma.
   */
  private readonly hasSalesInvoiceResolution = computed(() =>
    (this.resolutions() as ResolutionWithDocumentType[]).some(
      (r) =>
        r.is_active === true &&
        (r.document_type ?? 'sales_invoice') === 'sales_invoice',
    ),
  );

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
        // Dos formas para el mismo hecho, según quién pregunte. El panel del
        // comerciante recibe `certificate_s3_key`; la consola de super admin
        // la redacta —una clave de objeto nombra dónde vive el material
        // criptográfico de un tercero— y en su lugar publica el booleano
        // `certificate_present`. Leer sólo la primera hacía que la guía
        // marcara «falta el certificado» sobre configuraciones que sí lo
        // tienen, que es la peor forma de mentir: la que empuja a subirlo otra
        // vez.
        done: !!(cfg?.certificate_present ?? cfg?.certificate_s3_key),
      },
      {
        label: 'Set de pruebas asignado por la DIAN',
        done: !!cfg?.test_set_id,
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
        // Trámite del contribuyente en el portal de la DIAN, no una escritura
        // nuestra: ninguna lectura de Vendix —ni la configuración, ni el agregado
        // fiscal, ni el último resultado de pruebas— devuelve si el prefijo quedó
        // asociado al Software ID. Por eso viaja como paso externo y nunca en
        // verde. Va después de la aprobación del set porque el portal sólo lo
        // deja hacer sobre un software ya habilitado, y antes de la resolución
        // porque sin la asociación la DIAN rechaza los documentos aunque el rango
        // esté vigente y todo lo demás esté en orden.
        label: 'Prefijo asociado al software en el portal MUISCA',
        done: false,
        external: true,
        hint:
          'Se hace en el portal de la DIAN, en Configuración / Gestionar Asociación ' +
          'de Prefijos. Vendix no puede comprobarlo desde aquí.',
      },
      {
        // El nombre dice de dónde tiene que salir. La ClTec se trae de la DIAN
        // máquina a máquina; transcribirla del PDF fue la causa del incidente
        // FAD06 («Valor del CUFE no está calculado correctamente»): la clave
        // tecleada no era la autorizada, el CUFE salió mal y el consecutivo que
        // la DIAN ya había contado se gastó sin recuperarse. Un rango se aplica,
        // no se copia.
        label: 'Resolución de numeración aplicada desde la DIAN',
        // El respaldo sobre «last_test_result» se conserva para el consumidor que
        // no pasa «resolutions»: sin él, ese consumidor quedaría peor que antes.
        done: this.hasSalesInvoiceResolution() || !!test?.resolution_id,
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
