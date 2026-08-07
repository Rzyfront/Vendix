import {
  resolveTenantFiscalIdentity,
  projectTenantIdentityToDian,
  FiscalIdentitySource,
} from '../../../../common/helpers/fiscal-identity.helper';
import { DianIssuerData } from '../providers/dian-direct/interfaces/dian-config.interface';

/**
 * ADAPTADOR DIAN sobre el resolvedor único de identidad fiscal.
 *
 * Por qué es un adaptador y no el resolvedor principal: el resto del backend
 * necesita la identidad en el vocabulario crudo del RUT (`NIT`, `O-13`,
 * `JURIDICA`). La traducción al vocabulario DIAN (`'31'`, `'O-13;O-47'`, `'1'`,
 * `'48'`/`'49'`) es un detalle de la capa de emisión y vive aquí, no en el
 * resolvedor común.
 *
 * Habilitación (`dian-test.service.ts`) y producción consumen esta misma función,
 * así que no pueden volver a declarar cosas distintas sobre el mismo NIT — que es
 * exactamente cómo se produjo un 'O-15' en el set de pruebas y un 'O-13' en la
 * emisión real antes del release `7098f6e3c`.
 */
export interface FiscalIssuerSource extends FiscalIdentitySource {
  /**
   * Fila de la entidad contable (`accounting_entities`). Se mantiene en este
   * adaptador — no en el resolvedor común — porque solo se usa para `trade_name`
   * y nombre comercial, conceptos del documento DIAN.
   */
  entity?: { legal_name?: string | null; name?: string | null } | null;
}

/**
 * Construye el emisor DIAN desde la fuente única de la verdad.
 *
 * @throws Error si no hay municipio DIAN, razón social o departamento resoluble
 *   (delegado al resolvedor común).
 */
export function resolveIssuerFiscalIdentity(
  source: FiscalIssuerSource,
): DianIssuerData {
  const identity = resolveTenantFiscalIdentity(source);
  const dianProjection = projectTenantIdentityToDian(identity);

  return {
    document_type: dianProjection.document_type,
    nit: identity.nit,
    // Derivado, nunca leído: ver el bloque de documentación del resolvedor.
    nit_dv: identity.nit_dv,
    legal_name: identity.legal_name,
    trade_name: source.entity?.name?.trim() || undefined,
    address_line: dianProjection.address_line,
    city_code: dianProjection.city_code,
    city_name: dianProjection.city_name,
    department_code: dianProjection.department_code,
    department_name: dianProjection.department_name,
    country_code: dianProjection.country_code,
    postal_code: identity.postal_code,
    phone: identity.phone,
    email: identity.email,
    // Derivado de las responsabilidades, nunca de una columna almacenada.
    tax_regime: dianProjection.tax_regime,
    tax_scheme: dianProjection.tax_scheme,
    person_type: dianProjection.person_type,
  };
}
