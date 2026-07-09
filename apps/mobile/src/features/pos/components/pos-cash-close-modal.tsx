/**
 * STUB — sub-PR #5 (5b+5c)
 *
 * Modal para cerrar una sesión de caja registradora. La implementación real
 * pertenece a sub-PR #6 (chunk 5d: cash-register + order-create).
 *
 * Este stub existe para que `pos/index.tsx` compile standalone con la
 * referencia `<PosCashCloseModal visible={...} onClose={...} session={...} />`.
 * Cuando sub-PR #6 reemplace este archivo, el cambio será drop-in.
 *
 * Ver plan `/tmp/sub-pr-5-pos-screen-cart.md` §Approach Chosen (Option B).
 */
import React from 'react';
import type { CashRegisterSession } from '@/features/store/types';

export interface PosCashCloseModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

export const PosCashCloseModal: React.FC<PosCashCloseModalProps> = () => null;