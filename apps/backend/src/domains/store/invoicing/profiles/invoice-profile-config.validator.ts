import { ErrorCodes, VendixHttpException } from 'src/common/errors';

import {
  InvoiceProfileConfig,
  ProfileConfigIssue,
  blockingIssues,
  normalizeInvoiceProfileConfig,
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
  if (blockingIssues(issues).length === 0) return;
  // El primer problema va al mensaje porque es lo que se ve en un toast; la
  // lista completa viaja en `details` para que el editor marque cada campo. Si
  // sólo se enviara el primero, el usuario tendría que guardar una vez por error
  // para descubrir los siete que tiene.
  throw buildProfileConfigException(issues, options);
}

/**
 * Normaliza y valida en un solo paso, y devuelve el snapshot LISTO PARA
 * PERSISTIR. Es la única puerta por la que una configuración recibida del
 * cliente puede entrar a `invoice_profile_versions.config`.
 *
 * ## Por qué las dos mitades van juntas
 *
 * El DTO declara `config` como objeto sin `@ValidateNested` —si lo declarara,
 * `forbidNonWhitelisted` rechazaría el árbol entero de siete secciones—, así que
 * `class-validator` no mira NADA dentro. Persistir `dto.config` tal cual metería
 * claves arbitrarias en el `jsonb` de un registro fiscal que las facturas
 * timbradas referencian. Y normalizar sin validar guardaría una forma correcta
 * con valores ilegales.
 *
 * Los problemas de las dos mitades salen en UNA sola lista, en orden: primero
 * los estructurales (claves desconocidas, contenedores del tipo equivocado) y
 * luego los semánticos. El editor los pinta por `details.issues[].field` sin
 * saber de qué mitad vinieron.
 */
export function normalizeAndAssertProfileConfig(
  input: unknown,
  options: { operation_type: string; profile_id?: number | null },
): InvoiceProfileConfig {
  const { config, issues: structural } = normalizeInvoiceProfileConfig(input);
  const issues = [
    ...structural,
    ...validateInvoiceProfileConfig(config, options),
  ];
  // Se decide por los que BLOQUEAN, pero se envían TODOS: un aviso que no viaje
  // en `details.issues` es un aviso que el editor no puede mostrar.
  if (blockingIssues(issues).length > 0) {
    throw buildProfileConfigException(issues, options);
  }
  return config;
}

/**
 * Exportada para C.7: `invoicing.service.ts` la reusa cuando un documento se
 * aparta de la base gravable (`aiu_taxable_basis`) que declaró el perfil
 * congelado, para lanzar el MISMO `INVOICING_PROFILE_005` con el mismo
 * formato de `details` que el editor de perfiles — no un código nuevo para
 * el mismo problema.
 */
export function buildProfileConfigException(
  issues: ProfileConfigIssue[],
  options: { operation_type: string; profile_id?: number | null },
): VendixHttpException {
  return new VendixHttpException(
    ErrorCodes.INVOICING_PROFILE_005,
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
