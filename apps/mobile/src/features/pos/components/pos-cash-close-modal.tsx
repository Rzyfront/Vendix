/**
 * Modal para cerrar la sesión de caja registradora activa.
 *
 * Implementación pendiente — el flujo de cierre vive en el servicio de
 * cash-register. Cuando se integre, el modal acepta `visible`, `onClose`
 * y la `session` activa, y emite `onClosed()` al confirmar.
 */
import React from 'react';
import type { CashRegisterSession } from '@/features/store/types';

export interface PosCashCloseModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

export const PosCashCloseModal: React.FC<PosCashCloseModalProps> = () => null;