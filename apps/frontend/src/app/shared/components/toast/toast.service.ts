import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface ToastAction {
  label: string;
  variant?: 'primary' | 'outline' | 'ghost';
  callback: () => void;
}

export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant: ToastVariant;
  duration: number; // ms
  leaving: boolean; // UI state for exit animation
  action?: ToastAction;
  persistent?: boolean; // when true, ignore duration (stays until user acts or dismisses)
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
      action?: ToastAction;
      persistent?: boolean;
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
      persistent: input.persistent,
    };
    this.toastsSig.update((arr) => [toast, ...arr]);
    if (toast.duration > 0 && !toast.persistent) {
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

  /**
   * Show a persistent toast with an inline action button. Stays visible
   * until the user acts (callback fires + dismiss) or explicitly dismisses.
   * Useful for "account already exists — recover" flows where the toast
   * is the only entry point to the recovery action.
   */
  withAction(
    input: {
      title?: string;
      description?: string;
      action: ToastAction;
      variant?: ToastVariant;
    },
  ) {
    this.show({
      title: input.title,
      description: input.description,
      variant: input.variant ?? 'info',
      action: input.action,
      persistent: true,
      duration: 0,
    });
  }
}
