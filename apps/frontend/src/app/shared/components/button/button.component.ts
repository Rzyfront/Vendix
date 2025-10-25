import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button 
      [type]="type"
      [disabled]="disabled || loading"
      [class]="buttonClasses"
      (click)="handleClick($event)"
    >
      <div class="flex items-center justify-center gap-2">
        <!-- Loading spinner -->
        <svg 
          *ngIf="loading" 
          class="animate-spin h-4 w-4" 
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
        
        <!-- Icon slot -->
        <ng-content select="[slot=icon]"></ng-content>
        
        <!-- Button text -->
        <span *ngIf="!loading || showTextWhileLoading">
          <ng-content></ng-content>
        </span>
      </div>
    </button>
  `,
  styles: [`
    :host {
      display: inline-block;
    }
  `]
})
export class ButtonComponent {
  @Input() variant: ButtonVariant = 'primary';
  @Input() size: ButtonSize = 'md';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() disabled = false;
  @Input() loading = false;
  @Input() showTextWhileLoading = false;
  @Input() fullWidth = false;
  @Input() customClasses = '';

  @Output() clicked = new EventEmitter<Event>();

  get buttonClasses(): string {
    const baseClasses = [
      'font-medium',
      'rounded-sm',
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
      'justify-center'
    ];

    // Size classes
    const sizeClasses = {
      sm: ['px-3', 'py-1.5', 'text-sm'],
      md: ['px-4', 'py-2', 'text-base'],
      lg: ['px-6', 'py-3', 'text-lg']
    };

    // Variant classes
    const variantClasses = {
      primary: [
        'bg-[var(--color-primary)]',
        'hover:bg-[var(--color-primary)]/90',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-primary)]/50'
      ],
      secondary: [
        'bg-[var(--color-secondary)]',
        'hover:bg-[var(--color-secondary)]/90',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-secondary)]/50'
      ],
      outline: [
        'border-2',
        'border-[var(--color-primary)]',
        'text-[var(--color-primary)]',
        'hover:bg-[var(--color-primary)]',
        'hover:text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-primary)]/50'
      ],
      ghost: [
        'text-[var(--color-text-primary)]',
        'hover:bg-[var(--color-background)]',
        'focus:ring-[var(--color-border)]'
      ],
      danger: [
        'bg-[var(--color-destructive)]',
        'hover:bg-[var(--color-destructive)]',
        'text-[var(--color-text-on-primary)]',
        'focus:ring-[var(--color-destructive)]/50'
      ]
    };

    // Width classes
    const widthClasses = this.fullWidth ? ['w-full'] : [];

    const classes = [
      ...baseClasses,
      ...sizeClasses[this.size],
      ...variantClasses[this.variant],
      ...widthClasses
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
