import { ErrorCodes, VendixHttpException } from 'src/common/errors';

import {
  InvoiceProfileConfig,
  ProfileConfigIssue,
  validateInvoiceProfileConfig,
} from './invoice-profile-config.contract';

/**
 * Envoltura de Nest sobre la validación pura del snapshot.
 *
 * La separación no es ceremonia: `validateInvoiceProfileConfig` no puede
 * importar Nest porque el frontend espeja ese archivo byte a byte para validar
 * en vivo en el editor. Acá vive lo específico del runtime —traducir los
 * problemas a `INVOICING_PROFILE_005`— y allá la regla fiscal, que es la que no
 * puede divergir entre las dos superficies.
 */
export function assertValidInvoiceProfileConfig(
  config: InvoiceProfileConfig,
  options: { operation_type: string; profile_id?: number | null },
): void {
  const issues = validateInvoiceProfileConfig(config, options);
  if (issues.length === 0) return;

  throw new VendixHttpException(
    ErrorCodes.INVOICING_PROFILE_005,
    // El primer problema va al mensaje porque es lo que se ve en un toast; la
    // lista completa viaja en `details` para que el editor marque cada campo.
    // Si sólo se enviara el primero, el usuario tendría que guardar una vez por
    // error para descubrir los siete que tiene.
    buildSummary(issues),
    {
      ...(options.profile_id != null && { profile_id: options.profile_id }),
      operation_type: options.operation_type,
      issue_count: issues.length,
      issues,
    },
  );
}

function buildSummary(issues: ProfileConfigIssue[]): string {
  const [first] = issues;
  if (issues.length === 1) return first.message;
  return `${first.message} (y ${issues.length - 1} ${issues.length === 2 ? 'problema' : 'problemas'} más en la configuración del perfil).`;
}
