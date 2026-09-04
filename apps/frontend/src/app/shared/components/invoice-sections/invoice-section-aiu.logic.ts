/**
 * Reglas de la sección AIU, en funciones PURAS.
 *
 * ## Por qué existe este archivo y no vive dentro del componente
 *
 * Tres consumidores necesitan las mismas reglas y ninguno puede llamar a los
 * otros dos:
 *
 *  1. `invoice-section-aiu.component.ts` — reproyecta la matriz cuando alguien
 *     cambia la base gravable, y pinta los avisos.
 *  2. `invoice-profile-editor.component.ts` — `buildConfig()` tiene que EMITIR
 *     la fila derivada del costo aunque nadie haya tocado la base, porque su
 *     ausencia bajo `'subtotal'` es un 422 `TAX_RULE_MISSING`.
 *  3. `invoice-create-page.component.ts` — resuelve la base efectiva del
 *     documento y con ella los impuestos de las líneas que va a escribir.
 *
 * Con la lógica dentro del componente, (2) y (3) tendrían que duplicarla, y una
 * matriz reproyectada de dos maneras distintas es exactamente el defecto que
 * este módulo existe para cerrar: la pantalla diría una gravabilidad y el
 * payload llevaría otra, sin que nada falle al compilar.
 *
 * ## La tabla que manda
 *
 * `AIU_TAXABLE_BUCKETS_BY_BASIS` del contrato es la ÚNICA autoridad sobre qué
 * porción entra a la base gravable. Ninguna función de aquí escribe esa
 * afirmación a mano: todas la consultan. El contrato es espejo byte a byte del
 * backend y lo guarda un test de paridad, así que consultarlo es lo único que
 * garantiza que la pantalla y el validador digan lo mismo.
 */
import {
  AIU_BUCKETS,
  AIU_COMPONENTS,
  AIU_TAXABLE_BASES,
  AIU_TAXABLE_BUCKETS_BY_BASIS,
  formatPercentScaled,
  parsePercentScaled,
  resolveAiuTaxableBasis,
} from '../../../core/utils/invoice-profile-config.contract';
import type {
  AiuBucket,
  AiuComponentLiteral,
  AiuComponentsBasis,
  AiuTaxableBasis,
  ProfileAiuConfig,
  ProfileTaxRule,
} from '../../../core/utils/invoice-profile-config.contract';
import { getFiscalResponsibilityLabel } from '../../constants/fiscal-responsibilities.constants';
import type { SelectorOption } from '../selector/selector.component';

/**
 * Una fila de la matriz, tal como la lleva el formulario de cualquiera de las
 * dos pantallas. Es estructuralmente `ProfileTaxRule`, y se declara con nombre
 * propio porque en la factura NO es una regla de perfil: es la gravabilidad de
 * este documento.
 */
export type AiuTaxRuleValue = ProfileTaxRule;

/** Etiquetas de las porciones. Un solo sitio, dos pantallas. */
export const AIU_COMPONENT_LABELS: Readonly<Record<AiuComponentLiteral, string>> =
  {
    administracion: 'Administración',
    imprevistos: 'Imprevistos',
    utilidad: 'Utilidad',
  };

export function aiuBucketLabel(bucket: string): string {
  if (bucket === 'costo') return 'Costo reembolsable';
  return (
    AIU_COMPONENT_LABELS[bucket as AiuComponentLiteral] ?? bucket
  );
}

/**
 * Las TRES bases gravables, en el orden en que la referencia de negocio las
 * enumera: Subtotal / AIU / Utilidad.
 *
 * Reemplazan al selector de régimen: el régimen no viaja a la DIAN y nadie
 * sabía contestarlo, mientras que la base sí es la pregunta del negocio —qué
 * se grava— y es la única que puede decir «el contrato completo».
 */
export const AIU_TAXABLE_BASIS_OPTIONS: readonly SelectorOption[] = [
  {
    value: 'subtotal',
    label: 'Subtotal — IVA sobre el contrato completo (sin AIU)',
  },
  { value: 'aiu', label: 'AIU completo — IVA sobre A+I+U (art. 462-1 E.T.)' },
  {
    value: 'utilidad',
    label: 'Utilidad — IVA sólo sobre la Utilidad (Decreto 1372/1992)',
  },
];

export const AIU_COMPONENTS_BASIS_OPTIONS: readonly SelectorOption[] = [
  { value: 'contract', label: 'Valor del contrato' },
  { value: 'aiu', label: 'El AIU (suman 100 %)' },
];

/**
 * Porciones que la matriz ofrece: las TRES del AIU, nunca el costo.
 *
 * El costo no se ofrece bajo ninguna base porque su valor correcto está
 * completamente determinado —lo escribe {@link derivedCostTaxRule}— y una
 * casilla ahí sólo podría ofrecer decisiones que el servidor devuelve con 422.
 */
export const AIU_MATRIX_BUCKET_OPTIONS: readonly SelectorOption[] =
  AIU_COMPONENTS.map((component) => ({
    value: component,
    label: AIU_COMPONENT_LABELS[component],
  }));

/**
 * Tributos de la tabla 13.2.2 del anexo, por CÓDIGO.
 *
 * Se ofrecen los seis que un contrato AIU usa en la práctica y no la tabla de
 * dieciséis: un selector con `Sordicom` entre las opciones esconde IVA y
 * Retefuente, que son las dos que se buscan siempre. El validador acepta
 * cualquier par de dígitos, así que restringir el selector no cierra ninguna
 * puerta — sólo ordena la que se usa.
 */
export const AIU_TAX_CODE_OPTIONS: readonly SelectorOption[] = [
  { value: '01', label: 'IVA (01)' },
  { value: '04', label: 'INC (04)' },
  { value: '03', label: 'ICA (03)' },
  { value: '06', label: 'ReteFuente (06)' },
  { value: '07', label: 'ReteICA (07)' },
  { value: '05', label: 'ReteIVA (05)' },
];

/**
 * Base gravable a partir de un valor crudo de control.
 *
 * Un valor fuera de la lista cae en la base MÁS AMPLIA —`'aiu'`— porque
 * declarar de más es recuperable con nota crédito y declarar de menos es
 * sanción e intereses. Es la misma doctrina que `taxableBasisFromRegime`
 * documenta en el contrato. No la inviertas.
 */
export function asAiuTaxableBasis(value: unknown): AiuTaxableBasis {
  return AIU_TAXABLE_BASES.includes(value as AiuTaxableBasis)
    ? (value as AiuTaxableBasis)
    : 'aiu';
}

/** Unidad de los tres porcentajes a partir de un valor crudo de control. */
export function asAiuComponentsBasis(value: unknown): AiuComponentsBasis {
  return value === 'aiu' ? 'aiu' : 'contract';
}

/**
 * Nombre corto de la base, para la cabecera colapsada de una sección.
 *
 * La versión larga cita la norma y arranca en minúscula porque se incrusta en
 * una frase; un resumen de sección que empieza en minúscula se lee cortado.
 */
export function aiuTaxableBasisShortLabel(basis: AiuTaxableBasis): string {
  switch (basis) {
    case 'subtotal':
      return 'Base Subtotal';
    case 'utilidad':
      return 'Base Utilidad';
    default:
      return 'Base AIU';
  }
}

/** Nombre de la base para avisos, incrustado en una frase. */
export function aiuTaxableBasisLabel(basis: AiuTaxableBasis): string {
  switch (basis) {
    case 'subtotal':
      return 'la base Subtotal (contrato completo)';
    case 'utilidad':
      return 'la base sólo Utilidad (Decreto 1372/1992)';
    default:
      return 'la base AIU completo (art. 462-1 E.T.)';
  }
}

export function aiuMinimumBaseHelp(basis: AiuTaxableBasis): string {
  switch (basis) {
    case 'utilidad':
      return 'El Decreto 1372/1992 no fija piso; desactivar la exigencia es lo habitual.';
    case 'subtotal':
      // No es que el piso sea otro: es que no hay AIU que pisar. Se grava el
      // contrato entero, así que la base gravable ya es el 100 % y compararla
      // con un 10 % no dice nada.
      return 'Con la base Subtotal no hay AIU que pisar: se grava el contrato completo y el piso no se aplica.';
    default:
      return 'El art. 462-1 E.T. fija el 10 % del valor del contrato como mínimo.';
  }
}

/**
 * El párrafo que explica el reparto, dicho SOBRE LA UNIDAD ELEGIDA.
 *
 * Los mismos tres números significan cosas distintas según la unidad, así que
 * la explicación no puede ser la misma en los dos casos: con la unidad `'aiu'`
 * una prosa fija que hablara del costo reembolsable contradiría al contador que
 * exige sumar 100, y la afirmación equivocada es la que se lee primero.
 */
export function aiuComponentsBasisExplainer(basis: AiuComponentsBasis): string {
  return basis === 'aiu'
    ? 'El reparto que se aplica a las líneas. Con la unidad «el AIU» los tres porcentajes reparten el AIU entre sí y por eso tienen que sumar 100 %: qué porción del contrato es AIU lo decide el importe de cada factura, no este reparto.'
    : 'El reparto que se aplica a las líneas. Con la unidad «valor del contrato» —como se redacta un contrato AIU— la suma de los tres ES el AIU, y lo que falte hasta el 100 % es costo reembolsable.';
}

export function aiuComponentUnitSuffix(basis: AiuComponentsBasis): string {
  return basis === 'contract' ? ' (% del contrato)' : ' (% del AIU)';
}

export function aiuComponentsSumTarget(basis: AiuComponentsBasis): string {
  return basis === 'contract' ? '= AIU del contrato' : '/ 100,00 %';
}

/** Suma de los tres porcentajes, en centésimas. */
export function aiuComponentsSumScaled(
  values: Readonly<Partial<Record<AiuComponentLiteral, unknown>>>,
): number {
  return AIU_COMPONENTS.reduce((total, component) => {
    return total + (parsePercentScaled(values[component]) ?? 0);
  }, 0);
}

/**
 * ¿La suma de los tres porcentajes es admisible?
 *
 * Con la unidad `'aiu'` tiene que ser exactamente 100. Con `'contract'` la suma
 * ES el AIU: cualquier cosa entre un punto y el 100 % es legítima, pero por
 * debajo del piso exigido no lo es — y eso se puede saber aquí, antes de gastar
 * un consecutivo.
 */
export function aiuComponentsSumOk(params: {
  componentsBasis: AiuComponentsBasis;
  taxableBasis: AiuTaxableBasis;
  sumScaled: number;
  floorScaled: number | null;
  enforceFloor: boolean;
}): boolean {
  if (params.componentsBasis === 'aiu') return params.sumScaled === 10000;
  if (params.sumScaled <= 0 || params.sumScaled > 10000) return false;
  const enforced = params.taxableBasis === 'aiu' && params.enforceFloor;
  return !(
    enforced &&
    params.floorScaled !== null &&
    params.sumScaled < params.floorScaled
  );
}

/**
 * Primera porción que la base elegida SÍ grava.
 *
 * `'costo'` nunca es respuesta: no es componente del AIU y la línea que lo
 * lleva es exactamente la que el interruptor de línea apaga.
 */
export function firstTaxableAiuComponent(
  basis: AiuTaxableBasis,
): AiuComponentLiteral {
  const found = AIU_TAXABLE_BUCKETS_BY_BASIS[basis].find(
    (bucket): bucket is AiuComponentLiteral => bucket !== 'costo',
  );
  return found ?? 'administracion';
}

/**
 * Tributo y tarifa de referencia: los de la primera porción gravada con tarifa
 * REAL. Es lo que se copia a una fila que ENTRA a la base sin tarifa propia,
 * para no sembrar un 0 % que valida y declara de menos.
 */
export function aiuReferenceTaxRate(
  rules: readonly AiuTaxRuleValue[],
): { tax_code: string; rate: string } {
  for (const rule of rules) {
    if (rule.bucket === 'costo') continue;
    const rate = parsePercentScaled(rule.rate);
    if (rate !== null && rate > 0) {
      return {
        tax_code: String(rule.tax_code ?? '01'),
        rate: formatPercentScaled(rate),
      };
    }
  }
  return { tax_code: '01', rate: '19.00' };
}

/**
 * La regla de impuesto del costo reembolsable: DERIVADA, nunca editada.
 *
 * Su valor correcto está completamente determinado por la base, y las cuatro
 * combinaciones equivocadas están medidas contra el servidor vivo:
 *
 * · falta la fila y la base es `subtotal` ⇒ 422 `TAX_RULE_MISSING`. Bajo las
 *   otras dos bases la fila es opcional (201 sin ella), pero se emite igual:
 *   una fila presente y coherente es la constancia de que ese costo estaba
 *   exento, y es lo que hace que la previsualización lo siga listando.
 * · gravada bajo `aiu` o `utilidad` ⇒ 422 `TAX_COST_MUST_NOT_BE_TAXABLE`.
 * · exenta bajo `subtotal` ⇒ 422 `TAX_MATRIX_CONTRADICTS_REGIME`.
 * · exenta conservando tarifa ⇒ 422 `TAX_RATE_ON_NON_TAXABLE` **además** del
 *   anterior. Por eso la tarifa acompaña al interruptor y no se deja quieta.
 *
 * Gravada adopta el tributo y la tarifa de referencia porque bajo `subtotal` se
 * grava un solo contrato con un solo tributo, y un costo al 0 % validaría
 * declarando de menos.
 */
export function derivedCostTaxRule(
  rules: readonly AiuTaxRuleValue[],
  basis: AiuTaxableBasis,
): AiuTaxRuleValue {
  const taxable = AIU_TAXABLE_BUCKETS_BY_BASIS[basis].includes('costo');
  const reference = aiuReferenceTaxRate(rules);
  const existing = rules.find((rule) => rule.bucket === 'costo');
  const existingCode = String(existing?.tax_code ?? '').trim();
  return {
    bucket: 'costo',
    taxable,
    tax_code: taxable ? reference.tax_code : existingCode || reference.tax_code,
    rate: taxable ? reference.rate : '0.00',
  };
}

/**
 * Las CUATRO porciones derivadas de la base, en el orden de `AIU_BUCKETS`.
 *
 * Es la siembra con que nace un perfil AIU en blanco y lo que completa las
 * porciones ausentes al hidratar: la gravabilidad (`taxable`) y la tarifa de
 * las no gravadas (`'0.00'`) las escribe ESTA tabla, nunca una persona —las
 * combinaciones libres son exactamente las que el servidor devuelve con 422—.
 * Lo editable es el tributo y la tarifa de las porciones que la base SÍ grava.
 *
 * La base NUNCA se lee en crudo: se resuelve por `resolveAiuTaxableBasis`,
 * así que una config que declara `regime` y no `taxable_basis` —el caso de
 * las dos plantillas DIAN— deriva igual. Acepta la base ya resuelta como
 * atajo para la reproyección en caliente.
 */
export function deriveAiuTaxMatrix(
  aiuOrBasis:
    | Pick<ProfileAiuConfig, 'regime' | 'taxable_basis'>
    | AiuTaxableBasis
    | null
    | undefined,
  existing: readonly AiuTaxRuleValue[] = [],
): AiuTaxRuleValue[] {
  const basis =
    typeof aiuOrBasis === 'string'
      ? (AIU_TAXABLE_BASES.includes(aiuOrBasis as AiuTaxableBasis)
          ? (aiuOrBasis as AiuTaxableBasis)
          : resolveAiuTaxableBasis(null))
      : resolveAiuTaxableBasis(aiuOrBasis);
  const taxableBuckets = AIU_TAXABLE_BUCKETS_BY_BASIS[basis];
  const reference = aiuReferenceTaxRate(existing);
  return AIU_BUCKETS.map((bucket) => {
    if (bucket === 'costo') return derivedCostTaxRule(existing, basis);
    const shouldBeTaxable = taxableBuckets.includes(bucket);
    const found = existing.find((rule) => rule.bucket === bucket);
    const foundCode = String(found?.tax_code ?? '').trim();
    if (!shouldBeTaxable) {
      return {
        bucket,
        taxable: false,
        tax_code: foundCode || reference.tax_code,
        rate: '0.00',
      } satisfies AiuTaxRuleValue;
    }
    const foundRate = parsePercentScaled(found?.rate);
    const hasRealRate = foundRate !== null && foundRate > 0;
    return {
      bucket,
      taxable: true,
      tax_code: foundCode || reference.tax_code,
      rate: hasRealRate
        ? formatPercentScaled(foundRate as number)
        : reference.rate,
    } satisfies AiuTaxRuleValue;
  });
}

/**
 * La matriz completa reproyectada sobre la base elegida.
 *
 * ─── POR QUÉ NO BASTA CON ESCRIBIR LA BASE ──────────────────────────────────
 *
 * El servidor compara CADA porción contra `AIU_TAXABLE_BUCKETS_BY_BASIS[base]`
 * y devuelve 422 en cuanto una discrepa: `TAX_MATRIX_CONTRADICTS_REGIME` en
 * `taxes.rules.<porción>.taxable`, o `TAX_COST_MUST_NOT_BE_TAXABLE` si la
 * porción es el costo. Una matriz que traía el costo exento y pasa a base
 * «Subtotal» queda contradiciéndose sin que nadie haya tocado esa casilla — y
 * la pantalla no tendría forma de explicar de dónde salió el error. Cambiar la
 * base y reproyectar la matriz es UN SOLO acto, no dos.
 *
 * Qué hace, porción por porción:
 * · sale de la base ⇒ `taxable:false` y tarifa `'0.00'`. La tarifa TIENE que
 *   irse a cero: `TAX_RATE_ON_NON_TAXABLE` rechaza una porción no gravada que
 *   conserva tarifa, que es el descuadre que la DIAN devuelve por FAU04.
 * · entra a la base ⇒ `taxable:true`, conservando su tarifa si ya tenía una
 *   real; si venía en cero, adopta la de referencia, porque un gravable al 0 %
 *   valida y declara de menos.
 * · el costo NO se recorre con las demás: se sincroniza al FINAL desde
 *   `derivedCostTaxRule`, cuya tarifa de referencia son las porciones que el
 *   recorrido acaba de reproyectar. Calculada antes, bajo «Subtotal» habría
 *   copiado el 0,00 % de una porción que en ese mismo acto pasaba a gravar.
 *
 * ## El orden se conserva y la fila del costo se AÑADE al final
 *
 * Los mensajes del validador vuelven como `taxes.rules[i].rate` y la pantalla
 * los pinta en la fila `i`. Filtrar o reordenar movería cada fila un puesto y
 * el error aparecería en la línea de al lado. Si no había fila de costo, se
 * añade al final, donde su índice queda más allá de toda fila visible.
 */
export function reprojectAiuTaxRules(
  rules: readonly AiuTaxRuleValue[],
  defaultBasis: AiuTaxableBasis,
): AiuTaxRuleValue[] {
  // La base la decide el GRUPO (`defaultBasis`), nunca la fila: ningún
  // productor de emisión lee una base por regla, así que honrarla aquí
  // divergiría del validador, que resuelve por `resolveAiuTaxableBasis`.
  // La clave vieja se retira al reproyectar; los snapshots históricos la
  // conservan en su `jsonb` y se leen con tolerancia en la hidratación.
  const stripBasis = (
    rule: AiuTaxRuleValue,
  ): Omit<AiuTaxRuleValue, 'taxable_basis'> => {
    const { taxable_basis: _dropped, ...rest } = rule;
    return rest;
  };
  const reference = aiuReferenceTaxRate(rules);

  const projected: AiuTaxRuleValue[] = rules.map((rule) => {
    const expected = AIU_TAXABLE_BUCKETS_BY_BASIS[defaultBasis];
    const bucket = rule.bucket;
    const base = stripBasis(rule);
    if (!bucket || !AIU_BUCKETS.includes(bucket) || bucket === 'costo') {
      return base;
    }
    const shouldBeTaxable = expected.includes(bucket);
    if (Boolean(rule.taxable) === shouldBeTaxable) {
      return base;
    }
    if (!shouldBeTaxable) {
      return { ...base, taxable: false, rate: '0.00' };
    }
    const hasRealRate = (parsePercentScaled(rule.rate) ?? 0) > 0;
    return hasRealRate
      ? { ...base, taxable: true }
      : {
          ...base,
          taxable: true,
          tax_code: reference.tax_code,
          rate: reference.rate,
        };
  });

  const derived = derivedCostTaxRule(projected, defaultBasis);
  const costIndex = projected.findIndex((rule) => rule.bucket === 'costo');
  if (costIndex >= 0) {
    projected[costIndex] = stripBasis(derived as AiuTaxRuleValue);
  } else {
    projected.push(stripBasis(derived as AiuTaxRuleValue));
  }
  return projected;
}

/**
 * Porciones cuya casilla «gravable» contradice la base declarada.
 *
 * El costo NO puede ofender: lo escribe `derivedCostTaxRule` desde esta misma
 * tabla. Contarlo aquí señalaría una fila que la pantalla no muestra.
 */
export function aiuTaxMatrixOffenders(
  rules: readonly AiuTaxRuleValue[],
  basis: AiuTaxableBasis,
): AiuBucket[] {
  const expected: readonly string[] = AIU_TAXABLE_BUCKETS_BY_BASIS[basis];
  const offenders: AiuBucket[] = [];
  for (const rule of rules) {
    const bucket = rule.bucket;
    if (!bucket || !AIU_BUCKETS.includes(bucket) || bucket === 'costo') continue;
    if (Boolean(rule.taxable) !== expected.includes(bucket)) {
      offenders.push(bucket);
    }
  }
  return offenders;
}

/**
 * Aviso de contradicción entre la base gravable y la matriz.
 *
 * No sustituye al validador —que lo reporta como bloqueo— sino que lo explica
 * en la sección donde se arregla, porque el mensaje del validador aparece al
 * pie y no dice en qué fila mirar. Mira las DOS direcciones: gravar lo que la
 * base excluye, y dejar sin gravar lo que la base incluye.
 */
export function aiuTaxMatrixMismatchMessage(
  rules: readonly AiuTaxRuleValue[],
  basis: AiuTaxableBasis,
): string | null {
  const offenders = aiuTaxMatrixOffenders(rules, basis);
  if (offenders.length === 0) return null;
  const expected = AIU_TAXABLE_BUCKETS_BY_BASIS[basis]
    .filter((bucket) => bucket !== 'costo')
    .map((bucket) => aiuBucketLabel(bucket))
    .join(' + ');
  return (
    'Bajo ' +
    aiuTaxableBasisLabel(basis) +
    ' la base gravable es ' +
    expected +
    '. Hay ' +
    offenders.length +
    ' regla(s) que dicen lo contrario: el XML declararía una base que sus ' +
    'propias líneas no respaldan y la DIAN lo rechaza (FAU04).'
  );
}

/**
 * Qué se hace con el costo reembolsable, dicho en pantalla.
 *
 * Es obligatorio decirlo: la fila se guarda y no se ve, así que sin esta frase
 * el documento llevaría una decisión fiscal que nadie puede revisar. Y bajo
 * «Subtotal» la tarifa que el costo lleva —la porción más grande del
 * contrato— sale de las porciones de arriba, así que hay que nombrarla y decir
 * de dónde viene.
 */
export function aiuCostRuleNote(
  rules: readonly AiuTaxRuleValue[],
  basis: AiuTaxableBasis,
): string {
  if (basis === 'subtotal') {
    return (
      'El costo reembolsable también grava con esta base: se guarda al ' +
      derivedCostTaxRule(rules, basis).rate +
      ' %, con el mismo tributo que las porciones de arriba. No tiene fila ' +
      'propia porque con la base Subtotal no hay desglose AIU que configurar: ' +
      'si ese porcentaje no es el correcto, corrígelo arriba y el costo lo sigue.'
    );
  }
  return (
    'El costo reembolsable no se configura acá: bajo ' +
    aiuTaxableBasisLabel(basis) +
    ' queda fuera de la base gravable, y se guarda exento con tarifa 0,00 %. ' +
    'Esa constancia es la que hace que la previsualización lo siga listando ' +
    'entre las porciones omitidas.'
  );
}

// ───────────────────────────────────────────────────────────────────────────
// SUGERENCIA DE TRIBUTOS DESDE LAS RESPONSABILIDADES DEL ADQUIRIENTE
// ───────────────────────────────────────────────────────────────────────────

/**
 * ## La matriz PROPONE. Nunca aplica.
 *
 * Las responsabilidades fiscales del adquiriente —campo 9 del RUT, que el
 * documento ya trae cargado— insinúan qué tributos suele llevar un contrato
 * con ese cliente. Insinuar no es decidir, y la diferencia acá no es de estilo:
 *
 * · Si la sugerencia se aplicara sola, un cliente marcado «Gran contribuyente»
 *   —agente de retención por ley— sembraría una retención que nadie pidió, y
 *   una retención RESTA de lo que se cobra. El operador vería un total menor sin
 *   haber tocado nada.
 * · Al contrario, un IVA sugerido y aplicado en silencio sobre un servicio
 *   excluido declararía un impuesto que no existe.
 *
 * Por eso la sugerencia vive FUERA de la matriz hasta que alguien la aplica, y
 * lo que se quita no vuelve: ver {@link aiuTaxSuggestions}.
 *
 * ## Por qué la responsabilidad del cliente no basta, y se dice en pantalla
 *
 * Quien cobra IVA es el EMISOR, por la naturaleza del servicio; que el cliente
 * sea responsable de IVA sólo significa que podrá descontarlo. La sugerencia es
 * entonces una pista sobre el cliente, no una conclusión sobre el documento, y
 * cada fila lleva su advertencia (`caveat`) diciéndolo. Sin esa frase la
 * pantalla afirmaría una obligación fiscal que no puede derivar de ese dato.
 *
 * ## Por qué unas traen tarifa y otras no
 *
 * El validador del contrato fija las tarifas admisibles del IVA (0 / 5 / 16 /
 * 19 %) y del INC (2 / 4 / 8 / 16 %), y no fija ninguna para las retenciones —
 * porque las tablas de retefuente están indexadas por CONCEPTO y hay tarifas
 * repetidas para conceptos distintos. Donde la ley no fija una sola tarifa,
 * proponer un número sería inventarlo: la sugerencia se queda en aviso, sin
 * botón de aplicar, y dice de dónde sacar la tarifa. Un número inventado en una
 * casilla de impuestos es peor que una casilla vacía, porque se guarda igual.
 */
export interface AiuTaxSuggestionSource {
  /** Código de la responsabilidad, tal como está en el RUT del cliente. */
  code: string;
  /** Su etiqueta en español. La procedencia se dice con nombre, no con código. */
  label: string;
}

export interface AiuTaxSuggestion {
  /** Código del tributo, tabla 13.2.2 del anexo técnico. */
  tax_code: string;
  /** Etiqueta del tributo, la MISMA que ofrece el selector de la matriz. */
  tax_label: string;
  /**
   * Tarifa propuesta, o `null` cuando la ley no fija una sola y proponer un
   * número sería inventarlo. `null` significa además NO APLICABLE: sin tarifa
   * determinada no hay fila que escribir.
   */
  rate: string | null;
  /** Responsabilidades del adquiriente que la produjeron. Nunca vacío. */
  sources: readonly AiuTaxSuggestionSource[];
  /** Qué hay que confirmar antes de aplicarla. Se pinta siempre. */
  caveat: string;
}

const IVA_CAVEAT =
  'Confirma que el servicio esté gravado: el IVA lo cobra el emisor por la naturaleza del servicio, y la responsabilidad del cliente sólo dice que podrá descontarlo.';

const INC_CAVEAT =
  'Sin tarifa sugerida: el INC admite 2 %, 4 %, 8 % y 16 % según el bien o el servicio, y proponer una sería inventarla. Agrégalo con «Agregar impuesto» y escribe la del concepto.';

const RETEFUENTE_CAVEAT =
  'Sin tarifa sugerida: la retención depende del concepto y la DIAN no fija una sola. Agrégala con «Agregar impuesto», o captúrala en la sección de retenciones, que es donde viaja con su concepto.';

/**
 * Responsabilidad del RUT → tributo que insinúa.
 *
 * Los códigos son los del catálogo compartido con el backend
 * (`fiscal-responsibilities.constants.ts`), que es espejo del validador: un
 * código que no esté ahí no puede llegar en el formulario.
 *
 * Lo que NO está acá está fuera a propósito, y por qué:
 * · `O-15` Autorretenedor — retiene sobre sus PROPIOS ingresos; como comprador
 *   no practica retención sobre esta factura. Sugerir una sería al revés.
 * · `O-47` Régimen simple — no es agente de retención en renta.
 * · `O-49` / `O-22` No responsable de IVA — que el cliente no lo sea NO quita
 *   el IVA del documento: lo decide el servicio y el emisor. Un mapeo inverso
 *   que quitara el IVA por esto declararía de menos.
 * · `R-99-PN`, `O-14`, `O-16`, `O-32` — no dicen nada sobre los tributos de un
 *   contrato AIU.
 */
const AIU_TAX_SUGGESTION_BY_RESPONSIBILITY: Readonly<
  Record<string, { tax_code: string; rate: string | null; caveat: string }>
> = {
  'O-48': { tax_code: '01', rate: '19.00', caveat: IVA_CAVEAT },
  'O-17': { tax_code: '01', rate: '19.00', caveat: IVA_CAVEAT },
  'O-19': { tax_code: '04', rate: null, caveat: INC_CAVEAT },
  'O-33': { tax_code: '04', rate: null, caveat: INC_CAVEAT },
  'O-13': { tax_code: '06', rate: null, caveat: RETEFUENTE_CAVEAT },
};

/** Etiqueta del tributo según el selector de la matriz. Un solo sitio. */
export function aiuTaxCodeLabel(code: string): string {
  const option = AIU_TAX_CODE_OPTIONS.find(
    (candidate) => String(candidate.value) === code,
  );
  return option ? String(option.label) : 'Tributo ' + code;
}

/**
 * Los tributos que las responsabilidades del adquiriente sugieren y que la
 * matriz TODAVÍA no declara.
 *
 * Tres filtros, y el orden importa menos que el hecho de que los tres existan:
 *
 *  1. **Descartados** — `dismissed` es la memoria de lo que la persona quitó.
 *     Sin ella la sugerencia se recalcularía sobre el estado actual de la
 *     matriz, así que quitar una fila la haría REAPARECER como sugerencia y
 *     volver a ofrecerla: el operador quita, la pantalla repone, y el segundo
 *     clic vuelve a poner el tributo. Es el defecto que este parámetro cierra.
 *  2. **Ya declarados** — un tributo con fila GRAVABLE en la matriz no se
 *     sugiere: ya está. Se mira `taxable` y no la sola presencia del código,
 *     porque bajo la base «sólo Utilidad» las porciones excluidas conservan su
 *     `tax_code` con `taxable:false` y tarifa 0,00 — están en la matriz sin
 *     declarar nada, y tratarlas como declaradas esconderría la sugerencia
 *     justo cuando hace falta.
 *  3. **Sin duplicar** — dos responsabilidades pueden insinuar el mismo tributo
 *     (`O-48` y `O-17`, las dos de IVA). Se emite UNA sugerencia con las dos
 *     procedencias, porque dos tarjetas idénticas se leen como dos tributos.
 */
export function aiuTaxSuggestions(params: {
  responsibilities: readonly string[];
  rules: readonly AiuTaxRuleValue[];
  dismissed?: ReadonlySet<string>;
}): AiuTaxSuggestion[] {
  const dismissed = params.dismissed ?? new Set<string>();
  const declared = new Set(
    params.rules
      .filter((rule) => Boolean(rule.taxable))
      .map((rule) => String(rule.tax_code ?? '').trim()),
  );

  const byTaxCode = new Map<string, AiuTaxSuggestion>();

  for (const raw of params.responsibilities) {
    const code = String(raw ?? '').trim();
    const entry = AIU_TAX_SUGGESTION_BY_RESPONSIBILITY[code];
    if (!entry) continue;
    if (dismissed.has(entry.tax_code)) continue;
    if (declared.has(entry.tax_code)) continue;

    const source: AiuTaxSuggestionSource = {
      code,
      label: getFiscalResponsibilityLabel(code),
    };
    const existing = byTaxCode.get(entry.tax_code);
    if (existing) {
      // Misma sugerencia, otra procedencia. Se acumulan las dos: el operador
      // tiene que poder ver por cuál de las responsabilidades del RUT aparece.
      byTaxCode.set(entry.tax_code, {
        ...existing,
        sources: [...existing.sources, source],
      });
      continue;
    }
    byTaxCode.set(entry.tax_code, {
      tax_code: entry.tax_code,
      tax_label: aiuTaxCodeLabel(entry.tax_code),
      rate: entry.rate,
      sources: [source],
      caveat: entry.caveat,
    });
  }

  return [...byTaxCode.values()];
}

/** «sugerido por «Gran contribuyente» (O-13)», con todas sus procedencias. */
export function aiuTaxSuggestionOrigin(suggestion: AiuTaxSuggestion): string {
  const named = suggestion.sources
    .map((source) => '«' + source.label + '» (' + source.code + ')')
    .join(' y ');
  return 'Sugerido por ' + named + ' en las responsabilidades fiscales del cliente.';
}

/**
 * Las porciones del AIU que la base elegida grava, sin el costo.
 *
 * Consulta {@link AIU_TAXABLE_BUCKETS_BY_BASIS} en vez de afirmarlo: es la
 * única tabla que sabe qué entra a la base, y es espejo del validador. El costo
 * se excluye porque su fila la ESCRIBE {@link derivedCostTaxRule} y no una
 * persona.
 */
export function aiuTaxableComponents(
  basis: AiuTaxableBasis,
): AiuComponentLiteral[] {
  return AIU_TAXABLE_BUCKETS_BY_BASIS[basis].filter(
    (bucket): bucket is AiuComponentLiteral => bucket !== 'costo',
  );
}

/**
 * Qué haría exactamente aplicar una sugerencia, ANTES de aplicarla.
 *
 * Se calcula aparte para poder DECIRLO en la tarjeta: aplicar escribe sobre la
 * matriz, y una acción que escribe tiene que enumerar lo que va a tocar.
 *
 * · `writes` — porciones que la base grava y que hoy no declaran ese tributo.
 *   Reciben la fila (o la que tenían, si no declaraba nada).
 * · `keeps` — porciones que YA declaran otro tributo. No se tocan: la matriz
 *   admite UNA regla por porción —`TAX_BUCKET_DUPLICATED` rechaza dos— así que
 *   escribir ahí no sería añadir un tributo, sería REEMPLAZAR el que alguien
 *   eligió. Se nombran en pantalla para que el hueco no parezca un fallo.
 */
export function aiuSuggestionPlan(params: {
  suggestion: AiuTaxSuggestion;
  rules: readonly AiuTaxRuleValue[];
  basis: AiuTaxableBasis;
}): {
  writes: AiuComponentLiteral[];
  keeps: { bucket: AiuComponentLiteral; tax_code: string }[];
} {
  const writes: AiuComponentLiteral[] = [];
  const keeps: { bucket: AiuComponentLiteral; tax_code: string }[] = [];

  for (const bucket of aiuTaxableComponents(params.basis)) {
    const rule = params.rules.find((candidate) => candidate.bucket === bucket);
    const declaredCode = String(rule?.tax_code ?? '').trim();
    if (
      rule &&
      Boolean(rule.taxable) &&
      declaredCode !== params.suggestion.tax_code
    ) {
      keeps.push({ bucket, tax_code: declaredCode });
      continue;
    }
    writes.push(bucket);
  }

  return { writes, keeps };
}

/** «Administración, Imprevistos y Utilidad», para decir qué se escribiría. */
export function aiuBucketListLabel(
  buckets: readonly AiuComponentLiteral[],
): string {
  const labels = buckets.map((bucket) => AIU_COMPONENT_LABELS[bucket]);
  if (labels.length <= 1) return labels.join('');
  return labels.slice(0, -1).join(', ') + ' y ' + labels[labels.length - 1];
}
