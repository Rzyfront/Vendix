import { Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { ToastService } from './toast.service';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons.registry';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [NgClass, IconComponent],
  template: `
    <div
      class="fixed top-4 right-4 z-[10000] flex flex-col gap-3 w-80 max-w-[90vw]"
      >
      @for (t of toasts(); track t.id) {
        <div
          class="group overflow-hidden rounded-lg border ring-1 ring-black/10 backdrop-blur-sm toast-item"
        [ngClass]="[
          variantClasses(t.variant),
          t.leaving ? 'toast-leave' : 'toast-enter',
        ]"
          [style.--toast-duration]="t.duration + 'ms'"
          >
          <div class="p-4">
            <div class="flex items-start gap-3">
              <div class="mt-0.5">
                <app-icon
                  [name]="iconName(t.variant)"
                  [size]="20"
                  [color]="iconColor(t.variant)"
                ></app-icon>
              </div>
              <div class="flex-1">
                @if (t.title) {
                  <p class="text-sm font-semibold">{{ t.title }}</p>
                }
                @if (t.description) {
                  <p class="text-sm text-[var(--color-text-secondary)] mt-0.5">
                    {{ t.description }}
                  </p>
                }
              </div>
              <button
                class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                (click)="dismiss(t.id)"
                aria-label="Close"
                >
                ×
              </button>
            </div>
          </div>
          <div class="h-1 toast-progress" [ngClass]="barClasses(t.variant)"></div>
        </div>
      }
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
        return 'border-green-200 bg-green-50 text-green-900 shadow-green-100/50';
      case 'warning':
        return 'border-amber-200 bg-amber-50 text-amber-900 shadow-amber-100/50';
      case 'error':
        return 'border-red-200 bg-red-50 text-red-900 shadow-red-100/50';
      case 'info':
        return 'border-blue-200 bg-blue-50 text-blue-900 shadow-blue-100/50';
      default:
        return 'border-gray-200 bg-gray-50 text-gray-900';
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

  iconColor(variant: string): string {
    switch (variant) {
      case 'success': return '#16a34a';
      case 'warning': return '#d97706';
      case 'error': return '#dc2626';
      case 'info': return '#2563eb';
      default: return '#4b5563';
    }
  }

  iconName(variant: string): IconName {
    switch (variant) {
      case 'success': return 'check-circle';
      case 'warning': return 'alert-triangle';
      case 'error': return 'x-circle';
      case 'info': return 'info';
      default: return 'circle';
    }
  }
}
