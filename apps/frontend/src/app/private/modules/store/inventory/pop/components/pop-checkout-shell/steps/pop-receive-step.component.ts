import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { CurrencyPipe } from '../../../../../../../../shared/pipes/currency/currency.pipe';
import { InputComponent } from '../../../../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../../../../shared/components/icon/icon.component';
import { CostPreviewItem, CostPreviewResponse } from '../../../../interfaces';

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
  ],
  templateUrl: './pop-receive-step.component.html',
  styleUrl: './pop-receive-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopReceiveStepComponent {
  readonly costPreview = input<CostPreviewResponse | null>(null);
  readonly loadingCostPreview = input(false);

  /** "Cambiar estrategia" → el shell re-emite para navegar a settings generales. */
  readonly navigateToSettings = output<void>();

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
  previewKey(item: CostPreviewItem): string {
    return `${item.product_id}-${item.product_variant_id || 0}`;
  }

  /** FormGroup de borrador por fila (creado una sola vez por línea). */
  rowForm(item: CostPreviewItem): FormGroup {
    const key = this.previewKey(item);
    let group = this.rowControls.get(key);
    if (!group) {
      group = new FormGroup({
        margin: new FormControl<string>(this.marginDraftFor(item)),
        price: new FormControl<string>(this.priceDraftFor(item)),
      });
      this.rowControls.set(key, group);
    }
    return group;
  }

  /** Accesores tipados para el template (strictTemplates: `controls[...]` es AbstractControl). */
  marginControl(item: CostPreviewItem): FormControl<string> {
    return this.rowForm(item).controls['margin'] as FormControl<string>;
  }

  priceControl(item: CostPreviewItem): FormControl<string> {
    return this.rowForm(item).controls['price'] as FormControl<string>;
  }

  /** True cuando el operador definió al menos un override para esta línea. */
  hasOverride(item: CostPreviewItem): boolean {
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
  private costInPriceScale(item: CostPreviewItem): number {
    const scale = Number(item.price_unit_quantity ?? 1);
    const safeScale = Number.isFinite(scale) && scale > 1 ? scale : 1;
    return Number(item.new_cost_per_unit) * safeScale;
  }

  /** Margen desplegado en "Margen resultante" (override > derivado > backend). */
  previewMargin(item: CostPreviewItem): number | null {
    const o = this.pricingOverrides().get(this.previewKey(item));
    if (o?.new_profit_margin !== undefined) return o.new_profit_margin;
    const cost = this.costInPriceScale(item);
    if (o?.new_base_price !== undefined && cost > 0) {
      return Math.round(((o.new_base_price - cost) / cost) * 10000) / 100;
    }
    return item.resulting_margin;
  }

  /** Valor de "Nuevo margen" (string para app-input). */
  marginDraftFor(item: CostPreviewItem): string {
    const o = this.pricingOverrides().get(this.previewKey(item));
    if (o?.new_profit_margin !== undefined) return String(o.new_profit_margin);
    return item.resulting_margin !== null ? String(item.resulting_margin) : '';
  }

  /** Valor de "Nuevo precio base" (string para app-input). */
  priceDraftFor(item: CostPreviewItem): string {
    const o = this.pricingOverrides().get(this.previewKey(item));
    if (o?.new_base_price !== undefined) return String(o.new_base_price);
    return String(item.current_base_price ?? 0);
  }

  /**
   * Input de margen: re-calcula en vivo el precio base anclado al NUEVO costo.
   * Vacío → ancla a costo (borra el override completo, como "Restablecer").
   */
  onMarginDraftChange(item: CostPreviewItem, raw: string): void {
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
  onPriceDraftChange(item: CostPreviewItem, raw: string): void {
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

  clearOverride(item: CostPreviewItem): void {
    const key = this.previewKey(item);
    const next = new Map(this.pricingOverrides());
    next.delete(key);
    this.pricingOverrides.set(next);
    this.rowForm(item).patchValue({
      margin: this.marginDraftFor(item),
      price: this.priceDraftFor(item),
    });
  }

  /** Tolerante a "", null y NaN (el input vacío es "sin override", no crash). */
  private parseOptionalNumber(raw: string | null | undefined): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const cleaned = String(raw).replace(/,/g, '.').trim();
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
}