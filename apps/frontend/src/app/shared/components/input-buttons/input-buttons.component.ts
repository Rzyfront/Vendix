import { Component, forwardRef, input, output, signal } from '@angular/core';

import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { FormStyleVariant } from '../../types/form.types';

export interface InputButtonOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-input-buttons',
  standalone: true,
  imports: [],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputButtonsComponent),
      multi: true,
    },
  ],
  template: `
    <div [class]="'w-full ' + customWrapperClass()">
      <!-- Label -->
      @if (label()) {
        <label [class]="labelClasses" class="label-with-tooltip">
          <span>{{ label() }}</span>
          @if (tooltipText()) {
            <span class="help-icon" [attr.data-tooltip]="tooltipText()">
              <svg
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
          }
          @if (required()) {
            <span class="text-[var(--color-destructive)] ml-1">*</span>
          }
        </label>
      }

      <!-- Buttons container -->
      <div [class]="containerClasses + ' ' + customContainerClass()">
        @for (option of options(); track option) {
          <button
            type="button"
            [disabled]="isDisabled()"
            (click)="selectOption(option.value)"
            [class]="getButtonClasses(option.value)"
          >
            {{ option.label }}
          </button>
        }
      </div>

      <!-- Helper text -->
      @if (helperText()) {
        <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
          {{ helperText() }}
        </p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .label-with-tooltip {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }

      .help-icon {
        color: var(--color-text-muted);
        cursor: help;
        position: relative;
        display: inline-flex;
        transition: color 0.2s ease;
      }

      .help-icon:hover {
        color: var(--color-warning);
      }

      .help-icon[data-tooltip]:hover::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        padding: 0.375rem 0.5rem;
        background: var(--color-text-primary);
        color: var(--color-surface);
        font-size: var(--fs-xs);
        border-radius: var(--radius-sm);
        white-space: normal;
        box-shadow: var(--shadow-md);
        z-index: 50;
        margin-bottom: 0.375rem;
        pointer-events: none;
        max-width: 300px;
        width: max-content;
        text-align: center;
        line-height: 1.4;
      }

      .help-icon[data-tooltip]:hover::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 4px solid transparent;
        border-top-color: var(--color-text-primary);
        margin-bottom: -0.125rem;
        z-index: 50;
        pointer-events: none;
      }
    `,
  ],
})
export class InputButtonsComponent implements ControlValueAccessor {
  readonly label = input<string>('');
  readonly options = input<InputButtonOption[]>([]);
  readonly disabled = input<boolean>(false);
  readonly disabledState = signal(false);
  readonly helperText = input<string>('');
  readonly tooltipText = input<string>('');
  readonly required = input(false);
  readonly styleVariant = input<FormStyleVariant>('modern');
  readonly customWrapperClass = input('');
  readonly customContainerClass = input('');

  readonly valueChange = output<string>();

  readonly value = signal('');

  private onChange = (_: string) => {};
  private onTouched = () => {};

  writeValue(value: string): void {
    this.value.set(value || '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
  }

  isDisabled(): boolean {
    return this.disabled() || this.disabledState();
  }

  selectOption(optionValue: string): void {
    if (this.isDisabled()) return;
    this.value.set(optionValue);
    this.onChange(optionValue);
    this.onTouched();
    this.valueChange.emit(optionValue);
  }

  get labelClasses(): string {
    const base = ['block', 'font-medium', 'mb-2'];

    if (this.styleVariant() === 'modern') {
      return [
        ...base,
        'text-[11px]',
        'uppercase',
        'tracking-[0.05em]',
        'text-[var(--color-text-muted)]',
      ].join(' ');
    }

    return [...base, 'text-sm', 'text-[var(--color-text-primary)]'].join(' ');
  }

  get containerClasses(): string {
    return [
      'flex',
      'items-center',
      'gap-1',
      'p-1',
      'bg-[var(--color-background)]',
      'border',
      'border-border',
      'rounded-xl',
      'h-10',
      'sm:h-11',
    ].join(' ');
  }

  getButtonClasses(optionValue: string): string {
    const isSelected = this.value() === optionValue;
    const base = [
      'flex-1',
      'h-full',
      'text-xs',
      'sm:text-sm',
      'font-semibold',
      'rounded-lg',
      'transition-all',
      'duration-200',
      'cursor-pointer',
      'disabled:opacity-50',
      'disabled:cursor-not-allowed',
    ];

    if (isSelected) {
      return [
        ...base,
        'bg-[var(--color-primary)]',
        'text-[var(--color-text-on-primary)]',
        'shadow-sm',
      ].join(' ');
    }

    return [
      ...base,
      'bg-transparent',
      'text-[var(--color-text-muted)]',
      'hover:bg-[var(--color-surface)]',
      'hover:text-[var(--color-text-primary)]',
    ].join(' ');
  }
}
