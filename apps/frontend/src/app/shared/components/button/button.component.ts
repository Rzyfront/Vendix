import { Component, Input, Output, EventEmitter, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'outline-danger'
  | 'outline-warning'
  | 'ghost'
  | 'danger'
  | 'success';
export type ButtonSize = 'xsm' | 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [type]="type"
      [attr.form]="form"
      [disabled]="disabled || loading"
      [class]="buttonClasses"
      (click)="handleClick($event)"
    >
      <div class="btn-content">
        <!-- Loading spinner -->
        <svg
          *ngIf="loading"
          class="animate-spin h-4 w-4 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          ></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <span class="btn-icon flex-shrink-0"><ng-content select="[slot=icon]"></ng-content></span>
        <span *ngIf="!loading || showTextWhileLoading" class="btn-text"><ng-content></ng-content></span>
      </div>
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        min-width: 0; /* Permite que el host se achique */
        max-width: 100%;
      }

      /* Contenido del botón - adaptativo */
      .btn-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        min-width: 0; /* Permite que el contenido se achique */
        max-width: 100%;
        overflow: hidden;
      }

      /* Texto del botón - truncable */
      .btn-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      /* Icono del botón - no se achica */
      .btn-icon {
        display: inline-flex;
        flex-shrink: 0;
      }

      .btn-icon:empty {
        display: none;
      }

      .btn-text:empty {
        display: none;
      }

      /* Asegurar alturas exactas para consistencia (mobile-first) */
      .h-7 {
        height: 1.75rem; /* 28px */
      }

      .h-8 {
        height: 2rem; /* 32px - móvil sm */
      }

      .h-9 {
        height: 2.25rem; /* 36px */
      }

      .h-10 {
        height: 2.5rem; /* 40px - móvil md */
      }

      .h-11 {
        height: 2.75rem; /* 44px */
      }

      .h-12 {
        height: 3rem; /* 48px - móvil lg */
      }

      .h-13 {
        height: 3.25rem; /* 52px */
      }

      /* Colored glow shadows - POS style */
      .btn-shadow-primary {
        box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
      }

      .btn-shadow-secondary {
        box-shadow: 0 4px 12px rgba(var(--color-secondary-rgb), 0.3);
      }

      .btn-shadow-danger {
        box-shadow: 0 4px 12px rgba(var(--color-destructive-rgb), 0.3);
      }

      .btn-shadow-success {
        box-shadow: 0 4px 12px rgba(var(--color-success-rgb), 0.3);
      }

      .btn-shadow-warning {
        box-shadow: 0 4px 12px rgba(var(--color-warning-rgb), 0.3);
      }

      /* Outline hover backgrounds */
      .btn-outline-border {
        border: 1px solid rgba(var(--color-primary-rgb), 0.5);
      }

      .btn-outline-border:hover:not(:disabled) {
        background: rgba(var(--color-primary-rgb), 0.06);
      }

      .btn-outline-danger-border {
        border: 1px solid rgba(var(--color-destructive-rgb), 0.5);
      }

      .btn-outline-danger-border:hover:not(:disabled) {
        background: rgba(var(--color-destructive-rgb), 0.06);
      }

      .btn-outline-warning-border {
        border: 1px solid rgba(var(--color-warning-rgb), 0.5);
      }

      .btn-outline-warning-border:hover:not(:disabled) {
        background: rgba(var(--color-warning-rgb), 0.06);
      }
    `,
  ],
})
export class ButtonComponent {
  @Input() variant: ButtonVariant = 'primary';
  @Input() size: ButtonSize = 'md';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() form?: string; // Associates button with a form by id (for buttons outside the form)
  @Input() disabled = false;
  @Input() loading = false;
  @Input() showTextWhileLoading = false;
  @Input() fullWidth = false;
  @Input() customClasses = '';

  @HostBinding('class.w-full')
  get isFullWidth(): boolean {
    return this.fullWidth;
  }

  @Output() clicked = new EventEmitter<Event>();

  get buttonClasses(): string {
    const baseClasses = [
      'font-semibold',
      'rounded-xl',
      'transition-all',
      'duration-200',
      'focus:outline-none',
      'focus:ring-2',
      'focus:ring-offset-2',
      'disabled:opacity-40',
      'disabled:cursor-not-allowed',
      'active:scale-[0.97]',
      'relative',
      'inline-flex',
      'items-center',
      'justify-center',
      // Clases para adaptabilidad - permite que el botón se achique
      'min-w-0',
      'max-w-full',
      'overflow-hidden',
    ];

    // Size classes - mobile-first con alturas consistentes con inputs y selectors
    const sizeClasses = {
      xsm: ['h-7', 'px-2', 'text-xs'], // 28px - extra small
      sm: ['h-8', 'px-2.5', 'text-sm', 'sm:h-9', 'sm:px-3'], // 32px móvil → 36px desktop
      md: ['h-10', 'px-3', 'text-sm', 'sm:h-11', 'sm:px-4', 'sm:text-base'], // 40px móvil → 44px desktop
      lg: ['h-12', 'px-4', 'text-base', 'sm:h-13', 'sm:px-6', 'sm:text-lg'], // 48px móvil → 52px desktop
    };

    // Variant classes — POS-inspired style
    const variantClasses = {
      primary: [
        'bg-[var(--color-primary)]',
        'hover:brightness-110',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-primary)]/50',
        'btn-shadow-primary',
      ],
      secondary: [
        'bg-[var(--color-secondary)]',
        'hover:brightness-110',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-secondary)]/50',
        'btn-shadow-secondary',
      ],
      outline: [
        'btn-outline-border',
        'text-[var(--color-primary)]',
        'focus:ring-[var(--color-primary)]/50',
      ],
      'outline-danger': [
        'btn-outline-danger-border',
        'text-[var(--color-destructive)]',
        'focus:ring-[var(--color-destructive)]/50',
      ],
      'outline-warning': [
        'btn-outline-warning-border',
        'text-[var(--color-warning)]',
        'focus:ring-orange-500/50',
      ],
      ghost: [
        'text-[var(--color-text-primary)]',
        'hover:bg-[var(--color-background)]',
        'focus:ring-[var(--color-border)]',
      ],
      danger: [
        'bg-[var(--color-destructive)]',
        'hover:brightness-110',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-destructive)]/50',
        'btn-shadow-danger',
      ],
      success: [
        'bg-[var(--color-success)]',
        'hover:brightness-110',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-success)]/50',
        'btn-shadow-success',
      ],
    };

    // Width classes
    const widthClasses = this.fullWidth ? ['w-full'] : [];

    const classes = [
      ...baseClasses,
      ...sizeClasses[this.size],
      ...variantClasses[this.variant],
      ...widthClasses,
    ];

    if (this.customClasses) {
      classes.push(this.customClasses);
    }

    return classes.join(' ');
  }

  handleClick(event: Event): void {
    if (!this.disabled && !this.loading) {
      this.clicked.emit(event);
    }
  }
}
