import {
  Component,
  forwardRef,
  input,
  output
} from '@angular/core';

import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  AbstractControl,
} from '@angular/forms';
import { FormStyleVariant } from '../../types/form.types';

@Component({
  selector: 'app-textarea',
  standalone: true,
  imports: [],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TextareaComponent),
      multi: true,
    },
  ],
  template: `
    <div [class]="'w-full ' + customWrapperClass()">
      <!-- Label -->
      @if (label()) {
        <label
          [for]="textareaId"
          [class]="labelClasses"
          >
          {{ label() }}
          @if (required()) {
            <span class="text-[var(--color-destructive)] ml-1"
              >*</span
              >
            }
          </label>
        }
    
        <!-- Textarea wrapper -->
        <div class="relative">
          <textarea
            [id]="textareaId"
            [placeholder]="placeholder()"
            [disabled]="disabled"
            [readonly]="readonly()"
            [value]="value"
            [rows]="rows()"
            [class]="textareaClasses"
            [style]="customStyle()"
            (input)="onInput($event)"
            (blur)="onBlur()"
            (focus)="onFocus()"
          ></textarea>
        </div>
    
        <!-- Helper text -->
        @if (helperText() && !getValidationError()) {
          <p
            class="mt-2 text-sm text-[var(--color-text-secondary)]"
            >
            {{ helperText() }}
          </p>
        }
    
        <!-- Error message -->
        @if (getValidationError()) {
          <p
            class="mt-2 text-sm text-[var(--color-destructive)]"
            >
            {{ getValidationError() }}
          </p>
        }
      </div>
    `,
  styles: [`
    :host {
      display: block;
    }

    textarea {
      resize: vertical;
      min-height: 80px;
    }
  `],
})
export class TextareaComponent implements ControlValueAccessor {
  readonly label = input<string | undefined>(undefined);
  readonly placeholder = input('');
  readonly rows = input(3);
  disabled = false;
  readonly readonly = input(false);
  readonly required = input(false);
  readonly error = input<string>();
  readonly helperText = input<string | undefined>(undefined);
  readonly control = input<AbstractControl | null>();
  readonly styleVariant = input<FormStyleVariant>('modern');
  readonly customStyle = input('');
  readonly customWrapperClass = input('');
  readonly customLabelClass = input('');
  readonly customClass = input('');

  readonly valueChange = output<string>();
  readonly textareaFocus = output<void>();
  readonly textareaBlur = output<void>();

  value = '';
  textareaId = `textarea-${Math.random().toString(36).substr(2, 9)}`;

  // ControlValueAccessor implementation
  private onChange = (value: string) => { };
  private onTouched = () => { };

  writeValue(value: string): void {
    this.value = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  get labelClasses(): string {
    const baseClasses = ['block', 'font-medium', 'mb-2'];

    if (this.styleVariant() === 'modern') {
      return [
        ...baseClasses,
        'text-[11px]',
        'uppercase',
        'tracking-[0.05em]',
        'text-[var(--color-text-muted)]',
        this.customLabelClass(),
      ]
        .filter(Boolean)
        .join(' ');
    }

    return [
      ...baseClasses,
      'text-sm',
      'text-[var(--color-text-primary)]',
      this.customLabelClass(),
    ]
      .filter(Boolean)
      .join(' ');
  }

  get textareaClasses(): string {
    const baseClasses = [
      'block',
      'w-full',
      'border',
      'transition-colors',
      'duration-200',
      'focus:outline-none',
      'placeholder:text-text-muted',
    ];

    const control = this.control();
    const error = this.error();
    const isInvalid = (control?.invalid || error) && (control?.touched || error);

    let stateClasses: string[];
    if (isInvalid) {
      stateClasses = [
        'border-[var(--color-destructive)]',
        'focus:border-[var(--color-destructive)]',
        'bg-[rgba(239,68,68,0.05)]',
      ];
    } else {
      stateClasses = [
        'border-border',
        'hover:border-border',
        'focus:border-primary',
      ];
    }

    let variantClasses: string[];

    if (this.styleVariant() === 'modern') {
      // Modern: iOS-inspired with shadow focus (auto-height for textarea)
      variantClasses = [
        'rounded-xl',                     // 0.75rem = 12px
        'px-3',
        'py-2.5',
        'text-sm',
        'bg-[var(--color-background)]',   // Subtle background like onboarding
        'focus:bg-[var(--color-surface)]', // Change to surface on focus
        isInvalid
          ? 'focus:shadow-[0_0_0_3px_rgba(239,68,68,0.3)]'
          : 'focus:shadow-[0_0_0_3px_var(--color-ring)]',
      ];
    } else {
      // Classic: standard with ring focus
      variantClasses = [
        'rounded-xl',  // Same border-radius as modern (0.75rem / 12px)
        'focus:ring-2',
        'px-4',
        'py-2',
        'text-base',
        isInvalid
          ? 'focus:ring-[var(--color-destructive)]/30'
          : 'focus:ring-secondary/40',
      ];
    }

    const classes = [...baseClasses, ...variantClasses, ...stateClasses];
    const customClass = this.customClass();
    if (customClass) classes.push(customClass);

    return classes.filter(Boolean).join(' ');
  }

  getValidationError(): string | null {
    const error = this.error();
    if (error) return error;
    const control = this.control();
    if (!control || !control.errors || !control.touched) {
      return null;
    }

    const errors = control.errors;
    if (errors['required']) return 'Este campo es requerido.';
    if (errors['maxlength']) return `No puede superar ${errors['maxlength'].requiredLength} caracteres.`;

    return 'El valor es inválido.';
  }

  onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.value = target.value;
    this.onChange(this.value);
    this.valueChange.emit(this.value);
  }

  onBlur(): void {
    this.onTouched();
    // TODO: The 'emit' function requires a mandatory void argument
    this.textareaBlur.emit();
  }

  onFocus(): void {
    // TODO: The 'emit' function requires a mandatory void argument
    this.textareaFocus.emit();
  }
}
