import {
  Component,
  forwardRef,
  inject,
  signal,
  input,
  output,
} from '@angular/core';

import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { FormStyleVariant } from '../../types/form.types';

export interface SelectorOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  description?: string;
  icon?: string;
}

export type SelectorSize = 'sm' | 'md' | 'lg';
export type SelectorVariant = 'default' | 'outline' | 'filled';

@Component({
  selector: 'app-selector',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectorComponent),
      multi: true,
    },
  ],
  template: `
    <div [class]="containerClasses">
      @if (label()) {
        <label
          [class]="labelClasses"
          [for]="id()"
          class="label-with-tooltip"
          >
          <span>{{ label() }}</span>
          @if (tooltipText()) {
            <span
              class="help-icon"
              [attr.data-tooltip]="tooltipText()"
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
          }
          @if (required()) {
            <span
              class="text-[var(--color-destructive)] ml-0.5"
              >*</span
              >
            }
          </label>
        }
    
        <div [class]="wrapperClasses">
          <select
            [id]="id()"
            [class]="selectClasses"
            [disabled]="disabled()"
            [required]="required()"
            [ngModel]="selectedValue()"
            (ngModelChange)="onModelChange($event)"
            (blur)="onBlur()"
            (focus)="onFocus()"
            >
            @if (placeholder()) {
              <option [ngValue]="null" disabled selected class="text-text-muted">
                {{ placeholder() }}
              </option>
            }
            @for (option of options(); track trackByOption($index, option)) {
              <option
                [ngValue]="option.value"
                [disabled]="option.disabled"
                >
                {{ option.label }}
              </option>
            }
          </select>
    
          <div [class]="iconClasses">
            <app-icon name="chevron-down" [size]="iconSize"></app-icon>
          </div>
        </div>
    
        @if (helpText() || errorText()) {
          <div class="mt-1 text-sm">
            @if (helpText() && !errorText()) {
              <span class="text-[var(--color-text-secondary)]">
                {{ helpText() }}
              </span>
            }
            @if (errorText()) {
              <span class="text-[var(--color-destructive)] flex items-center gap-1 font-medium">
                <app-icon name="alert-circle" [size]="12"></app-icon>
                {{ errorText() }}
              </span>
            }
          </div>
        }
      </div>
    `,
  styleUrls: ['./selector.component.scss'],
})
export class SelectorComponent implements ControlValueAccessor {
  readonly id = input<string>(`selector-${Math.random().toString(36).substr(2, 9)}`);
  readonly label = input<string>('');
  readonly placeholder = input<string>('');
  readonly helpText = input<string>('');
  readonly errorText = input<string>('');
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly size = input<SelectorSize>('md');
  readonly variant = input<SelectorVariant>('default');
  readonly styleVariant = input<FormStyleVariant>('modern');
  readonly options = input<SelectorOption[]>([]);
  readonly tooltipText = input<string | undefined>(undefined);

  readonly valueChange = output<string | number | null>();
  readonly blur = output<void>();
  readonly focus = output<void>();

  readonly selectedValue = signal<string | number | null>(null);

  // ControlValueAccessor callbacks
  private onChange: (value: string | number | null) => void = () => { };
  private onTouched: () => void = () => { };

  // ControlValueAccessor implementation
  writeValue(value: string | number | null): void {
    this.selectedValue.set(value);
  }

  registerOnChange(fn: (value: string | number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(_isDisabled: boolean): void {
    // disabled is managed via input() signal — no action needed
  }

  onModelChange(value: string | number | null): void {
    this.selectedValue.set(value);
    this.onChange(value);
    this.valueChange.emit(value);
  }

  onFocus(): void {
    this.focus.emit();
  }

  onBlur(): void {
    this.onTouched();
    this.blur.emit();
  }

  trackByOption(index: number, option: SelectorOption): string | number {
    return option.value;
  }

  // CSS classes
  get containerClasses(): string {
    return ['w-full'].filter(Boolean).join(' ');
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
        this.disabled() ? 'opacity-50 cursor-not-allowed' : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    return [
      ...baseClasses,
      'text-sm',
      'text-[var(--color-text-primary)]',
      this.disabled() ? 'opacity-50 cursor-not-allowed' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get wrapperClasses(): string {
    return ['relative'].filter(Boolean).join(' ');
  }

  get selectClasses(): string {
    const baseClasses = [
      'appearance-none',
      'block',
      'w-full',
      'border',
      'truncate',
      'transition-colors',
      'duration-200',
      'focus:outline-none',
      'bg-[var(--color-surface)]',
      'text-[var(--color-text-primary)]',
    ];

    let stateClasses: string[];
    if (this.errorText()) {
      stateClasses = [
        'border-[var(--color-destructive)]',
        'focus:border-[var(--color-destructive)]',
        'bg-[rgba(239,68,68,0.1)]',
      ];
    } else {
      stateClasses = [
        'border-border',
        'hover:border-border',
        'focus:border-primary',
      ];
    }

    let variantClasses: string[];

    // Unified height system (matches ButtonComponent & InputComponent)
    // sm: 32px mobile → 36px desktop
    // md: 40px mobile → 44px desktop
    // lg: 48px mobile → 52px desktop
    const sizeClasses = {
      sm: ['h-8', 'sm:h-9', 'pl-3', 'pr-10', 'text-sm'],
      md: ['h-10', 'sm:h-11', 'pl-3', 'sm:pl-4', 'pr-10', 'text-sm', 'sm:text-base'],
      lg: ['h-12', 'sm:h-[52px]', 'pl-4', 'pr-10', 'text-base', 'sm:text-lg'],
    };

    if (this.styleVariant() === 'modern') {
      // Modern: iOS-inspired with shadow focus
      variantClasses = [
        ...sizeClasses[this.size()],
        'rounded-xl',
        '!bg-[var(--color-background)]',
        'focus:!bg-[var(--color-surface)]',
        this.errorText()
          ? 'focus:shadow-[0_0_0_3px_rgba(239,68,68,0.3)]'
          : 'focus:shadow-[0_0_0_3px_var(--color-ring)]',
      ];
    } else {
      // Classic: with ring focus
      variantClasses = [
        ...sizeClasses[this.size()],
        'rounded-xl',
        'focus:ring-2',
        this.errorText()
          ? 'focus:ring-[var(--color-destructive)]/30'
          : 'focus:ring-secondary/40',
      ];
    }

    return [
      ...baseClasses,
      ...variantClasses,
      ...stateClasses,
      this.variant() && this.variant() !== 'default' ? `selector-${this.variant()}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get iconClasses(): string {
    return ['absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'pointer-events-none', 'text-[var(--color-text-secondary)]'].filter(Boolean).join(' ');
  }

  get placeholderClasses(): string {
    return [
      'selector-placeholder',
      this.size() && `selector-placeholder-${this.size()}`,
      this.disabled() ? 'selector-placeholder-disabled' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get iconSize(): number {
    switch (this.size()) {
      case 'sm':
        return 14;
      case 'lg':
        return 20;
      default:
        return 16;
    }
  }
}
