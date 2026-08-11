/**
 * RESOLVEDOR ÚNICO DE LA IDENTIDAD FISCAL DEL TENANT.
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
 * - `tax_regime` (columna): sale de `isVatResponsible`, no de una columna. Un
 *   emisor que se declara no responsable de IVA facturando IVA es una contradicción
 *   interna del documento, y la columna almacenada es precisamente lo que puede
 *   quedar rancio.
 *
 * EL CONTRATO ES ANCHO Y CRUDO: contiene la identidad en el vocabulario del RUT
 * (NIT, DV derivado, razón social, dirección, municipio, responsabilidades como
 * `O-13`, régimen COMUN/SIMPLIFICADO, tipo de persona `JURIDICA`). Los consumidores
 * DIAN proyectan este contrato a `DianIssuerData` con la traducción de vocabularios
 * (`NIT` → '31', `JURIDICA` → '1'); los consumidores no-DIAN (colillas, export
 * bancario, suscripciones) consumen este contrato directo sin traducir.
 */
import {
  DIAN_DOCUMENT_TYPE_BY_NIT_TYPE,
  DIAN_PERSON_TYPE_BY_LABEL,
} from './organization-fiscal-columns.helper';
import { isVatResponsible } from './vat-responsibility.helper';
import { normalizeNit } from '../utils/nit.util';

/**
 * Identidad fiscal cruda del tenant.
 *
 * Todos los campos están en el vocabulario del RUT/formulario fiscal — NIT sin DV
 * pegado, tipo `JURIDICA`/`NATURAL`, responsabilidades `O-13`, etc. — para que
 * cualquier consumidor (DIAN, colillas, export bancario) pueda traducir o no
 * según lo que necesite. NO incluye los códigos DIAN ya traducidos (`document_type`,
 * `person_type` en código, `tax_regime` '48'/'49'): esa traducción la hace el
 * adaptador DIAN a partir de este contrato.
 */
export interface TenantFiscalIdentity {
  /** NIT sin DV, normalizado (sin puntos ni guiones). */
  nit: string;
  /**
   * Dígito de verificación derivado por módulo 11. NUNCA leído de columnas ni
   * del JSON: si lo que está almacenado discrepa, el cálculo es la verdad.
   */
  nit_dv: string;
  /** Razón social — RUT del tenant. Lanzar si vacío, no devolver `''`. */
  legal_name: string;
  /** Dirección fiscal (RUT). Vacía si el tenant no la declaró. */
  fiscal_address: string;
  /** Municipio (catálogo DIAN). Lanzar si falta — clave para emitir. */
  municipality_code: string;
  /** Ciudad legible (RUT). Vacía si no declarada. */
  city: string;
  /**
   * Departamento legible (RUT). Lanzar si no se puede derivar — antes caía a
   * `municipality_code.slice(0,2)`, lo que ponía un código numérico en
   * `cbc:CountrySubentity`, campo de nombre.
   */
  department: string;
  /** Código ISO del país. Default 'CO'. */
  country: string;
  /** Código postal de la dirección fiscal. */
  postal_code?: string;
  /** Teléfono de contacto del documento. */
  phone?: string;
  /** Correo de contacto del documento. */
  email: string;
  /** Tipo de documento del NIT en vocabulario formulario: `NIT`, `CC`, `CE`, `TI`, `PP`, `NIT_EXTRANJERIA`. */
  nit_type?: string;
  /** Tipo de persona en vocabulario formulario: `JURIDICA`, `NATURAL`. */
  person_type?: string;
  /** Régimen tributario en vocabulario formulario: `COMUN`, `SIMPLIFICADO`. */
  tax_regime?: string;
  /** Responsabilidades fiscales crudas (`O-13`, `O-47`, etc.). Vacío = sin responsabilidades declaradas. */
  tax_responsibilities: string[];
  /** Responsabilidad singular — fallback para tenants que solo guardaron este campo. */
  tax_scheme?: string;
  /** Código CIIU de actividad económica. */
  ciiu_code?: string;
}

/**
 * Fuente desde la que se resuelve la identidad fiscal.
 *
 * El resolvedor decide precedencias — `fiscal_data` gana sobre columnas y sobre
 * `addresses` — así que ningún consumidor decide eso por su cuenta.
 */
export interface FiscalIdentitySource {
  /** NIT de `dian_configurations` — respaldo si `fiscal_data.nit` está vacío. */
  nit: string;
  /** Razón social de `dian_configurations.name`. */
  config_name?: string | null;
  /** `organization_settings.settings.fiscal_data` o su equivalente de tienda. */
  fiscal_data?: Record<string, unknown> | null;
  /** Fila de la entidad contable (`accounting_entities`). */
  entity?: { legal_name?: string | null; name?: string | null } | null;
  /** Fila de `organizations` con campos de respaldo. */
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

/** Une un código de responsabilidad singular con el array, deduplicando. */
function resolveResponsibilities(
  fiscalData: Record<string, unknown> | null | undefined,
  columnResponsibilities: string[] | null | undefined,
): string[] {
  const fromFiscalData = Array.isArray(fiscalData?.tax_responsibilities)
    ? (fiscalData!.tax_responsibilities as unknown[]).filter(
        (code): code is string => typeof code === 'string' && !!code.trim(),
      )
    : [];
  if (fromFiscalData.length) return fromFiscalData;

  const fromColumns = (columnResponsibilities ?? []).filter(
    (code) => typeof code === 'string' && !!code.trim(),
  );
  if (fromColumns.length) return fromColumns;

  const single = str(fiscalData, 'tax_scheme');
  return single ? [single] : [];
}

/**
 * Campos obligatorios para EMITIR que el resolvedor no pudo resolver.
 *
 * `municipality_code` y `department` alimentan `cac:RegistrationAddress`, y
 * `legal_name` alimenta `cbc:RegistrationName`: los tres son obligatorios en el
 * documento electrónico y la DIAN los confronta contra el RUT del NIT.
 */
export type MissingFiscalField =
  | 'legal_name'
  | 'municipality_code'
  | 'department';

/** Resultado del resolvedor permisivo: identidad parcial + qué falta para emitir. */
export interface PartialFiscalIdentity {
  /**
   * Identidad con lo que sí se pudo resolver. Los campos listados en `missing`
   * llegan como `''` — leerlos sin consultar `missing` es el error que este
   * contrato existe para hacer visible.
   */
  identity: TenantFiscalIdentity;
  /** Vacío ⇒ la identidad está completa y es apta para emitir. */
  missing: MissingFiscalField[];
}

/**
 * Núcleo compartido. NO lanza: resuelve lo que puede y reporta lo que falta.
 *
 * Los dos resolvedores públicos son proyecciones de esta función, así que ambos
 * deciden las MISMAS precedencias. Lo único que los diferencia es qué hacen ante
 * un campo obligatorio ausente — ver `resolveTenantFiscalIdentity` (lanza) y
 * `tryResolveTenantFiscalIdentity` (reporta).
 */
function buildFiscalIdentity(
  source: FiscalIdentitySource,
): PartialFiscalIdentity {
  const fiscalData = source.fiscal_data ?? null;
  const missing: MissingFiscalField[] = [];

  const rawNit = str(fiscalData, 'nit') || str(fiscalData, 'tax_id') || source.nit;
  const { number: nit, dv } = normalizeNit(rawNit);

  const legal_name =
    str(fiscalData, 'legal_name') ||
    source.config_name?.trim() ||
    source.entity?.legal_name?.trim() ||
    source.organization?.legal_name?.trim() ||
    source.organization?.name?.trim();
  if (!legal_name) missing.push('legal_name');

  const municipality_code =
    str(fiscalData, 'municipality_code') ||
    source.address?.municipality_code?.trim();
  if (!municipality_code) missing.push('municipality_code');

  const fiscal_address =
    str(fiscalData, 'fiscal_address') ||
    source.address?.address_line1?.trim() ||
    '';
  const city = str(fiscalData, 'city') || source.address?.city?.trim() || '';

  const department =
    str(fiscalData, 'department') || source.address?.state_province?.trim();
  if (!department) missing.push('department');

  return {
    missing,
    identity: {
      nit,
      nit_dv: dv,
      legal_name: legal_name ?? '',
      fiscal_address,
      municipality_code: municipality_code ?? '',
      city,
      department: department ?? '',
      country: str(fiscalData, 'country') || 'CO',
      postal_code: source.address?.postal_code?.trim() || undefined,
      phone:
        source.address?.phone_number?.trim() ||
        source.organization?.phone?.trim() ||
        undefined,
      email: source.email?.trim() || source.organization?.email?.trim() || '',
      nit_type: str(fiscalData, 'nit_type'),
      person_type: str(fiscalData, 'person_type'),
      tax_regime: str(fiscalData, 'tax_regime'),
      tax_responsibilities: resolveResponsibilities(
        fiscalData,
        source.organization?.fiscal_responsibilities,
      ),
      tax_scheme: str(fiscalData, 'tax_scheme'),
      ciiu_code: str(fiscalData, 'ciiu') || str(fiscalData, 'ciiu_code'),
    },
  };
}

/**
 * Resolvedor ESTRICTO — para superficies que EMITEN.
 *
 * Úsalo cuando el dato sale del sistema hacia un tercero: XML de la DIAN, colilla
 * de nómina, archivo bancario, PDF de factura. Un dato fiscal inventado en esos
 * documentos es una afirmación legal falsa, y ante la DIAN un rechazo por dato del
 * emisor cuesta un consecutivo autorizado irrecuperable. Lanzar antes de emitir no
 * cuesta nada.
 *
 * NO lo uses en superficies de LECTURA o EDICIÓN — usa
 * `tryResolveTenantFiscalIdentity`. Ver la nota de asimetría más abajo.
 *
 * @throws Error si `legal_name`, `municipality_code` o `department` son
 *   irresolubles, en ese orden de precedencia.
 */
export function resolveTenantFiscalIdentity(
  source: FiscalIdentitySource,
): TenantFiscalIdentity {
  const { identity, missing } = buildFiscalIdentity(source);
  const nit = identity.nit;

  if (missing.includes('legal_name')) {
    throw new Error(
      `No hay razón social para el NIT ${nit}: se necesita ` +
        `fiscal_data.legal_name, config_name o la fila de la organización.`,
    );
  }
  if (missing.includes('municipality_code')) {
    throw new Error(
      `No hay municipio DIAN para el NIT ${nit}: se necesita ` +
        `fiscal_data.municipality_code o una dirección con municipality_code.`,
    );
  }
  if (missing.includes('department')) {
    throw new Error(
      `No hay departamento para el NIT ${nit}: se necesita ` +
        `fiscal_data.department o la columna state_province de la dirección. ` +
        `Derivar de municipality_code.slice(0,2) produciría un código numérico ` +
        `en cbc:CountrySubentity, campo de nombre.`,
    );
  }

  return identity;
}

/**
 * Resolvedor PERMISIVO — para superficies que MUESTRAN o EDITAN.
 *
 * ASIMETRÍA LECTURA/EMISIÓN — por qué existen dos y no uno:
 *
 * `vendix-fiscal-scope` § «Predicate Default Rules» ya establece la regla para los
 * predicados fiscales: el default correcto ante datos indeterminados depende de lo
 * que el predicado gobierna, y **nunca se voltea el default de un predicado
 * compartido — se deriva uno nuevo**. Esta función es ese predicado derivado.
 *
 * El checklist fiscal (`fiscal-status.service.ts`) y la sección fiscal del checkout
 * (`subscription-billing-profile.service.ts`) existen precisamente para que el
 * tenant VEA y CORRIJA lo que le falta. Si lanzan cuando falta un dato, el tenant
 * recibe un error en vez de la lista de lo que debe llenar, y no puede cargar su
 * identidad fiscal porque leerla revienta — huevo y gallina. El defecto llegó a
 * producción en ambas superficies al eliminar sus try/catch de forma uniforme.
 *
 * Devuelve `missing` para que la superficie decida: mostrar el hueco, deshabilitar
 * el candado, o bloquear la emisión. Lo que NO debe hacer es leer un campo de
 * `identity` sin haber consultado `missing`.
 */
export function tryResolveTenantFiscalIdentity(
  source: FiscalIdentitySource,
): PartialFiscalIdentity {
  return buildFiscalIdentity(source);
}

/**
 * Proyecta el contrato ancho de identidad fiscal a `DianIssuerData` con los
 * vocabularios DIAN ya traducidos.
 *
 * Es la única traducción DIAN que existe: vive aquí y solo aquí. Los consumidores
 * DIAN (`dian-direct.provider.ts`, `dian-payroll.provider.ts`, `invoice-pdf.service.ts`,
 * `dian-test.service.ts`) consumen este resultado; los consumidores no-DIAN
 * consumen `TenantFiscalIdentity` directo sin pasar por aquí.
 *
 * @throws Error si la proyección requiere datos que `TenantFiscalIdentity` no
 *   pudo resolver (delegación: ya lanzó antes en `resolveTenantFiscalIdentity`).
 */
export function projectTenantIdentityToDian(
  identity: TenantFiscalIdentity,
): {
  document_type: string;
  trade_name?: string;
  address_line: string;
  city_code: string;
  city_name: string;
  department_code: string;
  department_name: string;
  country_code: string;
  tax_regime: '48' | '49';
  tax_scheme: string;
  person_type: string;
} {
  return {
    document_type:
      (identity.nit_type && DIAN_DOCUMENT_TYPE_BY_NIT_TYPE[identity.nit_type]) ||
      '31',
    address_line: identity.fiscal_address,
    city_code: identity.municipality_code,
    city_name: identity.city,
    department_code: identity.municipality_code.slice(0, 2),
    department_name: identity.department,
    country_code: identity.country,
    tax_regime: isVatResponsible(identity) ? '48' : '49',
    tax_scheme: identity.tax_responsibilities.join(';') || 'R-99-PN',
    person_type:
      (identity.person_type &&
        DIAN_PERSON_TYPE_BY_LABEL[identity.person_type.toUpperCase()]) ||
      '1',
  };
}
