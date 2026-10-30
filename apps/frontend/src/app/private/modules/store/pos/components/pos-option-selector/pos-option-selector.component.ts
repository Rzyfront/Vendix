import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import {
  PosOptionSelection,
  PosProductOption,
  PosProductOptionGroup,
} from '../../services/pos-product-options.service';

/**
 * Add-on (adiciones) selector shown after the product / variant is chosen.
 * Rules per group: min/max/required. The server revalidates and recalculates
 * the price; the preview here is informational (quantity 1).
 */
@Component({
  selector: 'app-pos-option-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, CurrencyPipe],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      (click)="onBackdropClick($event)"
    >
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>

      <div
        class="relative bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden z-10"
        role="dialog"
        aria-modal="true"
        aria-label="Elegir adiciones"
        (click)="$event.stopPropagation()"
      >
        <div class="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 class="text-lg font-semibold text-text-primary">Adiciones</h3>
            <p class="text-sm text-text-secondary mt-0.5">{{ productName() }}</p>
          </div>
          <button
            type="button"
            (click)="onClose()"
            aria-label="Cerrar adiciones"
            class="w-8 h-8 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
          >
            <app-icon name="x" [size]="18" class="text-text-secondary"></app-icon>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
          @for (group of groups(); track group.id) {
            <section>
              <div class="flex items-baseline justify-between gap-2 mb-2">
                <h4 class="text-sm font-bold text-text-primary">{{ group.name }}</h4>
                <span class="text-xs text-text-secondary">{{ ruleLabel(group) }}</span>
              </div>
              <div class="flex flex-col gap-2">
                @for (option of group.options; track option.id) {
                  <button
                    type="button"
                    class="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all"
                    [class]="
                      isSelected(option.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary'
                    "
                    [class.opacity-50]="isDisabled(group, option)"
                    [disabled]="isDisabled(group, option)"
                    [attr.aria-pressed]="isSelected(option.id)"
                    (click)="toggle(group, option)"
                  >
                    <span
                      class="w-5 h-5 shrink-0 border flex items-center justify-center"
                      [class]="
                        (isSingle(group) ? 'rounded-full' : 'rounded-md') +
                        (isSelected(option.id)
                          ? ' bg-primary border-primary text-white'
                          : ' border-border')
                      "
                    >
                      @if (isSelected(option.id)) {
                        <app-icon name="check" [size]="12"></app-icon>
                      }
                    </span>
                    <span class="flex-1 text-sm font-medium text-text-primary">
                      {{ option.name }}
                    </span>
                    @if (delta(option) > 0) {
                      <span class="text-sm font-semibold text-text-secondary">
                        +{{ delta(option) | currency }}
                      </span>
                    }
                  </button>
                }
              </div>
            </section>
          }
        </div>

        <div class="px-5 py-4 border-t border-border flex flex-col gap-2">
          @if (firstMissing(); as missing) {
            <p class="text-xs text-warning" role="status">{{ missing }}</p>
          }
          <div class="flex items-center justify-between text-sm">
            <span class="text-text-secondary">Precio base + adiciones</span>
            <span class="font-bold text-text-primary">
              {{ basePrice() + totalDelta() | currency }}
            </span>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 h-10 sm:h-11 rounded-xl border border-border text-sm font-semibold text-text-primary"
              (click)="onClose()"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="flex-1 h-10 sm:h-11 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              [disabled]="!!firstMissing()"
              (click)="onConfirm()"
            >
              Agregar
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PosOptionSelectorComponent {
  readonly productName = input.required<string>();
  readonly groups = input.required<PosProductOptionGroup[]>();
  /** Unit price of the product/variant, for the preview only. */
  readonly basePrice = input<number>(0);

  readonly confirmed = output<PosOptionSelection>();
  readonly closed = output<void>();

  private readonly selectedIds = signal<ReadonlySet<number>>(new Set());

  readonly totalDelta = computed(() => {
    const ids = this.selectedIds();
    let total = 0;
    for (const group of this.groups()) {
      for (const option of group.options) {
        if (ids.has(option.id)) total += this.delta(option);
      }
    }
    return total;
  });

  /** First unmet rule ("Elige 1 opción en Cubierta"), or null when valid. */
  readonly firstMissing = computed<string | null>(() => {
    const ids = this.selectedIds();
    for (const group of this.groups()) {
      const needed = this.minRequired(group);
      const chosen = group.options.filter((o) => ids.has(o.id)).length;
      if (chosen < needed) {
        return `Elige ${needed} ${needed === 1 ? 'opción' : 'opciones'} en ${group.name}`;
      }
    }
    return null;
  });

  delta(option: PosProductOption): number {
    const value = Number(option.price_delta ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  isSelected(optionId: number): boolean {
    return this.selectedIds().has(optionId);
  }

  isSingle(group: PosProductOptionGroup): boolean {
    return this.maxAllowed(group) === 1;
  }

  isDisabled(group: PosProductOptionGroup, option: PosProductOption): boolean {
    if (this.isSelected(option.id) || this.isSingle(group)) return false;
    return this.countIn(group) >= this.maxAllowed(group);
  }

  ruleLabel(group: PosProductOptionGroup): string {
    const min = this.minRequired(group);
    const max = this.maxAllowed(group);
    const unitHint = group.scope === 'per_line' ? ' · una vez por línea' : '';
    if (min > 0 && min === max) return `Obligatorio: ${min}${unitHint}`;
    if (min > 0) return `Obligatorio: ${min} a ${max}${unitHint}`;
    return `Opcional: hasta ${max}${unitHint}`;
  }

  toggle(group: PosProductOptionGroup, option: PosProductOption): void {
    const next = new Set(this.selectedIds());
    if (next.has(option.id)) {
      next.delete(option.id);
    } else if (this.isSingle(group)) {
      group.options.forEach((o) => next.delete(o.id));
      next.add(option.id);
    } else if (this.countIn(group) < this.maxAllowed(group)) {
      next.add(option.id);
    }
    this.selectedIds.set(next);
  }

  onConfirm(): void {
    if (this.firstMissing()) return;
    const ids = this.selectedIds();
    const chosen = this.groups().flatMap((g) =>
      g.options.filter((o) => ids.has(o.id)),
    );
    this.confirmed.emit({
      option_ids: chosen.map((o) => o.id),
      labels: chosen.map((o) => o.name),
      delta: this.totalDelta(),
    });
  }

  onClose(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.onClose();
  }

  private minRequired(group: PosProductOptionGroup): number {
    return Math.max(group.min_select ?? 0, group.is_required ? 1 : 0);
  }

  /** `max_select` <= 0 means no limit. */
  private maxAllowed(group: PosProductOptionGroup): number {
    return group.max_select > 0 ? group.max_select : group.options.length;
  }

  private countIn(group: PosProductOptionGroup): number {
    const ids = this.selectedIds();
    return group.options.filter((o) => ids.has(o.id)).length;
  }
}
