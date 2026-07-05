import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  /** Duración en ms. Default 1500 (paridad web: `success/info`). **`0` = sticky (sin auto-dismiss)**. */
  duration?: number;
  /** Acción opcional (ej. "Deshacer", "Reintentar", "Volver"). */
  action?: ToastAction;
  /** Si false, no muestra botón × de dismiss manual. Default true. */
  dismissible?: boolean;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const MAX_VISIBLE_TOASTS = 3;
const POLL_INTERVAL_MS = 200;

/**
 * **SOLUCIÓN DEFINITIVA** al bug "primer toast no se quita cuando hay 2
 * notificaciones de tipos diferentes".
 *
 * En lugar de `setTimeout` (que depende del orden de creación y se ha
 * mostrado poco fiable cuando hay 2 toasts seguidos de tipos distintos),
 * usamos **polling**: un `setInterval` que corre cada 200ms y dismissea
 * cualquier toast cuyo `Date.now() + duration` ya pasó.
 *
 * El id del toast codifica el `Date.now()` de creación
 * (formato `${Date.now()}-${rand}`), así que podemos calcular la
 * expiración sin guardar timestamps adicionales.
 */
let checkInterval: ReturnType<typeof setInterval> | null = null;

function getAddedAt(id: string): number {
  // id = `${Date.now()}-${rand}` — primer segmento es el timestamp.
  const dashIdx = id.indexOf('-');
  return parseInt(id.substring(0, dashIdx), 10);
}

function ensureChecker(): void {
  if (checkInterval !== null) return;
  checkInterval = setInterval(() => {
    const state = useToastStore.getState();
    // Si no hay toasts, paramos el interval para no quemar CPU.
    if (state.toasts.length === 0) {
      if (checkInterval !== null) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      return;
    }
    const now = Date.now();
    const remaining = state.toasts.filter((t) => {
      if (t.duration === 0) return true; // sticky
      const expiresAt = getAddedAt(t.id) + (t.duration ?? 1500);
      return now < expiresAt;
    });
    if (remaining.length !== state.toasts.length) {
      useToastStore.setState({ toasts: remaining });
    }
  }, POLL_INTERVAL_MS);
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => {
      const trimmed =
        state.toasts.length >= MAX_VISIBLE_TOASTS
          ? state.toasts.slice(1)
          : state.toasts;
      return { toasts: [...trimmed, { ...toast, id }] };
    });
    ensureChecker();
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
  clearToasts: () => {
    set({ toasts: [] });
    if (checkInterval !== null) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  },
}));

// ── Helpers de uso común ─────────────────────────────────────────────────

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

/**
 * Toast con acción contextual (ej. "Deshacer", "Volver", "Reintentar").
 * Default 3200ms — suficiente para leer y reaccionar.
 */
export function toastAction(
  message: string,
  action: ToastAction,
  type: ToastType = 'info',
  duration = 3200,
) {
  useToastStore.getState().addToast({ message, type, duration, action });
}

/**
 * Toast sticky (sin auto-dismiss). Usar con moderación — sólo para flujos
 * donde el siguiente paso del usuario cierra el toast explícitamente.
 *
 * Caso típico: mostrar mientras se carga un switch de tienda y reemplazarlo
 * con `toastSuccess(...)` cuando termina.
 */
export function toastSticky(message: string, type: ToastType = 'info') {
  useToastStore.getState().addToast({ message, type, duration: 0 });
}