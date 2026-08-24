import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { NgClass } from '@angular/common';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InvoiceResolution } from '../../interfaces/invoice.interface';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

/** Umbral de aviso: quedan menos del 10% de los números autorizados. */
const LOW_RANGE_RATIO = 0.1;

type BannerState = 'ok' | 'low' | 'expired' | 'exhausted' | 'missing';

/**
 * LA RESOLUCIÓN NO SE ELIGE: SE INFORMA.
 *
 * Antes era un `app-selector` con `formControlName="resolution_id"`, y esa era
 * la peor decisión de toda la pantalla. Elegir mal una resolución no produce un
 * error: produce una factura numerada con el rango equivocado. La DIAN la acepta
 * o la rechaza, pero el consecutivo autorizado YA SE GASTÓ y no se recupera —
 * y del otro lado queda un hueco de numeración que hay que explicarle a la DIAN.
 *
 * El backend nunca necesitó esa elección: `InvoiceNumberGenerator` busca la
 * resolución activa POR TIPO DE DOCUMENTO y entidad contable
 * (`toFiscalDocumentType(invoice_type)`). El único efecto de mandar
 * `resolution_id` desde el formulario era permitir contradecirlo.
 *
 * Este banner enseña la MISMA fila que el backend va a consumir, con los tres
 * datos que deciden si la factura va a salir: número autorizado, cuánto queda
 * del rango y hasta cuándo vale.
 */
@Component({
  selector: 'vendix-invoice-resolution-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, IconComponent],
  // Host en BLOQUE por lo mismo que app-alert-banner: un elemento a medida se
  // muestra inline, y un elemento inline ignora los márgenes verticales, así
  // que la clase space-y-* del contenedor no lo separaba del control de arriba.
  // Medido en el navegador: 0 px de separación antes de esto.
  host: { class: 'block' },
  template: `
    <div
      class="rounded-lg border p-3 flex items-start gap-3"
      [ngClass]="containerClass()"
      role="status"
    >
      <!--
        El color va por el input class (aliasado) del icono, que es el que
        llega al i-lucide interno; currentColor hace el resto.
      -->
      <app-icon [name]="icon()" [size]="18" [class]="iconClass()" />

      <div class="flex-1 min-w-0 space-y-0.5">
        @if (loading()) {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Buscando la resolución activa…
          </p>
        } @else if (resolution(); as res) {
          <p class="text-sm font-semibold text-text-primary">
            Resolución {{ res.resolution_number }}, prefijo
            {{ res.prefix || '(sin prefijo)' }}, consecutivo
            {{ nextNumber() }} de {{ res.range_to }}, vence
            {{ validTo() }}
          </p>
          <p class="text-xs text-[var(--color-text-secondary)]">
            {{ documentLabel() }} · quedan {{ remaining() }} números autorizados
            de {{ rangeSize() }}
          </p>
          @if (warning(); as text) {
            <p class="text-xs font-medium" [ngClass]="toneClass()">
              {{ text }}
            </p>
          }
        } @else {
          <p class="text-sm font-semibold text-error">
            No hay resolución activa para {{ documentLabel() }}
          </p>
          <p class="text-xs text-error">
            El servidor no tendrá de dónde tomar el consecutivo y la factura
            será rechazada. Registra o activa la resolución en Facturación →
            Resoluciones antes de emitir.
          </p>
        }
      </div>
    </div>
  `,
})
export class InvoiceResolutionBannerComponent {
  /** Fila que el backend va a consumir. `null` = no hay ninguna activa. */
  readonly resolution = input<InvoiceResolution | null>(null);
  readonly loading = input<boolean>(false);
  /** Nombre legible del documento ("Factura de venta"). */
  readonly documentLabel = input<string>('Factura de venta');

  /** Último consecutivo consumido, con el piso del rango aplicado. */
  private readonly cursor = computed(() => {
    const res = this.resolution();
    if (!res) return 0;
    const from = Number(res.range_from) || 0;
    const current = Number(res.current_number) || 0;
    // El generador hace exactamente esto: un cursor a la deriva (por debajo del
    // rango) se sube al piso autorizado antes de emitir.
    return Math.max(current, from - 1);
  });

  readonly nextNumber = computed(() => this.cursor() + 1);

  readonly rangeSize = computed(() => {
    const res = this.resolution();
    if (!res) return 0;
    const from = Number(res.range_from) || 0;
    const to = Number(res.range_to) || 0;
    return Math.max(to - from + 1, 0);
  });

  readonly remaining = computed(() => {
    const res = this.resolution();
    if (!res) return 0;
    return Math.max(Number(res.range_to) - this.cursor(), 0);
  });

  readonly validTo = computed(() => {
    const res = this.resolution();
    if (!res?.valid_to) return 'sin vigencia declarada';
    return formatDateOnlyUTC(res.valid_to);
  });

  readonly state = computed<BannerState>(() => {
    const res = this.resolution();
    if (!res) return 'missing';
    if (this.remaining() <= 0) return 'exhausted';
    if (isExpired(res.valid_to)) return 'expired';
    const size = this.rangeSize();
    if (size > 0 && this.remaining() / size <= LOW_RANGE_RATIO) return 'low';
    return 'ok';
  });

  /** Estados en los que emitir va a fallar o quemar numeración inválida. */
  readonly isBlocking = computed(() => {
    const state = this.state();
    return state === 'missing' || state === 'exhausted' || state === 'expired';
  });

  readonly icon = computed(() => {
    switch (this.state()) {
      case 'ok':
        return 'file-check';
      case 'low':
        return 'alert-triangle';
      default:
        return 'alert-octagon';
    }
  });

  /**
   * Las clases se componen aquí y no con `[class.x]` en la plantilla porque el
   * fondo neutro es un valor arbitrario de Tailwind (`bg-[var(--…)]`) y sus
   * corchetes cierran el binding `[class.…]` antes de tiempo.
   */
  readonly containerClass = computed(() => {
    if (this.isBlocking()) return 'border-error bg-error-light';
    if (this.state() === 'low') return 'border-warning bg-warning-light';
    return 'border-border bg-[var(--color-surface-secondary)]';
  });

  readonly toneClass = computed(() => {
    if (this.isBlocking()) return 'text-error';
    if (this.state() === 'low') return 'text-warning';
    return 'text-primary';
  });

  readonly iconClass = computed(() => 'shrink-0 mt-0.5 ' + this.toneClass());

  readonly warning = computed<string | null>(() => {
    switch (this.state()) {
      case 'exhausted':
        return 'El rango autorizado se agotó. Registra una resolución nueva: cualquier factura que intentes emitir será rechazada.';
      case 'expired':
        return 'La vigencia de la resolución ya venció. La DIAN rechaza documentos numerados fuera de la vigencia autorizada.';
      case 'low':
        return 'Quedan pocos números autorizados. Solicita el nuevo rango a la DIAN antes de quedarte sin numeración a mitad de un día de ventas.';
      default:
        return null;
    }
  });
}

/** `true` cuando la vigencia declarada ya pasó. */
function isExpired(validTo: string | null | undefined): boolean {
  if (!validTo) return false;
  const date = new Date(validTo);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
}
