/**
 * STUB — sub-PR #5 (5b+5c)
 *
 * Modal para abrir una sesión de caja registradora. La implementación real
 * pertenece a sub-PR #6 (chunk 5d: cash-register + order-create).
 *
 * Este stub existe para que `pos/index.tsx` compile standalone con la
 * referencia `<PosCashOpenModal visible={...} onClose={...} />`. Cuando
 * sub-PR #6 reemplace este archivo, el cambio será drop-in sin tocar
 * pos/index.tsx (las props son las mismas).
 *
 * Ver plan `/tmp/sub-pr-5-pos-screen-cart.md` §Approach Chosen (Option B).
 */
import React from 'react';

export interface PosCashOpenModalProps {
  visible: boolean;
  onClose: () => void;
}

export const PosCashOpenModal: React.FC<PosCashOpenModalProps> = () => null;