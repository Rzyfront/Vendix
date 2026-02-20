import { Component, Input, Output, EventEmitter, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { FormStyleVariant } from '../../types/form.types';

export type QuantityControlSize = 'sm' | 'md' | 'lg';

/**
 * Reusable quantity control component with +/- buttons and editable input
 * Matches the exact styling from the original POS/POP cart implementations
 */
@Component({
  selector: 'app-quantity-control',
  standalone: true,
  imports: [CommonModule, IconComponent, FormsModule],
  template: `
    <div
      [class]="containerClasses"
    >
      <button
        [class.px-2.5]="size === 'sm'"
        [class.px-3]="size === 'md'"
        [class.px-4]="size === 'lg'"
        class="hover:bg-muted h-full flex items-center justify-center shrink-0 text-text-secondary transition-colors"
        (click)="decrease()"
        type="button"
        [disabled]="disabled || loading || displayValue <= min"
      >
        <app-icon [name]="'minus'" [size]="iconSize"></app-icon>
      </button>

      <ng-container *ngIf="editable; else readOnlyDisplay">
        <input
          [class.w-12]="size === 'sm'"
          [class.w-16]="size === 'md'"
          [class.w-20]="size === 'lg'"
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
          [disabled]="disabled || loading"
        />
      </ng-container>

      <ng-template #readOnlyDisplay>
        <span
          [class.min-w-[28px]]="size === 'sm'"
          [class.min-w-[36px]]="size === 'md'"
          [class.min-w-[44px]]="size === 'lg'"
          class="shrink text-center text-xs font-bold text-text-primary"
        >
          {{ displayValue }}
        </span>
      </ng-template>

      <button
        [class.px-2.5]="size === 'sm'"
        [class.px-3]="size === 'md'"
        [class.px-4]="size === 'lg'"
        class="hover:bg-muted h-full flex items-center justify-center shrink-0 text-text-secondary transition-colors"
        (click)="increase()"
        type="button"
        [disabled]="disabled || loading || (max !== null && displayValue >= max)"
      >
        <app-icon [name]="'plus'" [size]="iconSize"></app-icon>
      </button>
    </div>
  `,
  styles: [
    `
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
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
export class QuantityControlComponent implements OnChanges {
  @Input() value = 1;
  @Input() min = 1;
  @Input() max: number | null = null;
  @Input() step = 1;
  @Input() editable = true;
  @Input() disabled = false;
  @Input() loading = false;
  @Input() size: QuantityControlSize = 'sm';
  @Input() styleVariant: FormStyleVariant = 'modern';

  @Output() valueChange = new EventEmitter<number>();

  /**
   * The value displayed in the input
   * This is kept separate from 'value' to handle user typing
   */
  displayValue = 1;

  /**
   * Tracks if user is currently editing the input
   * When true, we don't sync displayValue from value input
   */
  private isEditing = false;

  ngOnChanges(): void {
    // Only sync from parent if user is not actively editing
    // This prevents overwriting user's input while they type
    if (!this.isEditing && this.displayValue !== this.value) {
      this.displayValue = this.value;
    }
  }

  get iconSize(): number {
    const sizeMap: Record<QuantityControlSize, number> = { sm: 12, md: 14, lg: 16 };
    return sizeMap[this.size];
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

    if (this.styleVariant === 'modern') {
      // Modern: larger border-radius (12px)
      return [
        ...baseClasses,
        heightClasses[this.size],
        'rounded-xl',
      ].join(' ');
    }

    // Classic: same border-radius as modern (0.75rem / 12px)
    return [
      ...baseClasses,
      heightClasses[this.size],
      'rounded-xl',
    ].join(' ');
  }

  decrease(): void {
    if (this.disabled || this.loading) return;

    const newValue = Math.max(this.min, this.displayValue - this.step);
    this.emitValue(newValue);
  }

  increase(): void {
    if (this.disabled || this.loading) return;

    const newValue = this.max !== null
      ? Math.min(this.max, this.displayValue + this.step)
      : this.displayValue + this.step;

    this.emitValue(newValue);
  }

  onInputChange(newValue: any): void {
    this.isEditing = true;

    // Only accept numeric strings (digits only)
    const stringValue = String(newValue);

    // If empty, set to minimum
    if (stringValue === '' || stringValue === '-') {
      this.displayValue = this.min;
      return;
    }

    // Only accept positive integers (0-9 only)
    const numericValue = parseInt(stringValue, 10);

    if (!isNaN(numericValue) && /^[0-9]+$/.test(stringValue)) {
      this.displayValue = numericValue;
    }
    // If invalid characters, don't update displayValue
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

    if (this.displayValue < this.min) {
      constrainedValue = this.min;
    } else if (this.max !== null && this.displayValue > this.max) {
      constrainedValue = this.max;
    }

    // Only emit if value actually changed
    if (constrainedValue !== this.value) {
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
