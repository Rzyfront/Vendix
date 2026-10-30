import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import {
  CartOptionSelection,
  EcommerceProductOptionGroup,
  EcommerceProductOptionsService,
} from '../../services/ecommerce-product-options.service';

/** Estado que el padre necesita para habilitar el botón y armar la línea. */
export interface ProductOptionSelectorState {
  /** El producto tiene grupos de adiciones aplicables. */
  hasGroups: boolean;
  /** Todas las reglas (mínimo, máximo, obligatorio) se cumplen. */
  valid: boolean;
  /** Mensaje del primer grupo pendiente, p. ej. "Elige 1 opción en Cubierta". */
  hint: string | null;
  /** Selección a enviar con la línea; null si no hay grupos o no eligió nada. */
  selection: CartOptionSelection | null;
}

export const EMPTY_OPTION_STATE: ProductOptionSelectorState = {
  hasGroups: false,
  valid: true,
  hint: null,
  selection: null,
};

/**
 * Selector de adiciones (grupos de opciones) de un producto en la tienda en
 * línea. Si el endpoint no devuelve grupos no pinta nada, así el detalle y la
 * vista rápida quedan exactamente como antes.
 */
@Component({
  selector: 'app-product-option-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (groups().length > 0) {
      <section class="pos-options" aria-label="Adiciones">
        @for (group of groups(); track group.id) {
          <fieldset class="pos-group">
            <legend class="pos-group__title">
              {{ group.name }}
              <span class="pos-group__rule">{{ ruleLabel(group) }}</span>
            </legend>
            <div class="pos-group__options">
              @for (opt of group.options; track opt.id) {
                <label
                  class="pos-option"
                  [class.pos-option--selected]="isSelected(opt.id)"
                  [class.pos-option--disabled]="isBlocked(group, opt.id)"
                >
                  <input
                    [type]="isRadio(group) ? 'radio' : 'checkbox'"
                    [name]="'opt-group-' + group.id"
                    [checked]="isSelected(opt.id)"
                    [disabled]="isBlocked(group, opt.id)"
                    (change)="toggle(group, opt.id)"
                  />
                  <span class="pos-option__name">{{ opt.name }}</span>
                  @if (delta(opt.price_delta) !== 0) {
                    <span class="pos-option__price"
                      >+{{ money(delta(opt.price_delta)) }}</span
                    >
                  }
                </label>
              }
            </div>
          </fieldset>
        }
        @if (state().hint; as hint) {
          <p class="pos-options__hint" role="status">{{ hint }}</p>
        } @else if (totalDelta() > 0) {
          <p class="pos-options__total">
            Adiciones: +{{ money(totalDelta()) }}
          </p>
        }
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .pos-options {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin: 0.75rem 0;
      }
      .pos-group {
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
      }
      .pos-group__title {
        font-size: var(--fs-sm);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        padding: 0;
        margin-bottom: 0.4rem;
      }
      .pos-group__rule {
        margin-left: 0.4rem;
        font-size: var(--fs-xs);
        font-weight: var(--fw-regular);
        color: var(--color-text-secondary);
      }
      .pos-group__options {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .pos-option {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface, var(--color-background));
        cursor: pointer;
        font-size: var(--fs-sm);
        color: var(--color-text-primary);
        transition: border-color var(--transition-fast);
      }
      .pos-option--selected {
        border-color: var(--color-primary);
        background: var(--color-primary-light);
      }
      .pos-option--disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .pos-option input {
        accent-color: var(--color-primary);
      }
      .pos-option__name {
        flex: 1;
        min-width: 0;
      }
      .pos-option__price {
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
        white-space: nowrap;
      }
      .pos-options__hint {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--color-warning, var(--color-text-secondary));
      }
      .pos-options__total {
        margin: 0;
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        color: var(--color-text-primary);
      }
    `,
  ],
})
export class ProductOptionSelectorComponent {
  private readonly optionsService = inject(EcommerceProductOptionsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly productId = input.required<number>();
  /** Cantidad de la línea: reparte el precio de los grupos "por línea". */
  readonly quantity = input<number>(1);
  readonly stateChange = output<ProductOptionSelectorState>();

  readonly groups = signal<EcommerceProductOptionGroup[]>([]);
  readonly selectedIds = signal<number[]>([]);

  /** Mínimo efectivo: un grupo obligatorio exige al menos 1. */
  private requiredCount(g: EcommerceProductOptionGroup): number {
    return Math.max(g.min_select || 0, g.is_required ? 1 : 0);
  }

  private chosenIn(g: EcommerceProductOptionGroup): number[] {
    const selected = this.selectedIds();
    return g.options.filter((o) => selected.includes(o.id)).map((o) => o.id);
  }

  readonly totalDelta = computed(() => {
    const qty = Math.max(1, this.quantity() || 1);
    const selected = this.selectedIds();
    let total = 0;
    for (const g of this.groups()) {
      for (const o of g.options) {
        if (!selected.includes(o.id)) continue;
        const d = this.delta(o.price_delta);
        total += g.scope === 'per_line' ? d / qty : d;
      }
    }
    return total;
  });

  readonly state = computed<ProductOptionSelectorState>(() => {
    const groups = this.groups();
    if (groups.length === 0) return EMPTY_OPTION_STATE;
    let hint: string | null = null;
    for (const g of groups) {
      const need = this.requiredCount(g);
      if (this.chosenIn(g).length < need) {
        hint = `Elige ${need} ${need === 1 ? 'opción' : 'opciones'} en ${g.name}`;
        break;
      }
    }
    const labels: string[] = [];
    const ids: number[] = [];
    for (const g of groups) {
      for (const o of g.options) {
        if (this.selectedIds().includes(o.id)) {
          ids.push(o.id);
          labels.push(`${g.name}: ${o.name}`);
        }
      }
    }
    return {
      hasGroups: true,
      valid: hint === null,
      hint,
      selection:
        ids.length > 0
          ? { option_ids: ids, labels, delta_unit: this.totalDelta() }
          : null,
    };
  });

  constructor() {
    // Carga los grupos al cambiar de producto y reinicia la selección.
    effect(() => {
      const id = this.productId();
      untracked(() => {
        this.groups.set([]);
        this.selectedIds.set([]);
        this.optionsService
          .getForProduct(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((groups) => this.groups.set(groups));
      });
    });
    // Notifica al padre cada cambio de estado.
    effect(() => {
      const s = this.state();
      untracked(() => this.stateChange.emit(s));
    });
  }

  delta(value: string | number): number {
    return Number(value) || 0;
  }

  money(value: number): string {
    return this.currency.format(value);
  }

  ruleLabel(g: EcommerceProductOptionGroup): string {
    const need = this.requiredCount(g);
    if (need > 0 && need === g.max_select) {
      return need === 1 ? 'Obligatorio, elige 1' : `Obligatorio, elige ${need}`;
    }
    if (need > 0) return `Obligatorio, hasta ${g.max_select}`;
    return g.max_select === 1 ? 'Opcional' : `Opcional, máximo ${g.max_select}`;
  }

  /** Radio solo si es de elección única y obligatoria; si es opcional se puede desmarcar. */
  isRadio(g: EcommerceProductOptionGroup): boolean {
    return g.max_select === 1 && this.requiredCount(g) > 0;
  }

  isSelected(optionId: number): boolean {
    return this.selectedIds().includes(optionId);
  }

  /** No deja marcar más opciones del máximo del grupo. */
  isBlocked(g: EcommerceProductOptionGroup, optionId: number): boolean {
    if (g.max_select === 1 || this.isSelected(optionId)) return false;
    return this.chosenIn(g).length >= g.max_select;
  }

  toggle(g: EcommerceProductOptionGroup, optionId: number): void {
    const current = this.selectedIds();
    if (current.includes(optionId)) {
      // Un radio obligatorio no se desmarca (se cambia eligiendo otra).
      if (this.isRadio(g)) return;
      this.selectedIds.set(current.filter((id) => id !== optionId));
      return;
    }
    if (g.max_select === 1) {
      const groupIds = g.options.map((o) => o.id);
      this.selectedIds.set([
        ...current.filter((id) => !groupIds.includes(id)),
        optionId,
      ]);
      return;
    }
    if (this.chosenIn(g).length >= g.max_select) return;
    this.selectedIds.set([...current, optionId]);
  }
}
