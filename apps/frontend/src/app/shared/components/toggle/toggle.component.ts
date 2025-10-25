import { Component, Input, Output, EventEmitter, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-toggle',
  standalone: true,
  imports: [CommonModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ToggleComponent),
      multi: true,
    },
  ],
  template: `
    <button
      type="button"
      [attr.aria-pressed]="checked"
      [attr.aria-label]="ariaLabel || label || 'Toggle'"
      [disabled]="disabled"
      (click)="onToggle()"
      class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:ring-offset-2"
      [class.bg-[var(--color-primary)]]="checked"
      [class.bg-[var(--color-muted)]"]="!checked"
    >
      <span
        class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--color-surface)] shadow ring-0 transition duration-200 ease-in-out"
        [class.translate-x-5]="checked"
        [class.translate-x-0]="!checked"
      ></span>
    </button>
    <span *ngIf="label" class="ml-2 align-middle text-sm text-[var(--color-text-primary)]">{{ label }}</span>
  `,
})
export class ToggleComponent implements ControlValueAccessor {
  @Input() checked = false;
  @Input() disabled = false;
  @Input() label?: string;
  @Input() ariaLabel?: string;

  @Output() toggled = new EventEmitter<boolean>();

  private onChange: (value: boolean) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: boolean): void {
    this.checked = !!value;
  }

  registerOnChange(fn: (value: boolean) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  onToggle(): void {
    if (this.disabled) return;
    this.checked = !this.checked;
    this.onChange(this.checked);
    this.toggled.emit(this.checked);
    this.onTouched();
  }
}
