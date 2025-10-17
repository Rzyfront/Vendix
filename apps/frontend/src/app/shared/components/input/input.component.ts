import { Component, Input, Output, EventEmitter, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type InputType = 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';
export type InputSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [CommonModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true
    }
  ],
  template: `
    <div class="w-full mt-4">
      <!-- Label -->
      <label 
        *ngIf="label" 
        [for]="inputId"
        class="block text-sm font-medium text-text-primary mb-2"
      >
        {{ label }}
        <span *ngIf="required" class="text-red-500 ml-1">*</span>
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
          [type]="type"
          [placeholder]="placeholder"
          [disabled]="disabled"
          [readonly]="readonly"
          [value]="value"
          [class]="inputClasses"
          (input)="onInput($event)"
          (blur)="onBlur()"
          (focus)="onFocus()"
        />

        <!-- Suffix icon -->
        <div 
          *ngIf="suffixIcon" 
          class="absolute inset-y-0 right-0 pr-3 flex items-center"
          [class.pointer-events-none]="!suffixClickable"
          (click)="onSuffixClick()"
        >
          <ng-content select="[slot=suffix-icon]"></ng-content>
        </div>
      </div>

      <!-- Helper text -->
      <p 
        *ngIf="helperText && !error" 
        class="mt-2 text-sm text-text-secondary"
      >
        {{ helperText }}
      </p>

      <!-- Error message -->
      <p 
        *ngIf="error" 
        class="mt-2 text-sm text-red-600"
      >
        {{ error }}
      </p>
    </div>
  `
})
export class InputComponent implements ControlValueAccessor {
  @Input() label?: string;
  @Input() placeholder?: string;
  @Input() type: InputType = 'text';
  @Input() size: InputSize = 'md';
  @Input() disabled = false;
  @Input() readonly = false;
  @Input() required = false;
  @Input() error?: string;
  @Input() helperText?: string;
  @Input() prefixIcon = false;
  @Input() suffixIcon = false;
  @Input() suffixClickable = false;
  @Input() customClasses = '';

  @Output() inputChange = new EventEmitter<string>();
  @Output() inputFocus = new EventEmitter<void>();
  @Output() inputBlur = new EventEmitter<void>();
  @Output() suffixClick = new EventEmitter<void>();

  value = '';
  inputId = `input-${Math.random().toString(36).substr(2, 9)}`;

  // ControlValueAccessor implementation
  private onChange = (value: string) => {};
  private onTouched = () => {};

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

  get inputClasses(): string {
    const baseClasses = [
      'block',
      'w-full',
      'border',
      'rounded-sm',
      'transition-colors',
      'duration-200',
      'focus:outline-none',
      'focus:ring-2',
      'focus:ring-primary/50',
      'focus:border-primary',
      'disabled:opacity-50',
      'disabled:cursor-not-allowed',
      'placeholder:text-text-muted'
    ];

    // Size classes
    const sizeClasses = {
      sm: ['px-3', 'py-1.5', 'text-sm'],
      md: ['px-4', 'py-2', 'text-base'],
      lg: ['px-4', 'py-3', 'text-lg']
    };

    // State classes
    const stateClasses = this.error 
      ? ['border-destructive', 'focus:border-destructive', 'focus:ring-destructive/30']
      : ['border-border', 'hover:border-border'];

    // Padding adjustments for icons
    const iconPadding = [];
    if (this.prefixIcon) {
      iconPadding.push('pl-10');
    }
    if (this.suffixIcon) {
      iconPadding.push('pr-10');
    }

    const classes = [
      ...baseClasses,
      ...sizeClasses[this.size],
      ...stateClasses,
      ...iconPadding
    ];

    if (this.customClasses) {
      classes.push(this.customClasses);
    }

    return classes.join(' ');
  }

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
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
}
