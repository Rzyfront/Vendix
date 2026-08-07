import {
  DIAN_DOCUMENT_TYPE_BY_NIT_TYPE,
  DIAN_PERSON_TYPE_BY_LABEL,
} from '../../../../common/helpers/organization-fiscal-columns.helper';
import { isVatResponsible } from '../../../../common/helpers/vat-responsibility.helper';
import { normalizeNit } from '../../../../common/utils/nit.util';
import { DianIssuerData } from '../providers/dian-direct/interfaces/dian-config.interface';

/**
 * Resolvedor ÚNICO de la identidad fiscal del emisor.
 *
 * POR QUÉ EXISTE — el defecto que cierra:
 *
 * La identidad fiscal del emisor vivía repartida en cuatro sitios que discrepaban:
 * `organization_settings.fiscal_data` con los datos reales del RUT, las columnas de
 * `organizations` y `accounting_entities` con datos de semilla, `dian_configurations`
 * con el NIT correcto, y el generador del set de pruebas con literales hardcodeados
 * que ignoraban todo lo anterior.
 *
 * El resultado medido: 50 documentos declararon el NIT de Quickss (902056589) con
 * `tax_regime = '49'` (NO responsable de IVA) mientras cobraban 19% de IVA en el
 * mismo documento, dirección de Bogotá cuando el RUT dice Riohacha, y
 * `TaxLevelCode = 'O-15'` (autorretenedor) cuando el RUT declara O-13 y O-47.
 *
 * `fiscal_data` ES LA FUENTE ÚNICA DE LA VERDAD. Las columnas son una proyección y
 * solo actúan como respaldo para tenants que aún no han vuelto a guardar su
 * identidad. Habilitación y producción consumen esta misma función para que no
 * puedan declarar cosas distintas sobre el mismo NIT — que es exactamente cómo se
 * produjo un 'O-15' en el set de pruebas y un 'O-13' en la emisión real.
 *
 * DOS CAMPOS SE DERIVAN Y NUNCA SE LEEN:
 *
 * - `nit_dv`: un DV almacenado que discrepe del módulo 11 es por definición
 *   incorrecto. En producción `organizations.tax_id` guardaba '900123456-7' cuando
 *   el DV real de 900123456 es 8, así que el valor almacenado nunca fue de un NIT
 *   real. Calcularlo hace imposible propagar esa clase de basura.
 * - `tax_regime`: sale de `isVatResponsible`, no de una columna. Un emisor que se
 *   declara no responsable de IVA facturando IVA es una contradicción interna del
 *   documento, y la columna almacenada es precisamente lo que puede quedar rancio.
 */
export interface FiscalIssuerSource {
  /** NIT de `dian_configurations` — respaldo si `fiscal_data.nit` está vacío. */
  nit: string;
  /** Razón social de `dian_configurations.name`. */
  config_name?: string | null;
  /** `organization_settings.settings.fiscal_data` o su equivalente de tienda. */
  fiscal_data?: Record<string, unknown> | null;
  entity?: { legal_name?: string | null; name?: string | null } | null;
  organization?: {
    legal_name?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    document_type?: string | null;
    person_type?: string | null;
    fiscal_responsibilities?: string[] | null;
  } | null;
  /** Fila de `addresses` con `type='billing'`; la dirección fiscal del RUT. */
  address?: {
    address_line1?: string | null;
    city?: string | null;
    state_province?: string | null;
    municipality_code?: string | null;
    postal_code?: string | null;
    phone_number?: string | null;
  } | null;
  /** Correo de contacto del documento. */
  email?: string | null;
}

/** Lee una clave de `fiscal_data` solo si es string no vacío. */
function str(source: Record<string, unknown> | null | undefined, key: string) {
  const value = source?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * `cbc:TaxLevelCode` lleva las RESPONSABILIDADES fiscales del emisor, separadas por
 * punto y coma cuando hay varias ('O-13;O-47').
 *
 * El respaldo es 'R-99-PN' («no aplica» del anexo) y NO una responsabilidad
 * concreta. El código anterior caía a 'O-15' (autorretenedor), que es afirmar ante
 * la DIAN una responsabilidad que el emisor puede no tener. Declarar «no aplica»
 * cuando no se sabe es honesto; declarar autorretenedor es una afirmación falsa.
 */
function resolveTaxLevelCode(
  fiscalData: Record<string, unknown> | null | undefined,
  columnResponsibilities: string[] | null | undefined,
): string {
  const fromFiscalData = Array.isArray(fiscalData?.tax_responsibilities)
    ? (fiscalData!.tax_responsibilities as unknown[]).filter(
        (code): code is string => typeof code === 'string' && !!code.trim(),
      )
    : [];
  if (fromFiscalData.length) return fromFiscalData.join(';');

  const fromColumns = (columnResponsibilities ?? []).filter(
    (code) => typeof code === 'string' && !!code.trim(),
  );
  if (fromColumns.length) return fromColumns.join(';');

  // Un `tax_scheme` singular en `fiscal_data` sigue siendo una responsabilidad
  // válida para tenants que solo guardaron ese campo.
  const single = str(fiscalData, 'tax_scheme');
  if (single) return single;

  return 'R-99-PN';
}

/**
 * Construye el emisor DIAN desde la fuente única de la verdad.
 *
 * @throws Error si no hay municipio DIAN resoluble. La DIAN valida la dirección
 * fiscal contra el RUT, así que emitir con un municipio inventado produce un
 * rechazo que cuesta un consecutivo autorizado irrecuperable. Fallar aquí es
 * estrictamente más barato.
 */
export function resolveIssuerFiscalIdentity(
  source: FiscalIssuerSource,
): DianIssuerData {
  const fiscalData = source.fiscal_data ?? null;

  const rawNit = str(fiscalData, 'nit') || str(fiscalData, 'tax_id') || source.nit;
  const { number: nit, dv } = normalizeNit(rawNit);

  const legal_name =
    str(fiscalData, 'legal_name') ||
    source.config_name?.trim() ||
    source.entity?.legal_name?.trim() ||
    source.organization?.legal_name?.trim() ||
    source.organization?.name?.trim() ||
    '';

  const municipality_code =
    str(fiscalData, 'municipality_code') ||
    source.address?.municipality_code?.trim();
  if (!municipality_code) {
    throw new Error(
      `No hay municipio DIAN para el NIT ${nit}: se necesita ` +
        `fiscal_data.municipality_code o una dirección con municipality_code.`,
    );
  }

  const address_line =
    str(fiscalData, 'fiscal_address') ||
    source.address?.address_line1?.trim() ||
    '';
  const city_name =
    str(fiscalData, 'city') || source.address?.city?.trim() || '';
  const department_name =
    str(fiscalData, 'department') ||
    source.address?.state_province?.trim() ||
    municipality_code.slice(0, 2);

  const nit_type = str(fiscalData, 'nit_type');
  const document_type =
    (nit_type && DIAN_DOCUMENT_TYPE_BY_NIT_TYPE[nit_type]) ||
    source.organization?.document_type?.trim() ||
    '31';

  const person_label = str(fiscalData, 'person_type');
  const person_type =
    (person_label && DIAN_PERSON_TYPE_BY_LABEL[person_label]) ||
    source.organization?.person_type?.trim() ||
    '1';

  return {
    document_type,
    nit,
    // Derivado, nunca leído: ver el bloque de documentación del archivo.
    nit_dv: dv,
    legal_name,
    trade_name: source.entity?.name?.trim() || undefined,
    address_line,
    city_code: municipality_code,
    city_name,
    department_code: municipality_code.slice(0, 2),
    department_name,
    country_code: str(fiscalData, 'country') || 'CO',
    postal_code: source.address?.postal_code?.trim() || undefined,
    phone:
      source.address?.phone_number?.trim() ||
      source.organization?.phone?.trim() ||
      undefined,
    email: source.email?.trim() || source.organization?.email?.trim() || '',
    // Derivado de las responsabilidades, nunca de una columna almacenada.
    tax_regime: isVatResponsible(fiscalData) ? '48' : '49',
    tax_scheme: resolveTaxLevelCode(
      fiscalData,
      source.organization?.fiscal_responsibilities,
    ),
    person_type,
  };
}
