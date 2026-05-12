import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Date.now().toString();
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));
    if (toast.duration !== 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, toast.duration || 4000);
    }
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

export function toast(message: string, type: ToastType = 'info', duration?: number) {
  useToastStore.getState().addToast({ message, type, duration });
}

export function toastSuccess(message: string, duration?: number) {
  toast(message, 'success', duration);
}

export function toastError(message: string, duration?: number) {
  toast(message, 'error', duration);
}

export function toastWarning(message: string, duration?: number) {
  toast(message, 'warning', duration);
}

export function toastInfo(message: string, duration?: number) {
  toast(message, 'info', duration);
}
