import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed top-4 right-4 z-[9999] flex flex-col gap-3 w-80 max-w-[90vw]">
      <div
        *ngFor="let t of toasts()"
        class="group overflow-hidden rounded-lg border shadow-[var(--shadow-card)] bg-[var(--color-background)] text-[var(--color-text-primary)] toast-item"
        [ngClass]="[variantClasses(t.variant), t.leaving ? 'toast-leave' : 'toast-enter']"
        [style.--toast-duration]="t.duration + 'ms'"
      >
        <div class="p-4">
          <div class="flex items-start gap-3">
            <div class="mt-0.5">
              <span [innerHTML]="iconFor(t.variant)"></span>
            </div>
            <div class="flex-1">
              @if (t.title) {
                <p class="text-sm font-semibold">{{ t.title }}</p>
              }
              @if (t.description) {
                <p class="text-sm text-[var(--color-text-secondary)] mt-0.5">{{ t.description }}</p>
              }
            </div>
            <button class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" (click)="dismiss(t.id)" aria-label="Close">
              ×
            </button>
          </div>
        </div>
        <div class="h-1 toast-progress" [ngClass]="barClasses(t.variant)"></div>
      </div>
    </div>
  `,
})
export class ToastContainerComponent {
  private toast = inject(ToastService);
  toasts = this.toast.toasts;

  dismiss(id: string) {
    this.toast.dismiss(id);
  }

  variantClasses(variant: string) {
    switch (variant) {
      case 'success':
        return 'border-[var(--color-border)] bg-[rgba(126, 215, 165, 0.1)] text-[var(--color-text-primary)]';
      case 'warning':
        return 'border-[var(--color-border)] bg-[rgba(251, 191, 36, 0.1)] text-[var(--color-text-primary)]';
      case 'error':
        return 'border-[var(--color-border)] bg-[rgba(239, 68, 68, 0.1)] text-[var(--color-text-primary)]';
      case 'info':
        return 'border-[var(--color-border)] bg-[rgba(59, 130, 246, 0.1)] text-[var(--color-text-primary)]';
      default:
        return 'border-[var(--color-border)]';
    }
  }

  barClasses(variant: string) {
    switch (variant) {
      case 'success':
        return 'bg-[var(--color-primary)]';
      case 'warning':
        return 'bg-[var(--color-accent)]';
      case 'error':
        return 'bg-[var(--color-destructive)]';
      case 'info':
        return 'bg-[var(--color-primary)]';
      default:
        return 'bg-[var(--color-muted)]';
    }
  }

  iconFor(variant: string) {
    const base = 'w-5 h-5';
    if (variant === 'success') return `<svg class="${base} text-[var(--color-primary)]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 00-1.414-1.414L8 11.172 4.707 7.879a1 1 0 10-1.414 1.414l4 4a1 1 0 001.414 0l8-8z" clip-rule="evenodd"/></svg>`;
    if (variant === 'warning') return `<svg class="${base} text-[var(--color-accent)]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.518 11.593c.75 1.335-.213 2.993-1.742 2.993H3.48c-1.53 0-2.492-1.658-1.743-2.993L8.257 3.1zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-6a1 1 0 00-1 1v2a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`;
    if (variant === 'error') return `<svg class="${base} text-[var(--color-destructive)]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 00-1-1H8a1 1 0 100 2h4a1 1 0 001-1zm-1 4a1 1 0 11-2 0 1 1 0 012 0z" clip-rule="evenodd"/></svg>`;
    if (variant === 'info') return `<svg class="${base} text-[var(--color-primary)]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a1 1 0 112 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clip-rule="evenodd"/></svg>`;
    return `<svg class="${base} text-[var(--color-text-secondary)]" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/></svg>`;
  }
}
