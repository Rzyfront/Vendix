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

@Component({
  selector: 'app-textarea',
  standalone: true,
  imports: [CommonModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TextareaComponent),
      multi: true,
    },
  ],
  template: `
    <div [class]="'w-full mt-4 ' + customWrapperClass">
      <!-- Label -->
      <label
        *ngIf="label"
        [for]="textareaId"
        [class]="
          'block text-sm font-medium text-[var(--color-text-primary)] mb-2 ' +
          customLabelClass
        "
      >
        {{ label }}
        <span *ngIf="required" class="text-[var(--color-destructive)] ml-1"
          >*</span
        >
      </label>

      <!-- Textarea wrapper -->
      <div class="relative">
        <textarea
          [id]="textareaId"
          [placeholder]="placeholder"
          [disabled]="disabled"
          [readonly]="readonly"
          [value]="value"
          [rows]="rows"
          [class]="textareaClasses"
          [style]="customStyle"
          (input)="onInput($event)"
          (blur)="onBlur()"
          (focus)="onFocus()"
        ></textarea>
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
  styles: [`
    textarea {
      resize: vertical;
      min-height: 80px;
    }
  `],
})
export class TextareaComponent implements ControlValueAccessor {
  @Input() label?: string;
  @Input() placeholder = '';
  @Input() rows = 3;
  @Input() disabled = false;
  @Input() readonly = false;
  @Input() required = false;
  @Input() error?: string;
  @Input() helperText?: string;
  @Input() control?: AbstractControl | null;
  @Input() customStyle = '';
  @Input() customWrapperClass = '';
  @Input() customLabelClass = '';
  @Input() customClass = '';

  @Output() valueChange = new EventEmitter<string>();
  @Output() textareaFocus = new EventEmitter<void>();
  @Output() textareaBlur = new EventEmitter<void>();

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

  get textareaClasses(): string {
    const baseClasses = [
      'block',
      'w-full',
      'border',
      'rounded-sm',
      'transition-colors',
      'duration-200',
      'focus:outline-none',
      'focus:ring-2',
      'px-4',
      'py-2',
      'text-base',
      'placeholder:text-text-muted',
    ];

    let stateClasses: string[];
    const isInvalid = (this.control?.invalid || this.error) && (this.control?.touched || this.error);

    if (isInvalid) {
      stateClasses = [
        'border-[var(--color-destructive)]',
        'focus:border-[var(--color-destructive)]',
        'focus:ring-[var(--color-destructive)]/30',
        'bg-[rgba(239, 68, 68, 0.05)]',
      ];
    } else {
      stateClasses = [
        'border-border',
        'hover:border-border',
        'focus:ring-secondary/40',
        'focus:border-primary',
      ];
    }

    const classes = [...baseClasses, ...stateClasses];
    if (this.customClass) classes.push(this.customClass);

    return classes.join(' ');
  }

  getValidationError(): string | null {
    if (this.error) return this.error;
    if (!this.control || !this.control.errors || !this.control.touched) {
      return null;
    }

    const errors = this.control.errors;
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
    this.textareaBlur.emit();
  }

  onFocus(): void {
    this.textareaFocus.emit();
  }
}
