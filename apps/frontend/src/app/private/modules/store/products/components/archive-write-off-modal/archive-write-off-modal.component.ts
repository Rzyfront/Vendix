/**
 * CP-PURCHASE-TRANSPARENCY D.9 — la interfaz del castigo.
 *
 * ## QUÉ PROBLEMA RESUELVE
 *
 * Archivar un producto con existencias las DESTRUYE: el backend emite un ajuste
 * de tipo `loss` con `quantity_after = 0` por cada tripleta (ubicación,
 * variante) y recién después cambia el estado. Es la decisión de este plan, y es
 * correcta —el inventario fantasma de productos «borrados» seguía entrando en el
 * costo promedio ponderado y era el defecto que el usuario reportó—, pero es
 * también una destrucción irreversible que hasta ahora ocurría detrás de un
 * diálogo que decía «¿Está seguro de que desea eliminar X?» y nada más.
 *
 * Este modal existe para que lo que se va a destruir sea VISIBLE antes de
 * pulsar. Sin él, el operador recibe un 409 y un toast rojo genérico: no sabe
 * que hay existencias, no sabe que hay una confirmación posible, y no tiene
 * botón que la ofrezca.
 *
 * ## SON TRES ESTADOS, NO DOS
 *
 * 1. **Archiva directo** (`requires_confirmation === false`) — este modal NI
 *    SIQUIERA SE ABRE. Lo decide el llamador (`products.component.ts`) y el
 *    producto sin existencias conserva exactamente el diálogo de siempre.
 * 2. **Pide confirmación** (`requires_confirmation && out_of_scope_units === 0`)
 *    — el cuerpo enumera unidades, valor y desglose, y el botón se habilita
 *    sólo con la casilla marcada.
 * 3. **Bloqueado** (`out_of_scope_units > 0`) — NO HAY BOTÓN DE CONFIRMAR. Hay
 *    existencias en ubicaciones que esta tienda no puede escribir y el cuerpo
 *    dice qué hacer: transferirlas o ajustarlas desde Inventario.
 *
 * El estado 3 no es una variante del 2 con el botón deshabilitado: es una
 * pantalla distinta, porque la acción que el operador tiene que emprender es
 * otra y ocurre en otro módulo.
 *
 * ## LA TRAMPA DE COPY QUE JUSTIFICA MEDIO COMPONENTE
 *
 * `zero_cost_units` significa **costo desconocido**, no «la mercancía fue
 * gratis». Medido en desarrollo: el 63,9 % de las unidades fantasma están en ese
 * caso. Un modal que dijera «valor a dar de baja: $0» dejaría al operador
 * confirmando tranquilo la destrucción de más de un millón de unidades creyendo
 * que no valían nada. Por eso las unidades sin costo se separan visualmente del
 * valor conocido, se nombran, y cuando son TODAS el modal deja de presentar el
 * cero como una cifra y lo presenta como una ausencia.
 *
 * Y por eso el valor se rotula «estimado»: bajo FIFO el costo real sale de las
 * capas en el momento de la baja y puede diferir del `unit_cost` que se enseña
 * aquí. Prometer exactitud que el backend no da sería el mismo tipo de engaño
 * que este paso corrige.
 *
 * ## PRESENTACIONAL A PROPÓSITO
 *
 * No hace HTTP. Recibe el plan y emite `confirmed`; el llamador es dueño del
 * preview, del `DELETE` y de qué hacer con el resultado. Motivo: el plan llega
 * por DOS puertas —la vista previa y el `details` del 409— y el componente no
 * debe saber por cuál. Así el mismo modal sirve para el flujo planificado y
 * para el rechazo inesperado, sin una segunda ruta que se desvíe de la primera.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';

import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import type {
  ArchiveWriteOffLine,
  ArchiveWriteOffPlan,
} from '../../interfaces';

@Component({
  selector: 'app-archive-write-off-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    AlertBannerComponent,
  ],
  templateUrl: './archive-write-off-modal.component.html',
})
export class ArchiveWriteOffModalComponent {
  private readonly currencyFormat = inject(CurrencyFormatService);

  /** Visibilidad. Two-way con la pantalla del catálogo. */
  readonly modalOpen = model<boolean>(false);

  /** El plan del castigo. `null` mientras no hay nada que enseñar. */
  readonly plan = input<ArchiveWriteOffPlan | null>(null);

  /** Nombre del producto, para que el título diga cuál. */
  readonly productName = input<string>('');

  /** El `DELETE` está en vuelo: el pie bloquea y anuncia. */
  readonly archiving = input<boolean>(false);

  /**
   * Error del intento de confirmación, ya redactado por el llamador.
   *
   * Se pinta DENTRO del modal y no como toast: el operador está mirando aquí, y
   * un toast que aparece detrás de un modal abierto es un mensaje que nadie lee.
   */
  readonly errorMessage = input<string | null>(null);

  /** El operador vio el desglose y dijo que sí. */
  readonly confirmed = output<void>();

  /**
   * El gesto deliberado. Arranca en `false` en cada apertura: un botón se pulsa
   * por inercia, marcar una casilla que dice qué se destruye no.
   */
  readonly acknowledged = signal<boolean>(false);

  // ───────────────────────────────────────────────────────────────────────────
  // Estado derivado
  // ───────────────────────────────────────────────────────────────────────────

  /** Estado 3. Existencias que esta tienda no puede tocar: no hay confirmación. */
  readonly isBlocked = computed<boolean>(
    () => (this.plan()?.out_of_scope_units ?? 0) > 0,
  );

  readonly totalUnits = computed<number>(() => this.plan()?.total_units ?? 0);
  readonly totalValue = computed<number>(() => this.plan()?.total_value ?? 0);
  readonly zeroCostUnits = computed<number>(
    () => this.plan()?.zero_cost_units ?? 0,
  );
  readonly outOfScopeUnits = computed<number>(
    () => this.plan()?.out_of_scope_units ?? 0,
  );

  /** Unidades cuyo costo SÍ se conoce. Es lo único que `total_value` cubre. */
  readonly knownCostUnits = computed<number>(() =>
    Math.max(0, this.totalUnits() - this.zeroCostUnits()),
  );

  /**
   * NINGUNA unidad tiene costo. El caso peligroso: `total_value` vale 0 y sin
   * este predicado la pantalla presentaría un cero que parece «no vale nada»
   * cuando significa «no sabemos cuánto vale».
   */
  readonly allUnitsUnknownCost = computed<boolean>(
    () => this.totalUnits() > 0 && this.zeroCostUnits() >= this.totalUnits(),
  );

  readonly hasUnknownCost = computed<boolean>(() => this.zeroCostUnits() > 0);

  readonly lines = computed<ArchiveWriteOffLine[]>(() => {
    const lines = this.plan()?.lines ?? [];
    // Primero lo que más pesa: la fila con más unidades es la que el operador
    // necesita reconocer para decidir si esto es lo que cree que es.
    return [...lines].sort((a, b) => b.quantity_on_hand - a.quantity_on_hand);
  });

  readonly outOfScopeRows = computed(() => this.plan()?.out_of_scope ?? []);

  /**
   * Rótulo del botón de confirmar.
   *
   * Vive en un `computed` y no en la plantilla porque el botón proyecta su
   * icono por `ng-content select="[slot=icon]"`, y un `@if` alrededor del
   * contenido rompería esa proyección (los nodos de un bloque de control de
   * flujo no casan con un `select`). El rótulo nombra la cifra: «Eliminar» a
   * secas no dice qué se destruye.
   */
  readonly confirmLabel = computed<string>(() => {
    if (this.archiving()) {
      return 'Dando de baja…';
    }
    const units = this.totalUnits();
    return `Dar de baja ${units} ${this.unitsLabel(units)} y eliminar`;
  });

  /** Las dos condiciones del gesto. Falta cualquiera y no se confirma. */
  readonly canConfirm = computed<boolean>(
    () =>
      !this.isBlocked() &&
      !this.archiving() &&
      this.totalUnits() > 0 &&
      this.acknowledged(),
  );

  /**
   * Formateador de dinero.
   *
   * `computed` que DEVUELVE una función, no un método suelto: leer
   * `currentCurrency()` aquí dentro ata el formateo a la señal de moneda, y así
   * las cifras se re-pintan cuando la moneda de la tienda termina de cargar. Un
   * método normal invocado desde la plantilla no volvería a evaluarse.
   */
  readonly money = computed<(value: number) => string>(() => {
    this.currencyFormat.currentCurrency();
    return (value: number): string => this.currencyFormat.format(value || 0);
  });

  constructor() {
    // `app-modal` proyecta su contenido con `<ng-content>` y NO lo destruye al
    // cerrar. Sin este reset el modal reabriría con la casilla ya marcada y el
    // gesto deliberado se habría convertido en un botón de un solo clic.
    effect(() => {
      if (!this.modalOpen()) {
        untracked(() => this.acknowledged.set(false));
      }
    });

    // Un plan nuevo es un impacto nuevo. Ocurre cuando el `DELETE` es rechazado
    // con un plan MÁS FRESCO que el del preview (las existencias cambiaron entre
    // el cálculo y el clic): lo que el operador aceptó ya no es lo que va a
    // pasar, así que el consentimiento se retira y hay que volver a darlo.
    effect(() => {
      this.plan();
      untracked(() => this.acknowledged.set(false));
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Acciones
  // ───────────────────────────────────────────────────────────────────────────

  onAcknowledgeChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.acknowledged.set(Boolean(target?.checked));
  }

  onConfirm(): void {
    // Re-comprobación en el manejador y no sólo en el `[disabled]` del botón: un
    // atributo deshabilitado es afordancia, no control de acceso.
    if (!this.canConfirm()) {
      return;
    }
    this.confirmed.emit();
  }

  onClose(): void {
    if (this.archiving()) {
      return;
    }
    this.modalOpen.set(false);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Presentación
  // ───────────────────────────────────────────────────────────────────────────

  /** Etiqueta de la fila: la variante si la hay, el producto base si no. */
  describeLine(line: ArchiveWriteOffLine): string {
    if (line.variant_sku) {
      return line.variant_sku;
    }
    if (line.product_variant_id !== null) {
      return `Variante #${line.product_variant_id}`;
    }
    return 'Producto base';
  }

  unitsLabel(count: number): string {
    return count === 1 ? 'unidad' : 'unidades';
  }
}
