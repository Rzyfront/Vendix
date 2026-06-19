import { useState } from 'react';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
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
 * Wrapper sobre `DomainFormFields` (sin `initial`). Submit llama a
 * `OrgDomainsService.create()` y propaga el `Domain` resultante al padre
 * para que lo añada al estado de la lista sin re-fetch.
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
    <BottomSheet visible={visible} onClose={onClose} snapPoint="full">
      <DomainFormFields
        submitting={submitting}
        onSubmit={handleSubmit}
        onCancel={onClose}
        submitLabel={error ? 'Reintentar' : 'Crear dominio'}
        // error no se pasa explícitamente; DomainFormFields solo controla
        // la validación inline. El error de submit se renderiza en la
        // pantalla padre si fuera necesario (futuro).
      />
    </BottomSheet>
  );
}
