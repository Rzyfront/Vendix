import { useState } from 'react';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { OrgDomainsService } from '@/features/org/services/org-domains.service';
import type { CreateDomainInput, Domain } from '@/core/models/org-admin/domains.types';
import { DomainFormFields } from './domain-form-fields';

interface DomainCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (domain: Domain) => void;
}

/**
 * Modal "Nuevo dominio" para ORG_ADMIN Dominios.
 *
 * Espejo del `DomainCreateModalComponent` de la web — `OrgCenteredModal`
 * (NO `BottomSheet`) para mantener paridad con el modal centrado de la web.
 * Usa `DomainFormFields` con `hideHeader` (el modal provee title/subtitle)
 * y mantiene el footer interno del form (Cancelar + Crear dominio).
 */
export function DomainCreateModal({ visible, onClose, onCreated }: DomainCreateModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (input: CreateDomainInput) => {
    setSubmitting(true);
    setError(null);
    try {
      const domain = await OrgDomainsService.create(input);
      onCreated?.(domain);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo crear el dominio');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title="Nuevo dominio"
      subtitle="Registra un dominio para la organización o para una tienda específica"
      size="lg"
    >
      <DomainFormFields
        hideHeader
        submitting={submitting}
        onSubmit={handleSubmit}
        onCancel={onClose}
        submitLabel={error ? 'Reintentar' : 'Crear dominio'}
      />
    </OrgCenteredModal>
  );
}
