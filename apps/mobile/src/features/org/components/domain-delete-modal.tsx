import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';

interface DomainDeleteModalProps {
  visible: boolean;
  hostname: string | null;
  isPrimary?: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Confirmación de eliminación de un dominio.
 *
 * Espejo del `DomainDeleteConfirmationComponent` de la web. El botón se
 * deshabilita si el dominio es primario (regla de negocio: el dominio
 * principal no se puede eliminar; hay que promover otro primero).
 */
export function DomainDeleteModal({
  visible,
  hostname,
  isPrimary,
  loading,
  onClose,
  onConfirm,
}: DomainDeleteModalProps) {
  const title = isPrimary ? 'No se puede eliminar' : 'Eliminar dominio';
  const message = isPrimary
    ? `${hostname} es el dominio principal de la organización. Promueve otro dominio a principal antes de eliminarlo.`
    : `¿Eliminar ${hostname}? Esta acción no se puede deshacer. El certificado SSL asociado será revocado.`;

  return (
    <ConfirmDialog
      visible={visible}
      onClose={onClose}
      onConfirm={onConfirm}
      title={title}
      message={message}
      confirmLabel={isPrimary ? 'Entendido' : 'Eliminar'}
      cancelLabel="Cancelar"
      destructive={!isPrimary}
      loading={loading}
    />
  );
}