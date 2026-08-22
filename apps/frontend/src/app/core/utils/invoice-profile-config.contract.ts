/**
 * Forma del snapshot de configuración de un perfil de facturación.
 *
 * ## Qué es este archivo y qué NO es
 *
 * Es el contrato de `invoice_profile_versions.config`, la columna JSON que una
 * factura timbrada congela por `(profile_id, profile_version)`. No es una
 * preferencia de interfaz: es **la configuración con la que se calculó un
 * documento fiscal**, y por eso su forma se versiona y se valida.
 *
 * Un campo que falte aquí obliga a la emisión a leer configuración VIVA, que es
 * el defecto que el snapshot existe para cerrar: entre la captura y la
 * transmisión pueden pasar días, y en el intervalo la tienda pudo cambiar el
 * régimen. Un documento construido con la configuración de hoy y los importes de
 * la semana pasada declara una gravabilidad que contradice sus propios números.
 *
 * ## Por qué es agnóstico del runtime
 *
 * Este archivo NO importa Prisma, Nest ni Angular, y sus decimales son
 * `string`. Dos razones:
 *
 * 1. El editor del frontend tiene que validar los mismos porcentajes que el
 *    backend rechaza. Si la validación viviera sólo en el backend, el frontend
 *    la duplicaría y las dos copias divergirían — que es literalmente el bug que
 *    originó la unificación de la política de contraseñas
 *    (`common/validators/password-policy.ts` y su spec de paridad).
 * 2. `libs/shared-types` sólo publica declaraciones y no tiene mapeo de rutas en
 *    ningún `tsconfig`, así que no hay paquete compartido EJECUTABLE entre Nest
 *    y Angular. El patrón del repo es espejo + spec de paridad, no import.
 *
 * ## Por qué los porcentajes son `string` y no `number`
 *
 * Porque tienen que sumar **exactamente** 100. Un `number` mete error binario en
 * la suma: `33.33 + 33.33 + 33.34` no da `100` en punto flotante IEEE-754. El
 * parseo de abajo convierte a entero escalado (centésimas) y compara enteros, lo
 * que es exacto y no depende de ninguna librería de decimales.
 */

// ─── Constantes fiscales ──────────────────────────────────────────────────

/**
 * Versión de la FORMA de este objeto, no del perfil.
 *
 * `invoice_profile_versions.version` cuenta las ediciones del usuario; esto
 * cuenta los cambios de esquema del snapshot. Sin este número, migrar la forma
 * dejaría snapshots viejos indistinguibles de snapshots nuevos incompletos, y
 * una factura de hace un año no se podría reproducir.
 */
export const INVOICE_PROFILE_CONFIG_VERSION = 1;

/**
 * Piso legal del AIU en centésimas: 10,00 % del valor del contrato
 * (E.T. art. 462-1).
 *
 * Se duplica el número que `DEFAULT_AIU_MINIMUM_PERCENT` ya declara como
 * `Prisma.Decimal` en `services/invoice-calculator.service.ts:88`, porque ese
 * archivo importa Prisma y este no puede. La divergencia la impide un test, no
 * la buena voluntad: ver `invoice-profile-config.contract.spec.ts`.
 */
export const AIU_LEGAL_FLOOR_PERCENT_SCALED = 1000;

/** Escala de los porcentajes: dos decimales, como los `cbc:Percent` del anexo. */
export const PERCENT_SCALE = 2;

/** 100,00 % en centésimas. */
export const PERCENT_TOTAL_SCALED = 10000;

// ─── Uniones ──────────────────────────────────────────────────────────────

/**
 * Régimen de IVA del contrato AIU. Espejo de `AiuVatRegime`
 * (`domains/store/settings/interfaces/store-settings.interface.ts:341`).
 *
 * · `et_462_1` — base gravable = A + I + U, con piso del 10 % del contrato.
 * · `decreto_1372_1992` — base gravable = **sólo la Utilidad**; administración e
 *   imprevistos quedan fuera del IVA, y no hay piso.
 */
export type AiuVatRegimeLiteral = 'et_462_1' | 'decreto_1372_1992';

/** Componentes del AIU. Espejo del enum de Prisma `aiu_component_enum`. */
export type AiuComponentLiteral = 'administracion' | 'imprevistos' | 'utilidad';

/**
 * Porción de costo reembolsable del contrato: entra en el VALOR del contrato
 * —y por tanto mueve el piso legal— pero no forma parte de la base gravable
 * bajo ninguno de los dos regímenes. Eso es lo que distingue un contrato AIU de
 * una venta ordinaria.
 */
export type AiuBucket = AiuComponentLiteral | 'costo';

export const AIU_COMPONENTS: readonly AiuComponentLiteral[] = [
  'administracion',
  'imprevistos',
  'utilidad',
];

export const AIU_BUCKETS: readonly AiuBucket[] = [...AIU_COMPONENTS, 'costo'];

/**
 * Componentes cuya suma ENTRA en la base gravable, por régimen.
 *
 * Es la tabla que decide si la matriz de impuestos del perfil se contradice con
 * su propio régimen. La contradicción es el fallo que este plan entero existe
 * para cortar: el régimen decide qué línea emite `cac:TaxTotal` y los importes
 * salen de los tributos persistidos, así que si las dos mitades salen de
 * regímenes distintos el XML declara una gravabilidad que contradice sus propios
 * números → rechazo FAU04 con el consecutivo ya quemado.
 */
export const AIU_TAXABLE_COMPONENTS_BY_REGIME: Readonly<
  Record<AiuVatRegimeLiteral, readonly AiuComponentLiteral[]>
> = {
  et_462_1: ['administracion', 'imprevistos', 'utilidad'],
  decreto_1372_1992: ['utilidad'],
};

// ─── Las 7 secciones del editor ───────────────────────────────────────────

/**
 * Sección 1 — Datos generales.
 *
 * NO repite `name`, `operation_type`, `state` ni `is_default`: esos son COLUMNAS
 * de `invoice_profiles`. Duplicarlos dentro del JSON crearía dos fuentes de
 * verdad que pueden divergir, y la de la columna es la que los índices y el
 * único-predeterminado-por-tipo hacen cumplir. Aquí va sólo lo que no es
 * columna.
 */
export interface ProfileGeneralConfig {
  /** Descripción libre para el operador. No viaja al XML. */
  description?: string | null;
  /** Nota interna: por qué existe este perfil. Auditoría humana. */
  internal_note?: string | null;
}

/**
 * Sección 2 — AIU.
 *
 * `null` cuando el perfil no es de operación `'09'`. No es opcional por
 * comodidad: un perfil estándar con una sección AIU a medias es un perfil que
 * podría emitir un documento AIU sin darse cuenta.
 */
export interface ProfileAiuConfig {
  regime: AiuVatRegimeLiteral;
  /**
   * Objeto del contrato por omisión, que se concatena al prefijo obligatorio en
   * el `cbc:Note` de la línea de Administración (regla CAV03). La factura puede
   * pisarlo con el suyo; el perfil sólo aporta el valor por omisión.
   */
  contract_object: string;
  /**
   * Aplica el piso legal. **Explícitamente booleano, nunca `undefined`.**
   *
   * En `store_settings.invoicing.aiu` la ausencia significa «activo», y esa
   * ambigüedad ya obligó a escribir `settings.enforce_minimum_base === false`
   * en la emisión para no leer el NULL como «sin piso». Un snapshot no puede
   * heredar esa trampa: aquí el valor está siempre presente.
   */
  enforce_minimum_base: boolean;
  /** Porcentaje del piso, como decimal en cadena. `'10.00'` es el legal. */
  minimum_base_percent: string;
  /**
   * Reparto por omisión del AIU. Deben sumar exactamente `'100.00'`.
   * Son porcentajes del AIU, no del contrato: el costo reembolsable va aparte.
   */
  components: Readonly<Record<AiuComponentLiteral, string>>;
}

/**
 * Sección 3 — Cuentas PUC.
 *
 * Códigos de cuenta como cadenas, no ids: el plan de cuentas es por tenant y un
 * id no significa nada fuera de él. Que la cuenta EXISTA no se puede validar en
 * este archivo —haría falta el plan de cuentas del tenant— así que se valida al
 * usarla, contra `chart_of_accounts`. Aquí sólo se valida la forma.
 */
export interface ProfileAccountingConfig {
  /** Cuenta de ingreso por componente. */
  revenue_account_by_bucket?: Partial<Record<AiuBucket, string>> | null;
  /** IVA generado (típicamente 240802 en el PUC colombiano). */
  vat_payable_account?: string | null;
  /** Sobrescrituras de `mapping_key` → código de cuenta. */
  mapping_key_overrides?: Readonly<Record<string, string>> | null;
}

/**
 * Una regla de la matriz de gravabilidad.
 *
 * **Es la razón de ser de la feature.** `InvoiceCalculatorService` sabe QUÉ
 * componentes son gravables —lo deriva del régimen— pero no A QUÉ TARIFA: la
 * tarifa depende del bien o servicio y no hay catálogo del que deducirla. Por
 * eso no podía imponer el impuesto de una línea gravable que llegara sin
 * declarar, y por eso una factura podía nacer sub-declarada. Esta regla es la
 * tarifa que faltaba.
 */
export interface ProfileTaxRule {
  bucket: AiuBucket;
  /** Si esta porción entra en la base gravable del documento. */
  taxable: boolean;
  /**
   * Código de tributo de la tabla 13.2.2 del anexo (`cac:TaxScheme/cbc:ID`).
   * `'01'` IVA, `'04'` INC, etc. Ver `DIAN_TAX_CODES`.
   */
  tax_code: string;
  /**
   * Tarifa para `cac:TaxCategory/cbc:Percent`, como decimal en cadena.
   *
   * `'0.00'` con `taxable: true` es LEGÍTIMO y distinto de no declarar: un
   * servicio exento declara su grupo con `Percent` en cero. Confundir los dos
   * casos bloquearía facturas correctas.
   */
  rate: string;
}

/** Sección 4 — Base de impuestos. */
export interface ProfileTaxConfig {
  rules: readonly ProfileTaxRule[];
}

/** Sección 5 — Líneas modelo. */
export interface ProfileModelLine {
  bucket: AiuBucket;
  description: string;
  /** Código de unidad UBL (`cbc:InvoicedQuantity/@unitCode`), p. ej. `'94'`. */
  unit_code?: string | null;
  /** Cantidad por omisión, decimal en cadena. */
  quantity?: string | null;
}

/** Sección 6 — Formato de impresión y presentación. */
export interface ProfileFormatConfig {
  /** Clave de plantilla de `default_templates`. */
  template_key?: string | null;
  /** Imprimir el desglose A/I/U en el documento humano. */
  show_aiu_breakdown: boolean;
  /** Decimales mostrados al operador. No afecta al XML. */
  display_decimals: number;
}

/**
 * Sección 7 — Metadata DIAN.
 *
 * `customization_id` NO se repite: es `invoice_profiles.operation_type`, que ya
 * es columna. Aquí va lo que la acompaña.
 */
export interface ProfileDianConfig {
  /** Medio de pago por omisión (`cbc:PaymentMeansCode`). */
  payment_means_code?: string | null;
  /** Método de pago por omisión (`cbc:PaymentMeansID`). */
  payment_method_code?: string | null;
  /** Notas fijas que se anexan al documento (`cbc:Note` de cabecera). */
  header_notes?: readonly string[] | null;
}

/** El snapshot completo. Las 7 secciones, todas presentes. */
export interface InvoiceProfileConfig {
  config_version: number;
  general: ProfileGeneralConfig;
  /** `null` cuando el perfil no es de operación AIU (`'09'`). */
  aiu: ProfileAiuConfig | null;
  accounting: ProfileAccountingConfig;
  taxes: ProfileTaxConfig;
  model_lines: readonly ProfileModelLine[];
  format: ProfileFormatConfig;
  dian: ProfileDianConfig;
}

// ─── Aritmética exacta de porcentajes ─────────────────────────────────────

/**
 * `'19.00'` → `1900`. `null` si la cadena no es un porcentaje válido.
 *
 * Entero escalado a centésimas para que las sumas sean EXACTAS. Rechaza más de
 * dos decimales a propósito: el `cbc:Percent` del anexo lleva dos, y aceptar
 * `'33.333'` aquí sólo aplazaría el redondeo hasta el XML, donde ya nadie
 * relaciona el descuadre con el perfil que lo causó.
 */
export function parsePercentScaled(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const scaled = Number(whole) * 100 + Number(frac.padEnd(PERCENT_SCALE, '0'));
  return Number.isFinite(scaled) ? scaled : null;
}

/** `1900` → `'19.00'`. Inversa de `parsePercentScaled`. */
export function formatPercentScaled(scaled: number): string {
  const sign = scaled < 0 ? '-' : '';
  const abs = Math.abs(scaled);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ─── Validación pura ──────────────────────────────────────────────────────

/**
 * Un problema de la configuración, con el campo que lo causa.
 *
 * `field` es la ruta con puntos dentro del snapshot (`aiu.components.utilidad`)
 * para que el editor pueda marcar el control exacto en vez de mostrar un toast
 * genérico. `message` está en español porque se le muestra al operador.
 */
export interface ProfileConfigIssue {
  field: string;
  code: string;
  message: string;
}

/** Tarifas de IVA que la DIAN admite en `cbc:Percent` (tabla del anexo). */
const IVA_RATES_SCALED = new Set([0, 500, 1600, 1900]);
/** Tarifas de INC admitidas. */
const INC_RATES_SCALED = new Set([200, 400, 800, 1600]);

/**
 * Valida un snapshot de configuración. Devuelve **todos** los problemas, no el
 * primero: el editor tiene 7 secciones y devolver uno por vez obliga al usuario
 * a guardar siete veces para descubrir siete errores.
 *
 * Pura: no lanza, no lee base de datos, no depende del runtime. El backend la
 * envuelve y traduce el resultado a `INVOICING_PROFILE_005`; el frontend la usa
 * tal cual para marcar los campos en vivo.
 */
export function validateInvoiceProfileConfig(
  config: InvoiceProfileConfig,
  options: { operation_type: string },
): ProfileConfigIssue[] {
  const issues: ProfileConfigIssue[] = [];
  const isAiuOperation = options.operation_type === '09';

  if (config.config_version !== INVOICE_PROFILE_CONFIG_VERSION) {
    issues.push({
      field: 'config_version',
      code: 'CONFIG_VERSION_UNSUPPORTED',
      message: `La versión de configuración ${config.config_version} no es compatible con esta versión de Vendix (esperada: ${INVOICE_PROFILE_CONFIG_VERSION}).`,
    });
  }

  // ── Presencia de la sección AIU, atada al tipo de operación ──
  if (isAiuOperation && !config.aiu) {
    issues.push({
      field: 'aiu',
      code: 'AIU_SECTION_REQUIRED',
      message:
        'Un perfil de operación AIU (09) necesita su sección de AIU: sin régimen no se puede decidir qué parte del contrato lleva IVA.',
    });
  }
  if (!isAiuOperation && config.aiu) {
    issues.push({
      field: 'aiu',
      code: 'AIU_SECTION_NOT_APPLICABLE',
      message:
        'Este perfil no es de operación AIU (09), así que no puede llevar configuración de AIU. Cámbiale el tipo de operación o quita la sección.',
    });
  }

  if (config.aiu) {
    validateAiuSection(config.aiu, issues);
  }

  validateTaxSection(config, issues);
  validateModelLines(config, issues);
  validateFormat(config, issues);

  return issues;
}

function validateAiuSection(
  aiu: ProfileAiuConfig,
  issues: ProfileConfigIssue[],
): void {
  if (!AIU_TAXABLE_COMPONENTS_BY_REGIME[aiu.regime]) {
    issues.push({
      field: 'aiu.regime',
      code: 'AIU_REGIME_UNKNOWN',
      message: `El régimen «${String(aiu.regime)}» no existe. Elige E.T. art. 462-1 o Decreto 1372/1992.`,
    });
  }

  // ── Los tres porcentajes suman exactamente 100 ──
  let sum = 0;
  let allParsed = true;
  for (const component of AIU_COMPONENTS) {
    const scaled = parsePercentScaled(aiu.components?.[component]);
    if (scaled === null) {
      allParsed = false;
      issues.push({
        field: `aiu.components.${component}`,
        code: 'AIU_PERCENT_INVALID',
        message: `El porcentaje de ${component} no es un número válido con hasta dos decimales.`,
      });
      continue;
    }
    sum += scaled;
  }
  if (allParsed && sum !== PERCENT_TOTAL_SCALED) {
    issues.push({
      field: 'aiu.components',
      code: 'AIU_PERCENT_SUM',
      message: `Los porcentajes de AIU deben sumar 100% (actual: ${formatPercentScaled(sum)}%).`,
    });
  }

  // ── El piso no puede bajar del legal, y sólo rige bajo et_462_1 ──
  const floor = parsePercentScaled(aiu.minimum_base_percent);
  if (floor === null) {
    issues.push({
      field: 'aiu.minimum_base_percent',
      code: 'AIU_FLOOR_INVALID',
      message:
        'El porcentaje del piso legal no es un número válido con hasta dos decimales.',
    });
  } else if (
    aiu.regime === 'et_462_1' &&
    aiu.enforce_minimum_base &&
    floor < AIU_LEGAL_FLOOR_PERCENT_SCALED
  ) {
    // Subirlo SÍ se permite: declara más IVA, que es el lado recuperable del
    // error. Bajarlo declara de menos ante la DIAN, que es sanción e intereses.
    issues.push({
      field: 'aiu.minimum_base_percent',
      code: 'AIU_FLOOR_BELOW_LEGAL',
      message: `Bajo el E.T. art. 462-1 la base gravable no puede ser inferior al ${formatPercentScaled(AIU_LEGAL_FLOOR_PERCENT_SCALED)}% del valor del contrato. Configuraste ${formatPercentScaled(floor)}%.`,
    });
  }

  if (typeof aiu.enforce_minimum_base !== 'boolean') {
    issues.push({
      field: 'aiu.enforce_minimum_base',
      code: 'AIU_ENFORCE_NOT_EXPLICIT',
      message:
        'Hay que decir explícitamente si se aplica el piso legal: en un snapshot la ausencia no puede significar «sí».',
    });
  }

  if (!aiu.contract_object || !aiu.contract_object.trim()) {
    issues.push({
      field: 'aiu.contract_object',
      code: 'AIU_CONTRACT_OBJECT_EMPTY',
      message:
        'Describe el objeto del contrato: la DIAN valida esa nota en la línea de Administración (regla CAV03) y sin ella rechaza la factura.',
    });
  }
}

function validateTaxSection(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  const rules = config.taxes?.rules ?? [];
  const seen = new Set<string>();

  rules.forEach((rule, index) => {
    const at = `taxes.rules[${index}]`;

    if (!AIU_BUCKETS.includes(rule.bucket)) {
      issues.push({
        field: `${at}.bucket`,
        code: 'TAX_BUCKET_UNKNOWN',
        message: `«${String(rule.bucket)}» no es una porción válida del contrato.`,
      });
      return;
    }
    if (seen.has(rule.bucket)) {
      // Dos reglas para la misma porción es una contradicción sin resolución
      // determinista: cuál gana dependería del orden del arreglo.
      issues.push({
        field: `${at}.bucket`,
        code: 'TAX_BUCKET_DUPLICATED',
        message: `Hay dos reglas de impuesto para ${rule.bucket}. Deja una sola.`,
      });
      return;
    }
    seen.add(rule.bucket);

    const rate = parsePercentScaled(rule.rate);
    if (rate === null) {
      issues.push({
        field: `${at}.rate`,
        code: 'TAX_RATE_INVALID',
        message: `La tarifa de ${rule.bucket} no es un número válido con hasta dos decimales.`,
      });
    }

    if (!rule.taxable && rate !== null && rate !== 0) {
      // Éste es exactamente el descuadre que la DIAN rechaza por FAU04: una
      // porción que no declara impuesto pero trae tarifa.
      issues.push({
        field: `${at}.rate`,
        code: 'TAX_RATE_ON_NON_TAXABLE',
        message: `${rule.bucket} está marcado como no gravado pero tiene tarifa ${rule.rate}%. Un documento que declare las dos cosas se rechaza.`,
      });
    }

    if (rule.taxable && rate !== null) {
      if (rule.tax_code === '01' && !IVA_RATES_SCALED.has(rate)) {
        issues.push({
          field: `${at}.rate`,
          code: 'TAX_RATE_NOT_IN_DIAN_LIST',
          message: `La DIAN sólo admite 0%, 5%, 16% y 19% de IVA. ${rule.rate}% se rechaza.`,
        });
      }
      if (rule.tax_code === '04' && !INC_RATES_SCALED.has(rate)) {
        issues.push({
          field: `${at}.rate`,
          code: 'TAX_RATE_NOT_IN_DIAN_LIST',
          message: `La DIAN sólo admite 2%, 4%, 8% y 16% de INC. ${rule.rate}% se rechaza.`,
        });
      }
      // Otros tributos: no se valida la tarifa. Las listas de retefuente están
      // indexadas por CONCEPTO, no por porcentaje —hay porcentajes repetidos
      // para conceptos distintos—, así que una lista de porcentajes sueltos
      // daría falsa seguridad sin impedir el error que importa. Ver la nota de
      // `dian-tax-codes.ts` sobre `TarifaImpuestoReteFuente`.
    }
  });

  // ── La matriz no puede contradecir el régimen ──
  if (!config.aiu) return;
  const expected = AIU_TAXABLE_COMPONENTS_BY_REGIME[config.aiu.regime];
  if (!expected) return;

  for (const component of AIU_COMPONENTS) {
    const rule = rules.find((r) => r.bucket === component);
    if (!rule) {
      issues.push({
        field: `taxes.rules.${component}`,
        code: 'TAX_RULE_MISSING',
        message: `Falta la regla de impuesto de ${component}. Sin ella la emisión no sabe a qué tarifa gravarla y la factura puede salir declarando de menos.`,
      });
      continue;
    }
    const shouldBeTaxable = expected.includes(component);
    if (rule.taxable !== shouldBeTaxable) {
      issues.push({
        field: `taxes.rules.${component}.taxable`,
        code: 'TAX_MATRIX_CONTRADICTS_REGIME',
        message: shouldBeTaxable
          ? `Bajo ${config.aiu.regime} la base gravable incluye ${component}, así que no puede quedar sin gravar.`
          : `Bajo ${config.aiu.regime} la base gravable es sólo la utilidad, así que ${component} no puede quedar gravado.`,
      });
    }
  }

  // El costo reembolsable nunca entra en la base gravable: eso es lo que
  // distingue un contrato AIU de una venta ordinaria. Si entrara, el piso legal
  // se mediría contra un contrato y el IVA contra otro.
  const cost = rules.find((r) => r.bucket === 'costo');
  if (cost?.taxable) {
    issues.push({
      field: 'taxes.rules.costo.taxable',
      code: 'TAX_COST_MUST_NOT_BE_TAXABLE',
      message:
        'El costo reembolsable no forma parte de la base gravable del AIU bajo ninguno de los dos regímenes.',
    });
  }
}

function validateModelLines(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  (config.model_lines ?? []).forEach((line, index) => {
    const at = `model_lines[${index}]`;
    if (!AIU_BUCKETS.includes(line.bucket)) {
      issues.push({
        field: `${at}.bucket`,
        code: 'LINE_BUCKET_UNKNOWN',
        message: `«${String(line.bucket)}» no es una porción válida del contrato.`,
      });
    }
    if (!line.description || !line.description.trim()) {
      issues.push({
        field: `${at}.description`,
        code: 'LINE_DESCRIPTION_EMPTY',
        message:
          'Cada línea modelo necesita descripción: es la que viaja al documento.',
      });
    }
    if (line.quantity != null && parsePercentScaled(line.quantity) === null) {
      issues.push({
        field: `${at}.quantity`,
        code: 'LINE_QUANTITY_INVALID',
        message: 'La cantidad no es un número válido con hasta dos decimales.',
      });
    }
  });
}

function validateFormat(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  const decimals = config.format?.display_decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    issues.push({
      field: 'format.display_decimals',
      code: 'FORMAT_DECIMALS_OUT_OF_RANGE',
      message: 'Los decimales a mostrar tienen que ser un entero entre 0 y 6.',
    });
  }
  if (typeof config.format?.show_aiu_breakdown !== 'boolean') {
    issues.push({
      field: 'format.show_aiu_breakdown',
      code: 'FORMAT_BREAKDOWN_NOT_BOOLEAN',
      message: 'Hay que decir si se imprime el desglose de AIU.',
    });
  }
}

/**
 * Snapshot por omisión de un perfil AIU bajo el régimen conservador.
 *
 * El régimen por omisión es `et_462_1` porque grava el AIU COMPLETO, o sea
 * declara MÁS IVA que el otro: si el default estuviera equivocado, el
 * contribuyente pagó de más —recuperable— en vez de haber declarado de menos
 * ante la DIAN, que es sanción e intereses.
 */
export function buildDefaultAiuProfileConfig(
  contract_object = '',
): InvoiceProfileConfig {
  return {
    config_version: INVOICE_PROFILE_CONFIG_VERSION,
    general: { description: null, internal_note: null },
    aiu: {
      regime: 'et_462_1',
      contract_object,
      enforce_minimum_base: true,
      minimum_base_percent: formatPercentScaled(
        AIU_LEGAL_FLOOR_PERCENT_SCALED,
      ),
      components: {
        administracion: '10.00',
        imprevistos: '5.00',
        utilidad: '85.00',
      },
    },
    accounting: {
      revenue_account_by_bucket: null,
      vat_payable_account: null,
      mapping_key_overrides: null,
    },
    taxes: {
      rules: [
        { bucket: 'administracion', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'imprevistos', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
      ],
    },
    model_lines: [],
    format: {
      template_key: null,
      show_aiu_breakdown: true,
      display_decimals: 2,
    },
    dian: {
      payment_means_code: null,
      payment_method_code: null,
      header_notes: null,
    },
  };
}
