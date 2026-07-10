import { create } from 'zustand';
import type { CashRegisterSession } from '../services/cash-register.service';

interface CashRegisterState {
  /** Sesión activa del usuario actual (null = no hay caja abierta). */
  activeSession: CashRegisterSession | null;
  /** Si el feature flag de caja registradora está habilitado en la tienda. */
  featureEnabled: boolean;

  setActiveSession: (session: CashRegisterSession | null) => void;
  setFeatureEnabled: (enabled: boolean) => void;
  clearSession: () => void;
}

/**
 * Store global de caja registradora — paridad con `PosCashRegisterService`
 * (Angular signals) del web, pero expuesto como zustand para integrarse con
 * el patrón de state del mobile (ver `cart.store.ts`).
 *
 * Consumido por:
 *  - `pos-screen-header.tsx` (badge + dropdown "Caja Principal")
 *  - los 4 modales (open/close/movement/detail) que actualizan la sesión
 *  - `pos-payment-modal.tsx` para validar que hay caja abierta antes de cobrar
 */
export const useCashRegisterStore = create<CashRegisterState>((set) => ({
  activeSession: null,
  featureEnabled: false,

  setActiveSession: (session) => set({ activeSession: session }),
  setFeatureEnabled: (enabled) => set({ featureEnabled: enabled }),
  clearSession: () => set({ activeSession: null }),
}));