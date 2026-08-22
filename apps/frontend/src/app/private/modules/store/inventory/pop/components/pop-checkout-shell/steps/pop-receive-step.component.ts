import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { CurrencyPipe } from '../../../../../../../../shared/pipes/currency/currency.pipe';
import { InputComponent } from '../../../../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../../../../shared/components/icon/icon.component';
import { FiscalExplanationPanelComponent } from '../../fiscal-explanation-panel/fiscal-explanation-panel.component';
import {
  PopCostPreviewItem,
  PopCostPreviewResponse,
  PopFiscalExplanation,
} from '../../../interfaces';

/**
 * Override por línea (misma forma que los campos opcionales del backend
 * `ReceiveItemDto`): el padre lo propaga a la remisión de entrada.
 */
export interface PopPricingOverride {
  new_base_price?: number;
  new_profit_margin?: number;
}

/**
 * Mapa de overrides keyed por `${product_id}-${product_variant_id || 0}`
 * (misma clave que el preview @for). Contenedor en signal: un Map plano no es
 * reactivo en zoneless, así que cada mutación usa `set(new Map(...))`.
 */
export type PopPricingOverridesMap = Map<string, PopPricingOverride>;

/**
 * Paso Recepción del wizard POP (solo `create-receive`).
 *
 * Reúne el acuse de recepción (ON por defecto → genera la remisión de entrada)
 * y la valoración de inventario con la UX de margen/precio de QUI-425 (los
 * overrides viajan a la recepción por remisión). Nunca es un gate: ni el acuse
 * ni los overrides bloquean avanzar — el acuse decide si se recibe, los
 * overrides pisan el ancla-a-costo solo cuando el operador los define.
 */
@Component({
  selector: 'app-pop-receive-step',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CurrencyPipe,
    DecimalPipe,
    InputComponent,
    IconComponent,
    FiscalExplanationPanelComponent,
  ],
  templateUrl: './pop-receive-step.component.html',
  styleUrl: './pop-receive-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopReceiveStepComponent {
  readonly costPreview = input<PopCostPreviewResponse | null>(null);
  readonly loadingCostPreview = input(false);
  /**
   * A.5 — mensaje del fallo de la vista previa. Antes el error se tragaba y el
   * paso quedaba vacío: el operador confirmaba una recepción sin haber visto el
   * costo que iba a sellar.
   */
  readonly costPreviewError = input<string | null>(null);

  /** "Cambiar estrategia" → el shell re-emite para navegar a settings generales. */
  readonly navigateToSettings = output<void>();
  /** El panel de error pide otra vista previa. */
  readonly retryCostPreview = output<void>();
  /** CTA del aviso fiscal → asistente fiscal (ruta emitida por el backend). */
  readonly navigateToFiscalWizard = output<string>();

  /** B.5 — explicación fiscal estructurada. `null` en respuestas sin ella. */
  readonly fiscalExplanation = computed<PopFiscalExplanation | null>(
    () => this.costPreview()?.fiscal_explanation ?? null,
  );

  /**
   * C.5 — flete que el backend repartió entre las líneas. `expense` deja este
   * total en cero porque el flete no toca el costo del inventario.
   */
  readonly allocatedShippingTotal = computed<number>(() =>
    (this.costPreview()?.items ?? []).reduce(
      (acc, item) => acc + (Number(item.allocated_shipping_amount) || 0),
      0,
    ),
  );

  /**
   * El backend degradó `prorate` a `expense` por no haber base sobre la que
   * repartir. Hay que decirlo: la elección del operador no se honró.
   */
  readonly shippingAllocationDowngraded = computed<boolean>(() => {
    const preview = this.costPreview();
    if (!preview?.shipping_cost_allocation_requested) return false;
    return (
      preview.shipping_cost_allocation_requested !==
      preview.shipping_cost_allocation_applied
    );
  });

  /** Acuse de recepción: ON por defecto en cada apertura (solo cuando está montado). */
  readonly ackReceive = signal(true);

  /** Overrides de margen/precio configurados en la valoración (QUI-425). */
  readonly pricingOverrides = signal<PopPricingOverridesMap>(new Map());

  /**
   * Controles de borrador por fila (margen/precio), cacheados por previewKey.
   * Alimentan el DISPLAY de app-input vía su CVA; el estado real vive en
   * `pricingOverrides`. Se crean perezosamente en el primer render.
   */
  private readonly rowControls = new Map<string, FormGroup>();

  /** El paso nunca bloquea avanzar: el acuse es una decisión, no un requisito. */
  validate(): boolean {
    return true;
  }

  onAckToggle(event: Event): void {
    this.ackReceive.set((event.target as HTMLInputElement).checked);
  }

  /** Clave estable para el preview @for Y el mapa de overrides. */
  previewKey(item: PopCostPreviewItem): string {
    return `${item.product_id}-${item.product_variant_id || 0}`;
  }

  /** FormGroup de borrador por fila (creado una sola vez por línea). */
  rowForm(item: PopCostPreviewItem): FormGroup {
    const key = this.previewKey(item);
    let group = this.rowControls.get(key);
    if (!group) {
      // Los controles se declaran `string | number`: el CVA de `app-input` en
      // modo `[currency]` escribe el NÚMERO crudo (`onChange(rawValue)`), no la
      // cadena que se pinta. Tiparlos como `string` era una mentira que dejaba
      // pasar sin ruido el `NaN` que A.14 corrige.
      group = new FormGroup({
        margin: new FormControl<string | number | null>(
          this.marginDraftFor(item),
        ),
        price: new FormControl<string | number | null>(
          this.priceDraftFor(item),
        ),
      });
      this.rowControls.set(key, group);
    }
    return group;
  }

  /**
   * IVA por unidad de la línea, o 0 si la compra no lleva impuesto.
   *
   * Se lee del preview, que lo derivó con la misma fórmula que persiste el
   * backend — no se recalcula aquí para que la pantalla no pueda discrepar de
   * lo que se sella.
   */
  taxPerUnit(item: PopCostPreviewItem): number {
    return Number(item.incoming_tax_per_unit ?? 0) || 0;
  }

  /**
   * Lo que realmente sale del bolsillo por unidad, o `null` si no se puede
   * afirmar.
   *
   * Con responsabilidad de IVA el costo de inventario es el neto y el impuesto
   * se recupera vía IVA descontable, así que desembolso y costo son cifras
   * distintas y conviene ver las dos: el margen se calcula sobre el costo, pero
   * la caja se mueve por el desembolso. Sin responsabilidad el IVA ya está
   * dentro del costo y ambas coinciden — sumarlo ahí lo contaría dos veces.
   *
   * Cuando el backend no informa la responsabilidad (filas de producto nuevo,
   * sintetizadas en el cliente) devuelve `null` y la fila no se pinta: mostrar
   * una cifra adivinada sobre la que el operador calcula su margen es peor que
   * no mostrar ninguna.
   */
  disbursementPerUnit(item: PopCostPreviewItem): number | null {
    const responsible = this.costPreview()?.vat_responsible;
    if (responsible === undefined) return null;
    const cost = Number(item.new_cost_per_unit) || 0;
    return responsible ? cost + this.taxPerUnit(item) : cost;
  }

  /**
   * True cuando la línea trae IVA y se sabe cómo tratarlo.
   *
   * B.5 — la explicación FISCAL ya no cuelga de aquí: el panel del paso se
   * pinta con `fiscal_explanation`, aunque el IVA sea cero. Esta bandera sólo
   * decide si tiene sentido pintar la fila de DESEMBOLSO, que con impuesto cero
   * repetiría el costo.
   */
  hasTax(item: PopCostPreviewItem): boolean {
    return this.taxPerUnit(item) > 0 && this.vatResponsible() !== undefined;
  }

  /**
   * Responsabilidad de IVA resuelta por el backend. `undefined` significa
   * "no informado", no "no responsable" — ver `disbursementPerUnit`.
   *
   * B.5 — se lee de `fiscal_explanation` cuando está (es el dato estructurado y
   * fail-closed) y cae a `vat_responsible` para respuestas que aún no lo traen.
   */
  vatResponsible(): boolean | undefined {
    const fx = this.fiscalExplanation();
    if (fx) return fx.vat_responsible;
    return this.costPreview()?.vat_responsible;
  }

  /** Flete asignado a la línea (0 con `expense`). */
  allocatedShipping(item: PopCostPreviewItem): number {
    return Number(item.allocated_shipping_amount) || 0;
  }

  /** El mismo flete por unidad: lo que subió el costo unitario. */
  shippingPerUnit(item: PopCostPreviewItem): number {
    return Number(item.shipping_per_unit) || 0;
  }

  /** Accesores tipados para el template (strictTemplates: `controls[...]` es AbstractControl). */
  marginControl(item: PopCostPreviewItem): FormControl<string | number | null> {
    return this.rowForm(item).controls['margin'] as FormControl<
      string | number | null
    >;
  }

  priceControl(item: PopCostPreviewItem): FormControl<string | number | null> {
    return this.rowForm(item).controls['price'] as FormControl<
      string | number | null
    >;
  }

  /** True cuando el operador definió al menos un override para esta línea. */
  hasOverride(item: PopCostPreviewItem): boolean {
    const o = this.pricingOverrides().get(this.previewKey(item));
    return !!(
      o &&
      (o.new_base_price !== undefined || o.new_profit_margin !== undefined)
    );
  }

  /**
   * QUI-648 — el costo llevado a la escala del PRECIO (`price_unit_quantity`),
   * mismo cociente que el backend usa para `resulting_margin` y para lo que la
   * recepción persiste. Con escala 1 devuelve el costo intacto.
   */
  private costInPriceScale(item: PopCostPreviewItem): number {
    const scale = Number(item.price_unit_quantity ?? 1);
    const safeScale = Number.isFinite(scale) && scale > 1 ? scale : 1;
    return Number(item.new_cost_per_unit) * safeScale;
  }

  /** Margen desplegado en "Margen resultante" (override > derivado > backend). */
  previewMargin(item: PopCostPreviewItem): number | null {
    const o = this.pricingOverrides().get(this.previewKey(item));
    if (o?.new_profit_margin !== undefined) return o.new_profit_margin;
    const cost = this.costInPriceScale(item);
    if (o?.new_base_price !== undefined && cost > 0) {
      return Math.round(((o.new_base_price - cost) / cost) * 10000) / 100;
    }
    return item.resulting_margin;
  }

  /** Valor de "Nuevo margen" (string para app-input). */
  marginDraftFor(item: PopCostPreviewItem): string {
    const o = this.pricingOverrides().get(this.previewKey(item));
    if (o?.new_profit_margin !== undefined) return String(o.new_profit_margin);
    return item.resulting_margin !== null ? String(item.resulting_margin) : '';
  }

  /** Valor de "Nuevo precio base" (string para app-input). */
  priceDraftFor(item: PopCostPreviewItem): string {
    const o = this.pricingOverrides().get(this.previewKey(item));
    if (o?.new_base_price !== undefined) return String(o.new_base_price);
    return String(item.current_base_price ?? 0);
  }

  /**
   * Input de margen: re-calcula en vivo el precio base anclado al NUEVO costo.
   * Vacío → ancla a costo (borra el override completo, como "Restablecer").
   */
  onMarginDraftChange(item: PopCostPreviewItem, raw: string | number): void {
    const value = this.parseOptionalNumber(raw);
    if (value === null) {
      this.clearOverride(item);
      return;
    }
    const key = this.previewKey(item);
    const cost = this.costInPriceScale(item);
    const base = Math.round(cost * (1 + value / 100) * 100) / 100;
    const next = new Map(this.pricingOverrides());
    next.set(key, { new_profit_margin: value, new_base_price: base });
    this.pricingOverrides.set(next);
    // Espeja el re-cálculo en el control de precio para que el display viva
    // (emitEvent default: el CVA del app-input se actualiza vía el directive).
    this.rowForm(item).patchValue({ price: this.priceDraftFor(item) });
  }

  /**
   * Input de precio: re-calcula en vivo el margen derivado del NUEVO costo.
   * Vacío → ancla a costo (borra el override completo).
   */
  onPriceDraftChange(item: PopCostPreviewItem, raw: string | number): void {
    const value = this.parseOptionalNumber(raw);
    if (value === null) {
      this.clearOverride(item);
      return;
    }
    const key = this.previewKey(item);
    const cost = this.costInPriceScale(item);
    const margin =
      cost > 0 ? Math.round(((value - cost) / cost) * 100 * 100) / 100 : 0;
    const next = new Map(this.pricingOverrides());
    next.set(key, { new_base_price: value, new_profit_margin: margin });
    this.pricingOverrides.set(next);
    this.rowForm(item).patchValue({ margin: this.marginDraftFor(item) });
  }

  clearOverride(item: PopCostPreviewItem): void {
    const key = this.previewKey(item);
    const next = new Map(this.pricingOverrides());
    next.delete(key);
    this.pricingOverrides.set(next);
    this.rowForm(item).patchValue({
      margin: this.marginDraftFor(item),
      price: this.priceDraftFor(item),
    });
  }

  /**
   * Tolerante a "", null y NaN (el input vacío es "sin override", no crash).
   *
   * A.14 — ya NO cambia comas por puntos. Esa "normalización" era la que
   * borraba el override: con `app-input [currency]` emitiendo el texto
   * formateado, `"1,500,000"` se convertía en `"1.500.000"`, `Number(...)`
   * daba `NaN`, y `NaN → null` se interpretaba como "el operador vació el
   * campo" → `clearOverride`. Teclear cualquier precio base ≥ 1000 borraba el
   * override en silencio, en los dos estilos de formato. Ahora `app-input`
   * entrega el número canónico (`"1500000"`) y el `<input type="number">` del
   * margen entrega siempre decimal con punto, así que la sustitución no tenía
   * ningún caso legítimo que atender y sí uno destructivo.
   */
  private parseOptionalNumber(
    raw: string | number | null | undefined,
  ): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const cleaned = raw.trim();
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
}