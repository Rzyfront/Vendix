import { useState } from 'react';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { OrgDomainsService } from '@/features/org/services/org-domains.service';
import type { Domain, UpdateDomainInput } from '@/core/models/org-admin/domains.types';
import { DomainFormFields } from './domain-form-fields';

interface DomainEditModalProps {
  visible: boolean;
  domain: Domain | null;
  onClose: () => void;
  onUpdated?: (domain: Domain) => void;
}

/**
 * Modal "Editar dominio" para ORG_ADMIN Dominios.
 *
 * Wrapper sobre `DomainFormFields` con `initial={domain}`. El form ya
 * bloquea en modo edición los campos destructivos (hostname/root/ownership),
 * por lo que el payload de update solo lleva los editables
 * (`app_type`, `store_id`, `is_primary`, `subdomain`).
 */
export function DomainEditModal({ visible, domain, onClose, onUpdated }: DomainEditModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (input: UpdateDomainInput) => {
    if (!domain) return;
    setSubmitting(true);
    try {
      const updated = await OrgDomainsService.update(domain.hostname, input);
      onUpdated?.(updated);
      onClose();
    } catch {
      // La pantalla padre puede mostrar un toast si quiere reintentar.
    } finally {
      setSubmitting(false);
    }
  };

  if (!domain) return null;

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="full">
      <DomainFormFields
        initial={domain}
        submitting={submitting}
        onSubmit={handleSubmit as any}
        onCancel={onClose}
        submitLabel="Guardar cambios"
      />
    </BottomSheet>
  );
}
