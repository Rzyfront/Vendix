import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface ToastAction {
  /** Texto del botón de acción (ej. "Deshacer", "Reintentar"). */
  label: string;
  /** Handler al hacer click. El toast NO se descarta automáticamente —
   * la acción decide si llama a `toast.dismiss(toast.id)` o no. */
  onClick: () => void;
}

export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant: ToastVariant;
  duration: number; // ms
  leaving: boolean; // UI state for exit animation
  /**
   * Botón de acción opcional. `undefined` ⇒ el toast se ve igual que antes
   * (sólo título + descripción + botón Cerrar). Cuando está presente, se
   * renderiza un botón al lado del Cerrar que ejecuta `onClick`.
   */
  action?: ToastAction;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private toastsSig = signal<Toast[]>([]);
  readonly toasts = this.toastsSig.asReadonly();

  show(
    input: Partial<Toast> & {
      description?: string;
      title?: string;
      variant?: ToastVariant;
      duration?: number;
    },
  ) {
    const toast: Toast = {
      id: Math.random().toString(36).slice(2),
      title: input.title,
      description: input.description,
      variant: input.variant ?? 'default',
      duration: input.duration ?? 1750,
      leaving: false,
      action: input.action,
    };
    this.toastsSig.update((arr) => [toast, ...arr]);
    if (toast.duration > 0) {
      setTimeout(() => this.dismiss(toast.id), toast.duration);
    }
  }

  dismiss(id: string) {
    // mark leaving for exit animation, then remove after 200ms
    let shouldScheduleRemoval = false;
    this.toastsSig.update((arr) =>
      arr.map((t) => {
        if (t.id === id && !t.leaving) {
          shouldScheduleRemoval = true;
          return { ...t, leaving: true };
        }
        return t;
      }),
    );
    if (shouldScheduleRemoval) {
      setTimeout(() => {
        this.toastsSig.update((arr) => arr.filter((t) => t.id !== id));
      }, 200);
    } else {
      // If it was already leaving or not found, ensure it's removed
      this.toastsSig.update((arr) => arr.filter((t) => t.id !== id));
    }
  }

  clear() {
    this.toastsSig.set([]);
  }

  // helpers (durations reduced 50% for snappier UX)
  success(msg: string, title?: string, duration = 1500) {
    this.show({ title, description: msg, variant: 'success', duration });
  }
  error(msg: string, title?: string, duration = 2000) {
    this.show({ title, description: msg, variant: 'error', duration });
  }
  warning(msg: string, title?: string, duration = 1750) {
    this.show({ title, description: msg, variant: 'warning', duration });
  }
  info(msg: string, title?: string, duration = 1500) {
    this.show({ title, description: msg, variant: 'info', duration });
  }
}
