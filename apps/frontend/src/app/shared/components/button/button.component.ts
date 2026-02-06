import { Component, Input, Output, EventEmitter, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'outline-danger'
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
      'font-medium',
      'rounded-xl',
      'transition-all',
      'duration-200',
      'focus:outline-none',
      'focus:ring-2',
      'focus:ring-offset-2',
      'disabled:opacity-50',
      'disabled:cursor-not-allowed',
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

    // Variant classes
    const variantClasses = {
      primary: [
        'bg-[var(--color-primary)]',
        'hover:bg-[var(--color-primary)]/90',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-primary)]/50',
      ],
      secondary: [
        'bg-[var(--color-secondary)]',
        'hover:bg-[var(--color-secondary)]/90',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-secondary)]/50',
      ],
      outline: [
        'border',
        'border-[var(--color-primary)]',
        'text-[var(--color-primary)]',
        'hover:bg-[var(--color-primary)]',
        'hover:text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-primary)]/50',
      ],
      'outline-danger': [
        'border',
        'border-[var(--color-destructive)]',
        'text-[var(--color-destructive)]',
        'hover:bg-[var(--color-destructive)]',
        'hover:text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-destructive)]/50',
      ],
      ghost: [
        'text-[var(--color-text-primary)]',
        'hover:bg-[var(--color-background)]',
        'focus:ring-[var(--color-border)]',
      ],
      danger: [
        'bg-[var(--color-destructive)]',
        'hover:bg-[var(--color-destructive)]',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-destructive)]/50',
      ],
      success: [
        'bg-green-600',
        'hover:bg-green-700',
        'text-white',
        'focus:ring-green-500/50',
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
