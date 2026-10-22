import type { FiscalReadinessAxis } from '../../../../../../shared/components/dian/fiscal-readiness.interface';
import type { DianConfig } from '../../interfaces/invoice.interface';

export type ActivationStepId =
  | 'company'
  | 'software'
  | 'certificate'
  | 'testing'
  | 'production_ranges'
  | 'promote';

export const ACTIVATION_STEPS: readonly {
  id: ActivationStepId;
  index: number;
  label: string;
  description: string;
}[] = [
  {
    id: 'company',
    index: 1,
    label: 'Empresa que factura',
    description: 'Datos legales y fiscales de quien emite las facturas.',
  },
  {
    id: 'software',
    index: 2,
    label: 'Software',
    description: 'Identificador, PIN y set de pruebas del software ante la DIAN.',
  },
  {
    id: 'certificate',
    index: 3,
    label: 'Certificado',
    description: 'Certificado digital con el que se firman los documentos.',
  },
  {
    id: 'testing',
    index: 4,
    label: 'Entorno de pruebas',
    description: 'Envío y aprobación del set de pruebas de habilitación.',
  },
  {
    id: 'production_ranges',
    index: 5,
    label: 'Resoluciones de producción',
    description: 'Rangos de numeración autorizados para facturar de verdad.',
  },
  {
    id: 'promote',
    index: 6,
    label: 'Pasar a producción',
    description: 'Activar la facturación electrónica real.',
  },
];

export type ActivationScope = 'store' | 'organization';

export interface ActivationSnapshot {
  /** De satisfied_steps del prefill del asistente fiscal ('legal_data'). */
  legalDataComplete: boolean;
  /** Eje 'sales_invoice' de GET fiscal-readiness. */
  axis: FiscalReadinessAxis | null;
  /** GET dian-config/:id del eje (null si no hay config). */
  config: DianConfig | null;
}

export interface ActivationContext extends ActivationSnapshot {
  scope: ActivationScope;
  /** P. ej. tienda con fiscal_scope=ORGANIZATION. */
  readOnly: boolean;
  readOnlyReason: string | null;
}

export type ActivationOverallState = 'in_progress' | 'completed';
