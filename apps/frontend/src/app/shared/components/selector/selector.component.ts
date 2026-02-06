import {
  Component,
  Input,
  Output,
  EventEmitter,
  forwardRef,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
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
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectorComponent),
      multi: true,
    },
  ],
  template: `
    <div [class]="containerClasses">
      <label
        *ngIf="label"
        [class]="labelClasses"
        [for]="id"
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
        <span
          *ngIf="required"
          class="text-[var(--color-destructive)] ml-0.5"
          >*</span
        >
      </label>

      <div [class]="wrapperClasses">
        <select
          [id]="id"
          [class]="selectClasses"
          [disabled]="disabled"
          [required]="required"
          [ngModel]="selectedValue"
          (ngModelChange)="onModelChange($event)"
          (blur)="onBlur()"
          (focus)="onFocus()"
        >
          <option *ngIf="placeholder" [ngValue]="null" disabled selected class="text-text-muted">
            {{ placeholder }}
          </option>
          <option
            *ngFor="let option of options; trackBy: trackByOption"
            [ngValue]="option.value"
            [disabled]="option.disabled"
          >
            {{ option.label }}
          </option>
        </select>

        <div [class]="iconClasses">
          <app-icon name="chevron-down" [size]="iconSize"></app-icon>
        </div>
      </div>

      <div *ngIf="helpText || errorText" class="mt-1 text-sm">
        <span *ngIf="helpText && !errorText" class="text-[var(--color-text-secondary)]">
          {{ helpText }}
        </span>
        <span *ngIf="errorText" class="text-[var(--color-destructive)] flex items-center gap-1 font-medium">
          <app-icon name="alert-circle" [size]="12"></app-icon>
          {{ errorText }}
        </span>
      </div>
    </div>
  `,
  styleUrls: ['./selector.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectorComponent
  implements ControlValueAccessor, OnInit, OnDestroy {
  @Input() id = `selector-${Math.random().toString(36).substr(2, 9)}`;
  @Input() label = '';
  @Input() placeholder = '';
  @Input() helpText = '';
  @Input() errorText = '';
  @Input() required = false;
  @Input() disabled = false;
  @Input() size: SelectorSize = 'md';
  @Input() variant: SelectorVariant = 'default';
  @Input() styleVariant: FormStyleVariant = 'modern';
  @Input() options: SelectorOption[] = [];
  @Input() tooltipText?: string;

  @Output() valueChange = new EventEmitter<string | number | null>();
  @Output() blur = new EventEmitter<void>();
  @Output() focus = new EventEmitter<void>();

  selectedValue: string | number | null = null;
  private destroy$ = new Subject<void>();

  // ControlValueAccessor callbacks
  private onChange: (value: string | number | null) => void = () => { };
  private onTouched: () => void = () => { };

  ngOnInit(): void { }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ControlValueAccessor implementation
  writeValue(value: string | number | null): void {
    this.selectedValue = value;
  }

  registerOnChange(fn: (value: string | number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onModelChange(value: string | number | null): void {
    this.selectedValue = value;
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
    return [
      'w-full',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get labelClasses(): string {
    const baseClasses = ['block', 'font-medium', 'mb-2'];

    if (this.styleVariant === 'modern') {
      return [
        ...baseClasses,
        'text-[11px]',
        'uppercase',
        'tracking-[0.05em]',
        'text-[var(--color-text-muted)]',
        this.disabled ? 'opacity-50 cursor-not-allowed' : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    return [
      ...baseClasses,
      'text-sm',
      'text-[var(--color-text-primary)]',
      this.disabled ? 'opacity-50 cursor-not-allowed' : '',
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
      'transition-colors',
      'duration-200',
      'focus:outline-none',
      'bg-[var(--color-surface)]',
      'text-[var(--color-text-primary)]',
      'pr-10', // Space for chevron
    ];

    let stateClasses: string[];
    if (this.errorText) {
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
      sm: ['h-8', 'sm:h-9', 'px-3', 'text-sm'],
      md: ['h-10', 'sm:h-11', 'px-3', 'sm:px-4', 'text-sm', 'sm:text-base'],
      lg: ['h-12', 'sm:h-[52px]', 'px-4', 'text-base', 'sm:text-lg'],
    };

    if (this.styleVariant === 'modern') {
      // Modern: iOS-inspired with shadow focus
      variantClasses = [
        ...sizeClasses[this.size],
        'rounded-xl',
        '!bg-[var(--color-background)]',
        'focus:!bg-[var(--color-surface)]',
        this.errorText
          ? 'focus:shadow-[0_0_0_3px_rgba(239,68,68,0.3)]'
          : 'focus:shadow-[0_0_0_3px_var(--color-ring)]',
      ];
    } else {
      // Classic: with ring focus
      variantClasses = [
        ...sizeClasses[this.size],
        'rounded-xl',
        'focus:ring-2',
        this.errorText
          ? 'focus:ring-[var(--color-destructive)]/30'
          : 'focus:ring-secondary/40',
      ];
    }

    return [
      ...baseClasses,
      ...variantClasses,
      ...stateClasses,
      this.variant && this.variant !== 'default' ? `selector-${this.variant}` : '',
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
      this.size && `selector-placeholder-${this.size}`,
      this.disabled ? 'selector-placeholder-disabled' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get iconSize(): number {
    switch (this.size) {
      case 'sm':
        return 14;
      case 'lg':
        return 20;
      default:
        return 16;
    }
  }
}
