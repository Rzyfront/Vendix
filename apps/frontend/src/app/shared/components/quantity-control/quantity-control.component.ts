import { Component, input, output, effect, signal, computed } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { FormStyleVariant } from '../../types/form.types';

export type QuantityControlSize = 'sm' | 'md' | 'lg';

/**
 * Payload of the `valueClamped` event.
 * Emitted when the user's input was constrained to the min or max value
 * on commit (blur / Enter / +/- buttons), not on every keystroke.
 */
export interface QuantityClampEvent {
  /** The value the user typed (pre-clamp). */
  attempted: number;
  /**
   * The bound the value was clamped to:
   * - For `reason: 'max'`, this is the `max` input (the cap).
   * - For `reason: 'min'`, this is the `min` input (the floor, e.g. 1).
   */
  limit: number;
  /** Why the clamp was applied. */
  reason: 'max' | 'min';
}

/**
 * Reusable quantity control component with +/- buttons and editable input
 * Matches the exact styling from the original POS/POP cart implementations
 */
@Component({
  selector: 'app-quantity-control',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <div class="qc-wrapper">
    <div
      [class]="containerClasses"
      >
      <button
        [class.px-2.5]="size() === 'sm'"
        [class.px-3]="size() === 'md'"
        [class.px-4]="size() === 'lg'"
        class="hover:bg-muted h-full flex items-center justify-center shrink-0 text-text-secondary transition-colors"
        (click)="decrease()"
        type="button"
        [disabled]="disabled() || loading() || displayValue <= min()"
        >
        <app-icon [name]="'minus'" [size]="iconSize"></app-icon>
      </button>
    
      @if (editable()) {
        <input
          [class.w-12]="size() === 'sm'"
          [class.w-16]="size() === 'md'"
          [class.w-20]="size() === 'lg'"
          class="shrink min-w-[24px] text-center text-xs font-bold text-text-primary bg-transparent border-0 outline-none p-0 h-full focus:ring-0"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          [ngModel]="displayValue"
          (ngModelChange)="onInputChange($event)"
          (blur)="onBlur()"
          (keydown)="onKeyDown($event)"
          (keydown.enter)="onEnter()"
          (paste)="onPaste($event)"
          [disabled]="disabled() || loading()"
          />
      } @else {
        <span
          [class.min-w-[28px]]="size() === 'sm'"
          [class.min-w-[36px]]="size() === 'md'"
          [class.min-w-[44px]]="size() === 'lg'"
          class="shrink text-center text-xs font-bold text-text-primary"
          >
          {{ displayValue }}
        </span>
      }
    
    
      <button
        [class.px-2.5]="size() === 'sm'"
        [class.px-3]="size() === 'md'"
        [class.px-4]="size() === 'lg'"
        class="hover:bg-muted h-full flex items-center justify-center shrink-0 text-text-secondary transition-colors"
        (click)="increase()"
        type="button"
        [disabled]="disabled() || loading() || isAtMax()"
        >
        <app-icon [name]="'plus'" [size]="iconSize"></app-icon>
      </button>
    </div>
      @if (packSize() > 1) {
        <span class="qc-pack-hint" [title]="'Empaque de ' + packSize() + ' unidades'">
          = {{ displayValue * packSize() }} u. (×{{ packSize() }})
        </span>
      }
    </div>
    `,
  styles: [
    `
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
    }

    .qc-wrapper {
      display: inline-flex;
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
      min-width: 0;
      max-width: 100%;
    }

    .qc-pack-hint {
      font-size: 10px;
      font-weight: 500;
      line-height: 1;
      text-align: center;
      color: var(--color-text-secondary);
      white-space: nowrap;
    }

    /* Remove number input spin buttons */
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    input[type='number'] {
      -moz-appearance: textfield;
    }
    `,
  ],
})
export class QuantityControlComponent {
  readonly value = input(1);
  readonly min = input(1);
  readonly max = input<number | null>(null);
  /**
   * Stock units per package. When > 1 the counter still steps by 1 (it counts
   * PACKAGES), and a small unit-equivalence hint is shown beneath the control.
   */
  readonly unitsPerPackage = input<number | null>(null);
  /** Normalized pack size (>= 1); collapses to 1 for null/<=1 values. */
  readonly packSize = computed(() => {
    const v = Number(this.unitsPerPackage() ?? 1);
    return Number.isFinite(v) && v > 1 ? v : 1;
  });
  readonly step = input(1);
  readonly editable = input(true);
  readonly disabled = input(false);
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());
  readonly size = input<QuantityControlSize>('sm');
  readonly styleVariant = input<FormStyleVariant>('modern');

  readonly valueChange = output<number>();

  /**
   * Emitted on commit (blur / Enter / +/- buttons) when the user's input
   * was clamped to the min or max constraint. Parents can use this to
   * surface a warning (e.g. stock cap) without re-validating the value.
   *
   * The event is OPT-IN: call-sites that don't bind `(valueClamped)` are
   * unaffected. The event fires once per commit, never on keystrokes,
   * to avoid double emissions and toast spam in the POS context.
   *
   * - `attempted`: the value the user typed (pre-clamp).
   * - `limit`: the bound the value was clamped to (the `min` value when
   *   reason is 'min', the `max` value when reason is 'max').
   * - `reason`: 'max' if the user typed above max, 'min' if below min.
   */
  readonly valueClamped = output<QuantityClampEvent>();

  displayValue = 1;

  private isEditing = false;

  constructor() {
    effect(() => {
      const val = this.value();
      if (!this.isEditing && this.displayValue !== val) {
        this.displayValue = val;
      }
    });
  }

  get iconSize(): number {
    const sizeMap: Record<QuantityControlSize, number> = { sm: 12, md: 14, lg: 16 };
    return sizeMap[this.size()];
  }

  isAtMax(): boolean {
    const maxVal = this.max();
    return maxVal !== null && this.displayValue >= maxVal;
  }

  get containerClasses(): string {
    const baseClasses = [
      'flex',
      'items-center',
      'bg-muted/50',
      'border',
      'border-border/50',
      'overflow-hidden',
    ];

    // Height based on size
    const heightClasses = {
      sm: 'h-7',
      md: 'h-9',
      lg: 'h-11',
    };

    if (this.styleVariant() === 'modern') {
      // Modern: larger border-radius (12px)
      return [
        ...baseClasses,
        heightClasses[this.size()],
        'rounded-xl',
      ].join(' ');
    }

    // Classic: same border-radius as modern (0.75rem / 12px)
    return [
      ...baseClasses,
      heightClasses[this.size()],
      'rounded-xl',
    ].join(' ');
  }

  decrease(): void {
    if (this.disabled() || this.loading()) return;

    const newValue = Math.max(this.min(), this.displayValue - this.step());
    this.emitValue(newValue);
  }

  increase(): void {
    if (this.disabled() || this.loading()) return;

    const max = this.max();
    const newValue = max !== null
      ? Math.min(max, this.displayValue + this.step())
      : this.displayValue + this.step();

    this.emitValue(newValue);
  }

  onInputChange(newValue: any): void {
    this.isEditing = true;

    // Only accept numeric strings (digits only)
    const stringValue = String(newValue);

    // If empty, set to minimum
    if (stringValue === '' || stringValue === '-') {
      this.displayValue = this.min();
      return;
    }

    // Only accept positive integers (0-9 only)
    const numericValue = parseInt(stringValue, 10);

    if (!isNaN(numericValue) && /^[0-9]+$/.test(stringValue)) {
      this.displayValue = numericValue;
    }
    // If invalid characters, don't update displayValue.
    // Clamp + valueClamped emission are deferred to commitValue()
    // (triggered by blur / Enter / +/- buttons). This keeps the
    // component's default behavior non-breaking for call-sites that
    // bind [max] but do NOT bind (valueClamped) — the parent's
    // valueChange only fires once per commit, not per keystroke.
  }

  onKeyDown(event: KeyboardEvent): void {
    const key = event.key;

    // Allow: digits 0-9
    if (/^[0-9]$/.test(key)) {
      return;
    }

    // Allow: control keys (backspace, delete, arrows, home, end, enter, tab)
    const allowedKeys = [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'Enter',
      'Tab'
    ];

    if (allowedKeys.includes(key)) {
      return;
    }

    // Block everything else (+, -, ., e, E, and other non-digit characters)
    event.preventDefault();
  }

  onPaste(event: ClipboardEvent): void {
    // Prevent pasting non-numeric content
    event.preventDefault();

    const pastedText = event.clipboardData?.getData('text') || '';
    const numericOnly = pastedText.replace(/[^0-9]/g, '');

    if (numericOnly) {
      const pastedValue = parseInt(numericOnly, 10);
      if (!isNaN(pastedValue)) {
        this.displayValue = pastedValue;
      }
    }
  }

  onBlur(): void {
    this.commitValue();
    this.isEditing = false;
  }

  onEnter(): void {
    this.commitValue();
    this.isEditing = false;
  }

  /**
   * Commit the user's typed value and emit to parent
   * Enforces min/max constraints
   */
  private commitValue(): void {
    let constrainedValue = this.displayValue;
    let clamp: QuantityClampEvent | null = null;

    const max = this.max();
    if (this.displayValue < this.min()) {
      constrainedValue = this.min();
      clamp = {
        attempted: this.displayValue,
        limit: constrainedValue,
        reason: 'min',
      };
    } else if (max !== null && this.displayValue > max) {
      constrainedValue = max;
      clamp = {
        attempted: this.displayValue,
        limit: max,
        reason: 'max',
      };
    }

    if (clamp) {
      this.valueClamped.emit(clamp);
    }

    // Only emit if value actually changed
    if (constrainedValue !== this.value()) {
      this.emitValue(constrainedValue);
    } else {
      // Still update displayValue in case constraints were applied
      this.displayValue = constrainedValue;
    }
  }

  /**
   * Emit a new value to the parent and update display
   */
  private emitValue(newValue: number): void {
    this.displayValue = newValue;
    this.valueChange.emit(newValue);
  }
}
