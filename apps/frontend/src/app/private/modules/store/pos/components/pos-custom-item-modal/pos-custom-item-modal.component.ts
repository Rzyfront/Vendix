import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';

import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { TaxOption } from '../../../../../../shared/components/tax-selector';
import { TaxCategory } from '../../../products/interfaces';
import {
  InvoiceCustomItemDraft,
  InvoiceCustomItemModalComponent,
} from '../../../invoicing/components/invoice-create/invoice-custom-item-modal.component';
import { computeLineMath } from '../../../invoicing/utils/invoice-line-math';
import { AddCustomItemRequest } from '../../models/cart.model';

/**
 * ÍTEM PERSONALIZADO EN VIVO, DESDE LA CAJA.
 *
 * ─── QUÉ ES Y QUÉ NO ES ─────────────────────────────────────────────────────
 *
 * Es un ADAPTADOR, no un modal. El modal es
 * `vendix-invoice-custom-item-modal`, el MISMO que usa el carril fiscal, y se
 * consume tal cual —sin tocarlo y sin copiarlo—. Tener dos capturas de ítem
 * personalizado es exactamente cómo se llega a que el POS y Fiscal emitan XML
 * distinto para el mismo concepto: dos formularios divergen a la primera
 * corrección, y la divergencia no da error, da dos documentos.
 *
 * Lo único que vive acá es la TRADUCCIÓN entre lo que ese modal captura y lo
 * que el cobro del POS puede declarar de verdad, más las guardas que impiden
 * mandar algo que el backend rechazaría con la venta entera dentro.
 *
 * ─── LA TRADUCCIÓN, CAMPO POR CAMPO ─────────────────────────────────────────
 *
 * `PosOrderItemDto` (apps/backend/src/domains/store/payments/dto/
 * create-pos-payment.dto.ts) es el contrato del cobro, y corre bajo el
 * `ValidationPipe` global con `forbidNonWhitelisted: true`. Cualquier clave que
 * no declare produce un 400 que tumba TODO el cobro, no sólo la línea. Por eso
 * nada de lo que el DTO no tenga sale de aquí:
 *
 * | Modal fiscal        | POS                          | Cómo viaja                |
 * |---------------------|------------------------------|---------------------------|
 * | `description`       | `product_name` + `description`| nombre = 1ª línea (≤255)  |
 * | `quantity`          | `quantity`                   | ENTERA ≥ 1 (ver guardas)  |
 * | `unit_price`        | `unit_price`/`final_unit_price`| plegado en el precio final|
 * | `discount_amount`   | —                            | plegado en el precio final|
 * | `taxes[]`           | `tax_category_id`            | UNA categoría (ver abajo) |
 * | `unit_code`         | —                            | no viaja (ver abajo)      |
 * | `account_code`      | —                            | no viaja                  |
 * | `aiu_component`     | —                            | no viaja (`isAiu=false`)  |
 *
 * ─── POR QUÉ EL PRECIO SE PLIEGA ────────────────────────────────────────────
 *
 * El cobro del POS no tiene descuento por línea ni bandera de "impuesto
 * incluido": para un ítem personalizado, `buildPosOrderItem` trata
 * `final_unit_price` como el precio CON impuesto y despeja la base dividiendo
 * por `(1 + Σtarifas)`. Así que la traducción honesta es entregar el precio
 * unitario final ya resuelto, y `computeLineMath` —la MISMA función que pinta la
 * previsión que el cajero acaba de ver en el modal— es quien lo resuelve. El
 * total de la línea en el carrito es, al centavo, el que decía la previsión;
 * ningún cálculo paralelo puede discrepar porque no hay un segundo cálculo.
 *
 * ─── POR QUÉ UN SOLO IMPUESTO, Y POR QUÉ SE BLOQUEA EN VEZ DE RECORTAR ──────
 *
 * `PosOrderItemDto` lleva `tax_category_id`: UNA categoría por línea. El backend
 * la expande a todas sus `tax_rates` y escribe una fila de `order_item_taxes`
 * por cada una, así que una categoría multi-tarifa SÍ produce una línea con
 * varios tributos (IVA + INC) y este adaptador la soporta sin cambios. Lo que no
 * cabe es combinar tarifas de categorías DISTINTAS.
 *
 * Ante eso hay dos salidas y sólo una es defendible: recortar en silencio la
 * segunda tarifa deja una factura que cuadra ante el motor y miente ante la
 * DIAN —el fallo más caro de este dominio y el que ya se pagó una vez—. Así que
 * se BLOQUEA la captura con el motivo escrito. Bloquear aquí no le toca un pelo
 * a la caja: todavía no hay venta, sólo una línea a medio escribir.
 *
 * ─── LAS RETENCIONES NO SON IMPUESTOS DE LÍNEA ──────────────────────────────
 *
 * `calculateTaxCategoryTaxes` SUMA ciegamente las tarifas de la categoría al
 * precio. Ofrecer "Retención en la Fuente 2.5%" en este selector haría que el
 * cajero le subiera 2,5% al cliente en vez de retenérselo. Se excluyen del
 * catálogo que se le pasa al modal.
 *
 * ─── SOBRE `unit_code` ──────────────────────────────────────────────────────
 *
 * No viaja porque el DTO del cobro no lo declara, y NO queda en blanco en el
 * XML: `invoice-flow.service.ts:assertLineUnitCodesResolved` considera resuelta
 * toda línea sin `product_id` —texto libre, flete, ajuste— y los armadores UBL
 * emiten `EA`, que es su unidad correcta y no un relleno. Que el modal lo capture
 * es inocuo; el carril fiscal sí lo usa.
 */
@Component({
  selector: 'app-pos-custom-item-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InvoiceCustomItemModalComponent],
  template: `
    <vendix-invoice-custom-item-modal
      [open]="open()"
      [draft]="null"
      [taxes]="taxOptions()"
      [isAiu]="false"
      [isEditing]="false"
      (saved)="onSaved($event)"
      (closed)="closed.emit()"
    />
  `,
})
export class PosCustomItemModalComponent {
  private readonly toast = inject(ToastService);

  readonly open = input<boolean>(false);

  /**
   * Catálogo de impuestos de la tienda, ya cargado por el POS
   * (`TaxesService.getTaxCategories()`, que pide `limit=500` y trae las
   * `tax_rates` anidadas). No se vuelve a pedir: el POS ya lo tiene.
   */
  readonly taxCategories = input<TaxCategory[]>([]);

  /** La línea lista para `PosCartService.addCustomItem`. */
  readonly added = output<AddCustomItemRequest>();
  readonly closed = output<void>();

  /**
   * Categorías que un cliente puede pagar. Ver la nota de retenciones arriba.
   */
  private readonly payableCategories = computed<TaxCategory[]>(() =>
    this.taxCategories().filter(
      (category) => !isWithholding(category.tax_type),
    ),
  );

  /**
   * Índice por el id que viaja en la opción.
   *
   * ⚠️ ESE ID ES DE `tax_categories`, NO DE `tax_rates`, aunque el modal lo
   * llame `tax_rate_id` al devolverlo. Es deliberado y no sale nunca de este
   * archivo: el POS declara el impuesto POR CATEGORÍA (`tax_category_id`), así
   * que guardar el id de la tarifa obligaría a un segundo viaje para recuperar
   * su categoría, y una categoría con dos tarifas no tendría un id de tarifa
   * único que la represente. `onSaved` sólo acepta ids que resuelvan contra
   * este mapa, así que un id que no sea de categoría se rechaza en vez de
   * colarse hasta el payload.
   */
  private readonly categoryById = computed<Map<number, TaxCategory>>(
    () => new Map(this.payableCategories().map((c) => [c.id, c])),
  );

  readonly taxOptions = computed<TaxOption[]>(() =>
    this.payableCategories().map((category) => ({
      id: category.id,
      name: buildOptionName(category),
      // El catálogo guarda FRACCIÓN (`Decimal(6,5)`: 0.19) y el modal pinta
      // PORCENTAJE. La conversión va acá, una sola vez.
      rate: round2(sumRates(category) * 100),
      tax_type: category.tax_type ?? undefined,
      default_is_inclusive: readIsInclusive(category),
    })),
  );

  /**
   * El modal ya validó lo suyo (descripción, cantidad > 0, descuento que no se
   * come la línea). Acá se valida sólo lo que es propio del cobro del POS.
   *
   * Cuando algo no encaja, el modal SE QUEDA ABIERTO con lo que el cajero ya
   * escribió y el motivo sale por toast: cerrarlo le borraría la línea entera
   * por un dato corregible en dos segundos.
   */
  onSaved(draft: InvoiceCustomItemDraft): void {
    const problem = this.posBlocker(draft);
    if (problem) {
      this.toast.warning(problem);
      return;
    }

    const quantity = Math.round(Number(draft.quantity) || 0);
    const selected = draft.taxes?.[0] ?? null;
    const category = selected
      ? (this.categoryById().get(selected.tax_rate_id) ?? null)
      : null;

    // `total` es el total de la línea CON impuesto y CON el descuento ya
    // restado — lo que el cajero acaba de ver en la previsión del modal.
    // El borrador de este carril SIEMPRE es un ítem personalizado (`[draft]="null"`
    // arriba): no hay producto resuelto, así que `price_unit_quantity` viaja
    // ausente y el divisor de la aritmética cae a 1 — la escala del catálogo
    // nunca aplica a texto libre.
    const total = computeLineMath(draft).total;
    const description = String(draft.description ?? '').trim();

    this.added.emit({
      // `product_name` es obligatorio y tiene @MaxLength(255); la descripción es
      // texto libre y puede ser mucho más larga. El nombre es su primera línea
      // recortada, y la descripción completa viaja aparte.
      name: toLineName(description),
      description,
      quantity,
      finalPrice: round2(total / quantity),
      taxCategory: category,
    });
  }

  /** El primer motivo por el que esta línea no puede viajar al cobro, o `null`. */
  private posBlocker(draft: InvoiceCustomItemDraft): string | null {
    const rawQuantity = Number(draft.quantity);

    // `PosOrderItemDto.quantity` es `@IsInt() @Min(1)`. Una cantidad
    // fraccionaria no falla en esta línea: hace que el cobro ENTERO responda
    // 400 y el cajero se quede sin poder cobrar, sin saber por qué.
    if (!Number.isFinite(rawQuantity) || rawQuantity < 1) {
      return 'La cantidad debe ser al menos 1.';
    }
    if (!Number.isInteger(rawQuantity)) {
      return (
        'El cobro del POS factura por unidades enteras. Para vender una ' +
        'fracción, ponla en la descripción y cobra 1 unidad por el valor total.'
      );
    }

    const taxes = Array.isArray(draft.taxes) ? draft.taxes : [];
    if (taxes.length > 1) {
      return (
        'Una línea del POS declara un solo impuesto. Si necesitas IVA + INC en ' +
        'el mismo renglón, crea en Ajustes → Impuestos una categoría que agrupe ' +
        'ambas tarifas y selecciónala aquí.'
      );
    }
    if (taxes.length === 1 && !this.categoryById().has(taxes[0].tax_rate_id)) {
      return 'Ese impuesto ya no está en el catálogo de la tienda. Vuelve a seleccionarlo.';
    }

    return null;
  }
}

/** Clasificaciones que RETIENEN valor en vez de sumarlo al precio. */
const WITHHOLDING_TYPES = new Set(['withholding', 'reteiva', 'reteica']);

function isWithholding(taxType: string | null | undefined): boolean {
  return !!taxType && WITHHOLDING_TYPES.has(taxType);
}

/**
 * Σ de las tarifas de la categoría, en FRACCIÓN.
 *
 * Se suman las filas de `tax_rates` y NADA MÁS. El campo suelto
 * `TaxCategory.rate` existe en la interfaz pero NO se usa a propósito: ni
 * `PosCartService.calculateTaxCategoryRate` ni `calculateTaxCategoryTaxes` del
 * backend lo miran, así que tomarlo aquí haría que la previsión del modal
 * anunciara un impuesto que ni el carrito ni el documento van a declarar. Una
 * categoría sin tarifas tiene 0% y eso es lo correcto.
 */
function sumRates(category: TaxCategory): number {
  const rates = (category.tax_rates ?? []) as Array<{
    rate?: string | number | null;
  }>;
  return rates.reduce((sum, rate) => sum + (Number(rate?.rate) || 0), 0);
}

/**
 * Nombre de la opción. Con una sola tarifa basta el nombre de la categoría; con
 * varias se enseña el desglose, porque un "12,5%" suelto no le dice al cajero
 * que está declarando dos tributos.
 */
function buildOptionName(category: TaxCategory): string {
  const rates = (category.tax_rates ?? []) as Array<{
    name?: string | null;
    rate?: string | number | null;
  }>;
  if (rates.length <= 1) return category.name;
  const parts = rates
    .map(
      (rate) =>
        `${(rate?.name ?? '').trim() || 'tarifa'} ${round2((Number(rate?.rate) || 0) * 100)}%`,
    )
    .join(' + ');
  return `${category.name} (${parts})`;
}

/**
 * `tax_categories.is_inclusive` existe en la respuesta del backend pero no está
 * declarado en la interfaz `TaxCategory` del módulo de productos. Se lee a la
 * defensiva en vez de ampliar una interfaz de otro dueño.
 */
function readIsInclusive(category: TaxCategory): boolean {
  return (category as { is_inclusive?: boolean | null }).is_inclusive === true;
}

/**
 * Primera línea de la descripción, recortada a los 255 caracteres que admite
 * `product_name`. Recortar en el cliente evita un 400 que llegaría cuando el
 * cajero ya pulsó Cobrar.
 */
function toLineName(description: string): string {
  const firstLine = description.split('\n')[0].trim() || description.trim();
  return firstLine.slice(0, 255);
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}
