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
} from '../../../../../../core/utils/invoice-profile-config.contract';
import type {
  AiuBucket,
  AiuComponentLiteral,
  AiuComponentsBasis,
  AiuTaxableBasis,
  ProfileTaxRule,
} from '../../../../../../core/utils/invoice-profile-config.contract';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';

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
  basis: AiuTaxableBasis,
): AiuTaxRuleValue[] {
  const expected = AIU_TAXABLE_BUCKETS_BY_BASIS[basis];
  const reference = aiuReferenceTaxRate(rules);

  const projected: AiuTaxRuleValue[] = rules.map((rule) => {
    const bucket = rule.bucket;
    if (!AIU_BUCKETS.includes(bucket) || bucket === 'costo') return { ...rule };
    const shouldBeTaxable = expected.includes(bucket);
    if (Boolean(rule.taxable) === shouldBeTaxable) return { ...rule };
    if (!shouldBeTaxable) {
      return { ...rule, taxable: false, rate: '0.00' };
    }
    const hasRealRate = (parsePercentScaled(rule.rate) ?? 0) > 0;
    return hasRealRate
      ? { ...rule, taxable: true }
      : {
          ...rule,
          taxable: true,
          tax_code: reference.tax_code,
          rate: reference.rate,
        };
  });

  const derived = derivedCostTaxRule(projected, basis);
  const costIndex = projected.findIndex((rule) => rule.bucket === 'costo');
  if (costIndex >= 0) {
    projected[costIndex] = derived;
  } else {
    projected.push(derived);
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
  const expected = AIU_TAXABLE_BUCKETS_BY_BASIS[basis];
  return rules
    .filter((rule) => {
      const bucket = rule.bucket;
      if (!AIU_BUCKETS.includes(bucket) || bucket === 'costo') return false;
      return Boolean(rule.taxable) !== expected.includes(bucket);
    })
    .map((rule) => rule.bucket);
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
