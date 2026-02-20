import {
  Component,
  Input,
  Output,
  EventEmitter,
  forwardRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  AbstractControl,
} from '@angular/forms';

import { FormStyleVariant } from '../../types/form.types';

export type InputType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'tel'
  | 'url'
  | 'search'
  | 'date';
export type InputSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [CommonModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true,
    },
  ],
  template: `
    <div [class]="'w-full ' + customWrapperClass">
      <!-- Label -->
      <label
        *ngIf="label"
        [for]="inputId"
        [class]="labelClasses"
        class="label-with-tooltip"
      >
        <span>{{ label }}</span>
        <span
          *ngIf="tooltipText"
          class="help-icon"
          [attr.data-tooltip]="tooltipText"
        >
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
        <span *ngIf="required" class="text-[var(--color-destructive)] ml-1"
          >*</span
        >
      </label>

      <!-- Input wrapper -->
      <div class="relative">
        <!-- Prefix icon -->
        <div
          *ngIf="prefixIcon"
          class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
        >
          <ng-content select="[slot=prefix-icon]"></ng-content>
        </div>

        <!-- Input field -->
        <input
          [id]="inputId"
          [type]="actualInputType"
          [placeholder]="placeholder"
          [disabled]="disabled"
          [readonly]="readonly"
          [value]="value"
          [step]="step"
          [min]="min"
          [max]="max"
          [class]="inputClasses"
          [style]="customInputStyle"
          (input)="onInput($event)"
          (blur)="onBlur()"
          (focus)="onFocus()"
        />

        <!-- Password visibility toggle -->
        <button
          *ngIf="type === 'password'"
          type="button"
          class="absolute inset-y-0 right-0 pr-3 flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors duration-200 focus:outline-none"
          (click)="togglePasswordVisibility()"
          [attr.aria-label]="
            showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
          "
          tabindex="-1"
        >
          <!-- Eye icon (show password) -->
          <svg
            *ngIf="!showPassword"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          <!-- Eye-off icon (hide password) -->
          <svg
            *ngIf="showPassword"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
            />
          </svg>
        </button>

        <!-- Suffix icon (only show if not password type) -->
        <div
          *ngIf="suffixIcon && type !== 'password'"
          class="absolute inset-y-0 right-0 pr-3 flex items-center"
          [class.pointer-events-none]="!suffixClickable"
          (click)="onSuffixClick()"
        >
          <ng-content select="[slot=suffix-icon]"></ng-content>
        </div>
      </div>

      <!-- Helper text -->
      <p
        *ngIf="helperText && !getValidationError()"
        class="mt-2 text-sm text-[var(--color-text-secondary)]"
      >
        {{ helperText }}
      </p>

      <!-- Error message -->
      <p
        *ngIf="getValidationError()"
        class="mt-2 text-sm text-[var(--color-destructive)]"
      >
        {{ getValidationError() }}
      </p>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* Hide number input spinners */
      input[type='number']::-webkit-outer-spin-button,
      input[type='number']::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      input[type='number'] {
        -moz-appearance: textfield;
        appearance: textfield;
      }

      /* Tooltip help icon styles */
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
export class InputComponent implements ControlValueAccessor {
  @Input() label?: string;
  @Input() placeholder = '';
  @Input() type: InputType = 'text';
  @Input() size: InputSize = 'md';
  @Input() styleVariant: FormStyleVariant = 'modern';
  @Input() disabled = false;
  @Input() readonly = false;
  @Input() required = false;
  @Input() error?: string;
  @Input() helperText?: string;
  @Input() prefixIcon = false;
  @Input() suffixIcon = false;
  @Input() suffixClickable = false;
  @Input() control?: AbstractControl | null;
  @Input() step?: string;
  @Input() min?: string | number;
  @Input() max?: string | number;

  // ✅ Nuevos inputs para personalización de estilos
  @Input() customInputStyle = ''; // Estilos inline personalizados
  @Input() customWrapperClass = ''; // Clases para el wrapper
  @Input() customLabelClass = ''; // Clases para el label
  @Input() customInputClass = ''; // Clases adicionales para el input
  @Input() customClasses = ''; // Retrocompatibilidad
  @Input() tooltipText?: string; // Texto para el tooltip de ayuda (muestra ícono automáticamente)

  @Output() inputChange = new EventEmitter<string>();
  @Output() inputFocus = new EventEmitter<void>();
  @Output() inputBlur = new EventEmitter<void>();
  @Output() suffixClick = new EventEmitter<void>();

  @Input() value = '';
  inputId = `input-${Math.random().toString(36).substr(2, 9)}`;
  showPassword = false;

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

    if (this.styleVariant === 'modern') {
      // Modern: iOS-inspired uppercase labels
      return [
        ...baseClasses,
        'text-[11px]',
        'uppercase',
        'tracking-[0.05em]',
        'text-[var(--color-text-muted)]',
        this.customLabelClass,
      ]
        .filter(Boolean)
        .join(' ');
    }

    // Classic: standard labels
    return [
      ...baseClasses,
      'text-sm',
      'text-[var(--color-text-primary)]',
      this.customLabelClass,
    ]
      .filter(Boolean)
      .join(' ');
  }

  get inputClasses(): string {
    // Clases base comunes
    const baseClasses = [
      'block',
      'w-full',
      'border',
      'transition-colors',
      'duration-200',
      'focus:outline-none',
      'placeholder:text-text-muted',
    ];

    // Clases de validación por estado
    let stateClasses: string[];
    if (this.control?.invalid && this.control?.touched) {
      stateClasses = [
        'border-[var(--color-destructive)]',
        'focus:border-[var(--color-destructive)]',
        'bg-[rgba(239,68,68,0.1)]',
      ];
    } else if (
      this.control?.valid &&
      this.control?.touched &&
      this.control?.value
    ) {
      stateClasses = [
        'border-[var(--color-primary)]',
        'focus:border-[var(--color-primary)]',
        'bg-[rgba(126,215,165,0.1)]',
      ];
    } else {
      stateClasses = [
        'border-border',
        'hover:border-border',
        'focus:border-primary',
      ];
    }

    // Padding ajustado para íconos
    const iconPadding = [];
    if (this.prefixIcon) {
      iconPadding.push('pl-10');
    }
    if (this.suffixIcon || this.type === 'password') {
      iconPadding.push('pr-10');
    }

    let variantClasses: string[];

    // Unified height system (matches ButtonComponent)
    // sm: 32px mobile → 36px desktop
    // md: 40px mobile → 44px desktop
    // lg: 48px mobile → 52px desktop
    const sizeClasses = {
      sm: ['h-8', 'sm:h-9', 'px-3', 'text-sm'],
      md: ['h-10', 'sm:h-11', 'px-3', 'sm:px-4', 'text-sm', 'sm:text-base'],
      lg: ['h-12', 'sm:h-[52px]', 'px-4', 'text-base', 'sm:text-lg'],
    };

    if (this.styleVariant === 'modern') {
      // Modern: iOS-inspired with shadow focus
      variantClasses = [
        ...sizeClasses[this.size],
        'rounded-xl',
        'bg-[var(--color-background)]',
        'focus:bg-[var(--color-surface)]',
        'focus:shadow-[0_0_0_3px_var(--color-ring)]',
        this.control?.invalid && this.control?.touched
          ? 'focus:shadow-[0_0_0_3px_rgba(239,68,68,0.3)]'
          : this.control?.valid && this.control?.touched && this.control?.value
            ? 'focus:shadow-[0_0_0_3px_rgba(126,215,165,0.3)]'
            : '',
      ];
    } else {
      // Classic: with ring focus
      variantClasses = [
        ...sizeClasses[this.size],
        'rounded-xl',
        'focus:ring-2',
        this.control?.invalid && this.control?.touched
          ? 'focus:ring-[var(--color-destructive)]/30'
          : this.control?.valid && this.control?.touched && this.control?.value
            ? 'focus:ring-[var(--color-primary)]/30'
            : 'focus:ring-secondary/40',
      ];
    }

    // Combinar todas las clases
    const classes = [
      ...baseClasses,
      ...variantClasses,
      ...stateClasses,
      ...iconPadding,
    ];

    // Agregar clases personalizadas
    if (this.customInputClass) {
      classes.push(this.customInputClass);
    }
    if (this.customClasses) {
      classes.push(this.customClasses);
    }

    return classes.filter(Boolean).join(' ');
  }

  getValidationError(): string | null {
    if (this.error) {
      return this.error;
    }

    if (!this.control || !this.control.errors || !this.control.touched) {
      return null;
    }

    const errors = this.control.errors;
    if (errors['required']) {
      return 'Este campo es requerido.';
    }
    if (errors['email']) {
      return 'Debe ser un email válido.';
    }
    if (errors['maxlength']) {
      return `No puede superar ${errors['maxlength'].requiredLength} caracteres.`;
    }
    if (errors['minlength']) {
      return `Debe tener al menos ${errors['minlength'].requiredLength} caracteres.`;
    }
    if (errors['minLength']) {
      return `La contraseña debe tener al menos ${errors['minLength'].requiredLength} caracteres.`;
    }
    if (errors['uppercase']) {
      return 'La contraseña debe contener al menos una letra mayúscula.';
    }
    if (errors['specialChar']) {
      return 'La contraseña debe contener al menos un carácter especial.';
    }
    if (errors['pattern']) {
      if (this.type === 'tel') {
        return 'Solo se permiten números y los símbolos + # * ( ) -';
      }
      return 'El formato es inválido.';
    }

    // Fallback para otros errores
    return 'El valor es inválido.';
  }

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (this.type === 'tel') {
      target.value = target.value.replace(/[^\d+#*\s()-]/g, '');
    }
    this.value = target.value;
    this.onChange(this.value);
    this.inputChange.emit(this.value);
  }

  onBlur(): void {
    this.onTouched();
    this.inputBlur.emit();
  }

  onFocus(): void {
    this.inputFocus.emit();
  }

  onSuffixClick(): void {
    if (this.suffixClickable && !this.disabled) {
      this.suffixClick.emit();
    }
  }

  // Password visibility toggle
  get actualInputType(): InputType {
    if (this.type === 'password' && this.showPassword) {
      return 'text';
    }
    return this.type;
  }

  togglePasswordVisibility(): void {
    if (!this.disabled) {
      this.showPassword = !this.showPassword;
    }
  }
}
