/**
 * Modal para registrar movimientos manuales de caja (cash_in / cash_out).
 *
 * Implementación pendiente — el flujo de movimientos vive en el servicio de
 * cash-register. Cuando se integre, el modal acepta `visible`, `onClose`
 * y la `session` activa, y emite `onRecorded(movement)` al confirmar.
 */
import React from 'react';
import type { CashRegisterSession } from '@/features/store/types';

export interface PosCashMovementModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

export const PosCashMovementModal: React.FC<PosCashMovementModalProps> = () => null;