/**
 * QUI-657 — cola de plataforma para tramitar certificados de firma.
 *
 * Espeja el contrato del backend en
 * `apps/backend/src/domains/store/invoicing/dian-config/`. Si cambia allá,
 * cambia acá: no hay generación automática de tipos entre ambos lados.
 */

/** Estado del certificado EN NUESTRA MANO. Ortogonal al estado ante la DIAN. */
export type CertificateProvisioningStatus =
  | 'not_required'
  | 'documents_pending'
  | 'documents_submitted'
  | 'issuing'
  | 'issued'
  | 'rejected';

export type IdentityDocumentType = 'rut' | 'id' | 'certificate_of_existence';

export interface IdentityDocument {
  id: number;
  document_type: IdentityDocumentType | string;
  /** Etiqueta en español que ya viene resuelta del backend. */
  label: string;
  uploaded_at: string;
  original_filename: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_by_user_id: number | null;
}

/** Un documento con su URL firmada de vida corta ya emitida. */
export interface IdentityDocumentWithUrl extends IdentityDocument {
  download_url: string;
  expires_in_seconds: number;
}

/** Una fila de la cola: un expediente esperando trámite. */
export interface PendingCertificateRequest {
  id: number;
  organization_id: number;
  organization_name: string | null;
  store_id: number | null;
  store_name: string | null;
  name: string;
  nit: string;
  nit_dv: string | null;
  configuration_type: string;
  certificate_provisioning_status: CertificateProvisioningStatus;
  person_type: 'natural' | 'juridica';
  requested_at: string;
  documents: IdentityDocument[];
}
