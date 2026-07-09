/**
 * Modal de detalle de la sesión de caja activa (totales por método, historial).
 *
 * Implementación pendiente — el detalle agregado vive en el servicio de
 * cash-register. Cuando se integre, el modal acepta `visible`, `onClose`
 * y la `session` activa.
 */
import React from 'react';
import type { CashRegisterSession } from '@/features/store/types';

export interface PosCashDetailModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

export const PosCashDetailModal: React.FC<PosCashDetailModalProps> = () => null;