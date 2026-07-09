/**
 * STUB — sub-PR #5 (5b+5c)
 *
 * Modal de detalle de la sesión de caja activa. La implementación real
 * pertenece a sub-PR #6 (chunk 5d: cash-register).
 *
 * Este stub existe para que `pos/index.tsx` compile standalone con la
 * referencia `<PosCashDetailModal visible={...} onClose={...} session={...} />`.
 * Cuando sub-PR #6 reemplace este archivo, el cambio será drop-in.
 *
 * Ver plan `/tmp/sub-pr-5-pos-screen-cart.md` §Approach Chosen (Option B).
 */
import React from 'react';
import type { CashRegisterSession } from '@/features/store/types';

export interface PosCashDetailModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

export const PosCashDetailModal: React.FC<PosCashDetailModalProps> = () => null;