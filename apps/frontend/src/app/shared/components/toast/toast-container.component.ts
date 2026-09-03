import { Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { ToastService, Toast } from './toast.service';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons.registry';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [NgClass, IconComponent],
  template: `
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
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
              <div class="flex-1 min-w-0">
                @if (t.title) {
                  <p class="text-sm font-semibold">{{ t.title }}</p>
                }
                @if (t.description) {
                  <p class="text-sm text-[var(--color-text-secondary)] mt-0.5">
                    {{ t.description }}
                  </p>
                }
              </div>
              <div class="flex items-center gap-1 shrink-0">
                @if (t.action) {
                  <button
                    type="button"
                    class="text-xs font-semibold underline underline-offset-2
                           hover:opacity-80 focus:outline-none focus:ring-2
                           focus:ring-[var(--color-ring)] rounded px-1.5 py-0.5"
                    (click)="onActionClick(t)"
                    [attr.aria-label]="t.action.label"
                  >
                    {{ t.action.label }}
                  </button>
                }
                <button
                  class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  (click)="dismiss(t.id)"
                  aria-label="Cerrar"
                  type="button"
                  >
                  ×
                </button>
              </div>
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

  /**
   * Acción opcional del toast. El handler decide si llama a `dismiss` o
   * no — nosotros NO lo descartamos automáticamente para no quitarle al
   * caller el control del cierre (ej. un "Deshacer" puede querer mantener
   * el toast vivo unos segundos más mientras se procesa el undo).
   */
  onActionClick(t: Toast) {
    t.action?.onClick();
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
