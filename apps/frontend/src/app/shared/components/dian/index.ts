/**
 * Componentes DIAN COMPARTIDOS por las dos consolas.
 *
 * Todo lo que hay aquí lo monta tanto el panel del comerciante
 * (`private/modules/store/invoicing/`) como la consola de super admin
 * (`private/modules/super-admin/tenants/`). La diferencia entre ambas se expresa
 * SIEMPRE como capacidades leídas de `DIAN_API_CONTEXT`
 * (`shared/services/dian/`), nunca como un componente paralelo: un segundo
 * formulario de resolución sería un segundo sitio donde la regla de qué campo
 * aplica a qué documento puede quedarse atrás, y equivocarla gasta consecutivos
 * autorizados que no se recuperan.
 */

// Contrato de requisitos por tipo de documento (espejo del backend)
export {
  FISCAL_DOCUMENT_TYPES,
  DIAN_CONFIGURATION_TYPES,
  DIAN_CONFIGURATION_TYPE_LABELS,
  FISCAL_DOCUMENT_REQUIREMENTS,
  RESOLUTION_DOCUMENT_TYPES,
  isFiscalDocumentType,
  requirementsFor,
  configurationTypeFor,
  defaultDocumentTypeFor,
  documentTypesFor,
  requiresAuthorizedRange,
  acceptsTechnicalKey,
  resolutionDocumentTypesFor,
  validateResolutionDraft,
} from './fiscal-document-requirements';
export type {
  FiscalDocumentType,
  DianConfigurationType,
  FiscalKeyAlgorithm,
  FiscalDocumentRequirements,
  FiscalRequirementViolation,
  FiscalResolutionDraft,
} from './fiscal-document-requirements';

// Agregado de estado fiscal (espejo del backend)
export {
  isBlockingCheck,
  isActionableCheck,
  CERTIFICATE_EXPIRY_ALERT_DAYS,
  RESOLUTION_RANGE_WARNING_PERCENT,
  DIAN_ENABLEMENT_STATUS_LABELS,
  DIAN_ENVIRONMENT_LABELS,
} from './fiscal-readiness.interface';
export type {
  ProductionReadinessCheck,
  ProductionReadinessReport,
  FiscalReadinessResolution,
  FiscalReadinessAxis,
  FiscalReadinessResponse,
  DianEnablementStatus,
  DianCertificateState,
} from './fiscal-readiness.interface';

// Ambientes DIAN como opciones de selector (etiquetas derivadas del diccionario)
export {
  DIAN_ENVIRONMENTS,
  DIAN_ENVIRONMENT_OPTIONS,
  isDianEnvironment,
  dianEnvironmentLabel,
} from './dian-environment.constants';

// Lectura del checklist en sus tres registros
export { summarizeReadiness, warningDetail } from './readiness-summary.util';
export type { ReadinessSummary } from './readiness-summary.util';

// Componentes
export { DianDocumentTypeCardComponent } from './dian-document-type-card/dian-document-type-card.component';
export { DianCertificatePanelComponent } from './dian-certificate-panel/dian-certificate-panel.component';
export { DianTestSetPanelComponent } from './dian-test-set-panel/dian-test-set-panel.component';
export { DianNumberingRangePanelComponent } from './dian-numbering-range-panel/dian-numbering-range-panel.component';
export { DianResolutionFormComponent } from './dian-resolution-form/dian-resolution-form.component';
export type { DianResolutionFormValue } from './dian-resolution-form/dian-resolution-form.component';
