import {
  Component,
  forwardRef,
  input,
  output,
  signal,
  effect,
} from '@angular/core';

import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { FormStyleVariant } from '../../types/form.types';

@Component({
  selector: 'app-toggle',
  standalone: true,
  imports: [],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ToggleComponent),
      multi: true,
    },
  ],
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
      }
    `,
  ],
  template: `
    <button
      type="button"
      [attr.aria-pressed]="isOn()"
      [attr.aria-label]="ariaLabel() || label() || 'Toggle'"
      [disabled]="disabled()"
      (click)="onToggle()"
      [class]="buttonClasses"
      [class.bg-[var(--color-primary)]]="isOn()"
      [class.bg-[var(--color-muted)]]="!isOn()"
    >
      <span
        class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--color-surface)] shadow ring-0 transition duration-200 ease-in-out"
        [class.translate-x-5]="isOn()"
        [class.translate-x-0]="!isOn()"
      ></span>
    </button>
    @if (label()) {
      <span [class]="labelClasses">{{ label() }}</span>
    }
  `,
})
export class ToggleComponent implements ControlValueAccessor {
  readonly checked = input(false);
  readonly disabled = input(false);
  private isDisabledFromForm = false;
  readonly label = input<string | undefined>(undefined);
  readonly ariaLabel = input<string>();
  readonly styleVariant = input<FormStyleVariant>('modern');

  readonly isOn = signal(false);
  readonly toggled = output<boolean>();
  readonly changed = output<boolean>();

  private onChange: (value: boolean) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    effect(
      () => {
        this.isOn.set(this.checked());
      },
      { allowSignalWrites: true },
    );
  }

  writeValue(value: boolean): void {
    this.isOn.set(!!value);
  }

  registerOnChange(fn: (value: boolean) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabledFromForm = isDisabled;
  }

  onToggle(): void {
    if (this.disabled() || this.isDisabledFromForm) return;
    this.isOn.update((v) => !v);
    this.onChange(this.isOn());
    this.toggled.emit(this.isOn());
    this.changed.emit(this.isOn());
    this.onTouched();
  }

  get buttonClasses(): string {
    const baseClasses = [
      'relative',
      'inline-flex',
      'h-6',
      'w-11',
      'shrink-0',
      'cursor-pointer',
      'rounded-full',
      'border-2',
      'border-transparent',
      'transition-colors',
      'duration-200',
      'ease-in-out',
      'focus:outline-none',
    ];

    if (this.styleVariant() === 'modern') {
      // Modern: shadow-based focus
      return [
        ...baseClasses,
        'focus:shadow-[0_0_0_3px_var(--color-ring)]',
      ].join(' ');
    }

    // Classic: ring with offset
    return [
      ...baseClasses,
      'focus:ring-2',
      'focus:ring-[var(--color-ring)]',
      'focus:ring-offset-2',
    ].join(' ');
  }

  get labelClasses(): string {
    const baseClasses = ['ml-2', 'align-middle'];

    if (this.styleVariant() === 'modern') {
      return [
        ...baseClasses,
        'text-[11px]',
        'uppercase',
        'tracking-[0.05em]',
        'text-[var(--color-text-muted)]',
      ].join(' ');
    }

    return [...baseClasses, 'text-sm', 'text-[var(--color-text-primary)]'].join(
      ' ',
    );
  }
}
