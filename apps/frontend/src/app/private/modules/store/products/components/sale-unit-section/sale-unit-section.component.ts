import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IconComponent,
  MultiSelectorComponent,
  MultiSelectorOption,
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { UnitOfMeasure } from '../../../inventory/services/uom.service';
import {
  compatibleAdditionalUnits,
  compatiblePurchaseUnits,
  inventoryCandidates,
  PIECE,
  principalOptionGroups,
  SaleUnitFormState,
  SaleUnitPayload,
  SaleUnitPrincipal,
  stockUomOf,
  summaryText,
  toPayload,
  violations,
} from '../../utils/sale-unit-form.util';

/** Async guard run before the principal unit changes (e.g. price rescale dialog). */
export type PrincipalChangeGuard = (
  from: SaleUnitPrincipal,
  to: SaleUnitPrincipal,
) => Promise<boolean>;

export interface PrincipalChange {
  from: SaleUnitPrincipal;
  to: SaleUnitPrincipal;
}

/**
 * Sección única «Unidad de venta» (feature `product-sale-unit-consolidation`,
 * S2-S7, S10, S12, S13b). Compartida por el editor de producto y el modal de
 * configuración del POP de compra. Todas las reglas salen del mapper
 * `sale-unit-form.util.ts`; aquí solo hay estado de edición y presentación.
 *
 * Lo específico de cada pantalla vive en el padre: reescala de precios
 * (`confirmPrincipalChange` + `principalChanged`), diálogo de conversión de
 * existencias y código de balanza vs código de barras.
 */
@Component({
  selector: 'app-sale-unit-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IconComponent,
    SelectorComponent,
    MultiSelectorComponent,
  ],
  host: { class: 'block' },
  templateUrl: './sale-unit-section.component.html',
})
export class SaleUnitSectionComponent {
  private readonly currency = inject(CurrencyFormatService);

  /** Estado de la sección (dos vías con el padre). */
  readonly state = model.required<SaleUnitFormState>();
  /** `true` cuando la persona tocó la sección: solo entonces se reescriben unidades (D3). */
  readonly touched = model(false);
  readonly catalog = input.required<readonly UnitOfMeasure[]>();
  /** Precio por unidad principal, solo para el resumen. */
  readonly price = input<number | null>(null);
  readonly confirmPrincipalChange = input<PrincipalChangeGuard | null>(null);
  /** Muestra el plegable aunque el producto sea por pieza (el POP proyecta contenido ahí). */
  readonly foldableAlways = input(false);
  readonly advancedLabel = input('Avanzado');
  readonly sectionId = input<string | null>(null);

  /** Valores de API tras cada cambio de la persona. */
  readonly committed = output<SaleUnitPayload>();
  /** La unidad principal cambió (ya confirmada): el padre reescala sus precios. */
  readonly principalChanged = output<PrincipalChange>();

  readonly advancedOpen = signal(false);

  /** Valor del selector principal; se reenvía al cancelar un cambio. */
  readonly selectorValue = linkedSignal<string | number>(
    () => this.state().principalUomId,
  );

  readonly isPiece = computed(() => this.state().principalUomId === PIECE);
  readonly showFoldable = computed(() => !this.isPiece() || this.foldableAlways());

  /** Un producto legado sin tocar no se juzga (S6). */
  readonly violationList = computed(() =>
    !this.touched() && this.state().legacy
      ? []
      : violations(this.state(), this.catalog()),
  );

  readonly principalOptions = computed<SelectorOption[]>(() => [
    { value: PIECE, label: 'Pieza / unidad', description: 'Conteo' },
    ...principalOptionGroups(this.catalog()).flatMap((group) =>
      group.options.map((o) => ({
        value: o.value,
        label: o.label,
        description: o.eligible
          ? group.label
          : `${group.label} · su equivalencia no es exacta`,
        disabled: !o.eligible,
      })),
    ),
  ]);

  readonly additionalOptions = computed<MultiSelectorOption[]>(() => {
    const s = this.state();
    return compatibleAdditionalUnits(
      s.principalUomId,
      this.catalog(),
      s.stockOverrideUomId,
    ).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }));
  });

  readonly inventoryOptions = computed<SelectorOption[]>(() =>
    inventoryCandidates(this.state(), this.catalog()).map((u) => ({
      value: u.id,
      label: `${u.name} (${u.code})`,
    })),
  );

  readonly purchaseOptions = computed<SelectorOption[]>(() =>
    compatiblePurchaseUnits(
      stockUomOf(this.state(), this.catalog()),
      this.catalog(),
    ).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` })),
  );

  readonly summary = computed(() =>
    summaryText(this.state(), this.price(), this.catalog(), (v) =>
      this.currency.format(v),
    ),
  );

  private apply(patch: Partial<SaleUnitFormState>): void {
    const base = { ...this.state(), ...patch };
    const next: SaleUnitFormState = {
      ...base,
      stockUomId: stockUomOf(base, this.catalog())?.id ?? null,
    };
    this.state.set(next);
    this.touched.set(true);
    this.committed.emit(toPayload(next, this.catalog(), true));
  }

  /** Primer cambio de un legado: pasa a la forma canónica (D1). */
  private beginEdit(): Partial<SaleUnitFormState> {
    return this.touched() ? {} : { stockOverrideUomId: null };
  }

  async onPrincipalChange(raw: string | number | null): Promise<void> {
    if (raw == null || raw === '') return;
    const next: SaleUnitPrincipal = raw === PIECE ? PIECE : Number(raw);
    const current = this.state().principalUomId;
    if (next === current) return;
    const guard = this.confirmPrincipalChange();
    if (guard && !(await guard(current, next))) {
      this.selectorValue.set('');
      setTimeout(() => this.selectorValue.set(current));
      return;
    }
    const catalog = this.catalog();
    const allowed = new Set(
      compatibleAdditionalUnits(next, catalog).map((u) => Number(u.id)),
    );
    const additional = this.state().additionalUomIds.filter((id) =>
      allowed.has(id),
    );
    const draft: SaleUnitFormState = {
      ...this.state(),
      principalUomId: next,
      additionalUomIds: additional,
      stockOverrideUomId: null,
    };
    const stock = stockUomOf(draft, catalog);
    const purchaseOk = compatiblePurchaseUnits(stock, catalog).some(
      (u) => Number(u.id) === this.state().purchaseUomId,
    );
    this.principalChanged.emit({ from: current, to: next });
    this.apply({
      principalUomId: next,
      additionalUomIds: additional,
      stockOverrideUomId: null,
      purchaseUomId: purchaseOk ? this.state().purchaseUomId : null,
    });
  }

  onAdditionalChange(values: ReadonlyArray<string | number>): void {
    this.apply({
      ...this.beginEdit(),
      additionalUomIds: values.map((v) => Number(v)),
    });
  }

  onInventoryChange(raw: string | number | null): void {
    if (raw == null || raw === '') return;
    const id = Number(raw);
    const derived = stockUomOf(
      { ...this.state(), stockOverrideUomId: null },
      this.catalog(),
    );
    this.apply({
      stockOverrideUomId: derived && Number(derived.id) === id ? null : id,
    });
  }

  onPurchaseChange(raw: string | number | null): void {
    this.apply({
      ...this.beginEdit(),
      purchaseUomId: raw == null || raw === '' ? null : Number(raw),
    });
  }
}
