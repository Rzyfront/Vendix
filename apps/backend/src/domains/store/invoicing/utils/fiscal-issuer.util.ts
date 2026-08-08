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
 *
 * KILL SWITCH: la variable de entorno `FISCAL_IDENTITY_LEGACY_MODE=true`
 * restablece la cascada anterior (pre-resolvedor). El flag se lee POR LLAMADA,
 * no en el ámbito del módulo, para que un `docker restart` baste y no haga falta
 * reconstruir la imagen. Es kill switch global de emergencia, no feature flag
 * por tenant — solo para abortar el rollout del paso 4 del plan de SSOT.
 * El flag y la cascada antigua se eliminan en el paso 7.
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
  if (isLegacyMode()) {
    return legacyCascade(source);
  }
  return resolvedorPath(source);
}

function resolvedorPath(source: FiscalIssuerSource): DianIssuerData {
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

/**
 * Lee el flag por llamada (no en módulo) para que un `docker restart` del
 * contenedor baste — no hace falta reconstruir la imagen.
 */
function isLegacyMode(): boolean {
  return process.env.FISCAL_IDENTITY_LEGACY_MODE === 'true';
}

/**
 * CASCADA LEGACY — preserva el comportamiento anterior al paso 4 del plan de
 * SSOT. Solo se activa vía `FISCAL_IDENTITY_LEGACY_MODE=true`. Mantenerla aquí
 * (no en una rama de git) garantiza que el rollback puede ocurrir sin
 * checkout, sin deploy, y sin rebuildear la imagen.
 *
 * Defectos que ESTA cascada conserva (y por los que el plan la reemplaza):
 *   - `tax_scheme` por defecto es 'O-15' (autorretenedor) en vez de 'R-99-PN'.
 *   - `tax_regime` se mapea por string ('COMUN'/'SIMPLIFICADO'), no por
 *     `isVatResponsible`, así que un `tax_regime: ''` produce '48' por default
 *     en vez de derivarse de las responsabilidades.
 *   - `department_name` cae a `municipality_code.slice(0,2)` cuando
 *     `state_province` está vacío (devuelve un código numérico en
 *     `cbc:CountrySubentity`, campo de nombre).
 */
function legacyCascade(source: FiscalIssuerSource): DianIssuerData {
  const fiscalData = source.fiscal_data ?? null;

  const rawNit =
    (typeof fiscalData?.nit === 'string' && fiscalData.nit.trim()) ||
    (typeof fiscalData?.tax_id === 'string' && fiscalData.tax_id.trim()) ||
    source.nit;
  const nit = String(rawNit ?? '').replace(/[^\d]/g, '') || '0';
  const nit_dv =
    (typeof fiscalData?.nit_dv === 'string' && fiscalData.nit_dv.trim()) ||
    (typeof fiscalData?.tax_id_dv === 'string' && fiscalData.tax_id_dv.trim()) ||
    '0';

  const legal_name =
    (typeof fiscalData?.legal_name === 'string' && fiscalData.legal_name.trim()) ||
    source.config_name?.trim() ||
    source.entity?.legal_name?.trim() ||
    source.organization?.legal_name?.trim() ||
    source.organization?.name?.trim() ||
    '';

  const municipality_code =
    (typeof fiscalData?.municipality_code === 'string' &&
      fiscalData.municipality_code.trim()) ||
    source.address?.municipality_code?.trim() ||
    '';

  const address_line =
    (typeof fiscalData?.fiscal_address === 'string' &&
      fiscalData.fiscal_address.trim()) ||
    source.address?.address_line1?.trim() ||
    '';

  const city_name =
    (typeof fiscalData?.city === 'string' && fiscalData.city.trim()) ||
    source.address?.city?.trim() ||
    '';

  const department_name =
    (typeof fiscalData?.department === 'string' && fiscalData.department.trim()) ||
    source.address?.state_province?.trim() ||
    municipality_code.slice(0, 2);

  const nit_type =
    typeof fiscalData?.nit_type === 'string' ? fiscalData.nit_type.trim() : '';
  const document_type =
    (nit_type === 'NIT' && '31') ||
    (nit_type === 'CC' && '13') ||
    (nit_type === 'CE' && '22') ||
    (nit_type === 'TI' && '12') ||
    (nit_type === 'PP' && '41') ||
    (nit_type === 'NIT_EXTRANJERIA' && '50') ||
    source.organization?.document_type?.trim() ||
    '31';

  const person_label =
    typeof fiscalData?.person_type === 'string'
      ? fiscalData.person_type.trim()
      : '';
  const person_type =
    (person_label.toUpperCase() === 'JURIDICA' && '1') ||
    (person_label.toUpperCase() === 'NATURAL' && '2') ||
    source.organization?.person_type?.trim() ||
    '1';

  const regime =
    typeof fiscalData?.tax_regime === 'string'
      ? fiscalData.tax_regime.trim().toUpperCase()
      : '';
  const tax_regime =
    regime === 'SIMPLIFICADO' ? '49' : '48'; // default '48' como la original

  const tax_scheme =
    (typeof fiscalData?.tax_scheme === 'string' && fiscalData.tax_scheme.trim()) ||
    'O-15';

  return {
    document_type,
    nit,
    nit_dv,
    legal_name,
    trade_name: source.entity?.name?.trim() || undefined,
    address_line,
    city_code: municipality_code,
    city_name,
    department_code: municipality_code.slice(0, 2),
    department_name,
    country_code:
      (typeof fiscalData?.country === 'string' &&
        fiscalData.country.trim()) ||
      'CO',
    postal_code: source.address?.postal_code?.trim() || undefined,
    phone:
      source.address?.phone_number?.trim() ||
      source.organization?.phone?.trim() ||
      undefined,
    email: source.email?.trim() || source.organization?.email?.trim() || '',
    tax_regime,
    tax_scheme,
    person_type,
  };
}
