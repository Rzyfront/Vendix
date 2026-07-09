/**
 * Modal para abrir una sesión de caja registradora.
 *
 * Implementación pendiente — el flujo de apertura vive en el servicio de
 * cash-register. El componente acepta `visible` y `onClose` para que el
 * consumidor pueda dispararlo ya; la UI y la confirmación se completarán
 * cuando se conecte el servicio.
 */
import React from 'react';

export interface PosCashOpenModalProps {
  visible: boolean;
  onClose: () => void;
}

export const PosCashOpenModal: React.FC<PosCashOpenModalProps> = () => null;