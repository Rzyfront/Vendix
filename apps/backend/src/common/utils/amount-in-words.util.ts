/**
 * NÚMERO A LETRAS EN ESPAÑOL — la única implementación del repositorio.
 *
 * POR QUÉ EXISTE — el defecto que cierra:
 *
 * La representación gráfica de un documento fiscal colombiano imprime el total
 * en letras al lado del total en cifras. Hasta ahora Vendix no imprimía ninguno
 * de los dos en letras y no existía utilidad para ello: `grep -rin
 * "numeroALetras|numberToWords|enLetras|toWords"` sobre `apps/backend/src` y
 * `apps/frontend/src` devolvía cero resultados.
 *
 * El riesgo de escribirlo mal no es estético. Un total en letras que discrepe
 * del total en cifras es una contradicción interna del documento legal, visible
 * para el adquiriente y para un revisor fiscal, sobre un consecutivo autorizado
 * que ya se quemó. De ahí las dos decisiones duras de este módulo:
 *
 *  1. **TRUNCA, no redondea.** El Anexo Técnico 1.9 §11.2 exige los importes
 *     truncados a 2 decimales y `dian-money.util.ts` ya trunca (`ROUND_DOWN`)
 *     todo lo que viaja al XML y al CUFE. Si aquí se redondeara, un importe con
 *     un tercer decimal diría «CON CINCUENTA Y UN CENTAVOS» donde el XML declara
 *     `,50`. Se trunca por la misma regla y por el mismo motivo.
 *  2. **No hace aritmética de coma flotante.** El importe se descompone leyendo
 *     su representación decimal en texto (`1234.56` → `"1234"` + `"56"`), nunca
 *     con `Math.round(x * 100)`. Multiplicar por 100 un `number` reintroduce
 *     exactamente el error que el truncado quiere evitar.
 *
 * ORTOGRAFÍA — las formas irregulares que un generador ingenuo se come:
 *
 *   · `quinientos` (no «cincocientos»), `setecientos` (no «sietecientos»),
 *     `novecientos` (no «nuevecientos»).
 *   · 16–29 se escriben soldadas y con tilde donde toca: `dieciséis`,
 *     `veintiuno`, `veintidós`, `veintitrés`, `veintiséis`.
 *   · `cien` es la forma EXACTA de 100; de 101 a 199 el numeral se apocopa a
 *     `ciento` («ciento uno»), y `cien` reaparece solo cuando 100 vuelve a ser
 *     exacto dentro de una escala («cien mil», «cien millones»).
 *   · `mil` nunca lleva «un» delante: 1000 es `mil`, no «un mil». En cambio
 *     1 000 000 sí es `un millón`, porque `millón` es un sustantivo y `mil` no.
 *   · Apócope ante sustantivo: 21 pesos son `veintiún pesos`, 31 son
 *     `treinta y un pesos`, pero 21 a secas es `veintiuno`. Por eso
 *     {@link spanishCardinal} distingue la forma libre de la adjetiva.
 *   · Concordancia de género: `un millón` (millón es masculino, siempre) frente
 *     a `una unidad` / `veintiuna unidades` / `doscientas unidades` cuando el
 *     sustantivo al que el numeral acompaña es femenino. El género se propaga a
 *     los grupos que acompañan al sustantivo final —incluido el que precede a
 *     `mil` («doscientas mil unidades», «veintiuna mil unidades»)— y NO a los
 *     que preceden a `millón`/`billón`, que son masculinos.
 *
 * ESCALA LARGA. El español usa escala larga: 10⁹ es `mil millones`, no «un
 * billón»; `billón` es 10¹². Eso sale gratis de la recursión por grupos de seis
 * dígitos y es la diferencia con cualquier port directo de una utilidad inglesa.
 *
 * TECHO. `invoices.total_amount` es `Decimal(12,2)`, así que el mayor importe
 * representable de una factura es `9 999 999 999,99`. La utilidad va bastante más
 * lejos (hasta `Number.MAX_SAFE_INTEGER` en la parte entera) y lanza
 * `RangeError` por encima, en vez de emitir letras silenciosamente equivocadas.
 */

/** Género gramatical del sustantivo al que acompaña el numeral. */
export type SpanishGender = 'masculine' | 'feminine';

/**
 * 0–29. De 16 en adelante el español los escribe soldados, así que no se pueden
 * derivar componiendo decena + unidad.
 */
const SMALL: readonly string[] = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];

/** Decenas de 30 a 90. Se componen con « y » ante la unidad. */
const TENS: readonly string[] = [
  '',
  '',
  '',
  'treinta',
  'cuarenta',
  'cincuenta',
  'sesenta',
  'setenta',
  'ochenta',
  'noventa',
];

/**
 * Centenas. `ciento` es la forma de 100 cuando le sigue algo; el caso exacto
 * (`cien`) se resuelve antes de mirar esta tabla.
 */
const HUNDREDS: readonly string[] = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];

/**
 * `doscientos` → `doscientas` cuando el sustantivo es femenino.
 *
 * La prueba se hace sobre `ientos` y NO sobre `cientos` a propósito:
 * `quinientos` es la única centena que no lleva la `c` («quinientos», no
 * «cincocientos»), así que un predicado sobre `cientos` la deja sin feminizar y
 * produce «quinientos libras». Es el mismo irregular que se cuela en cualquier
 * generador ingenuo, esta vez por la puerta de atrás.
 */
function applyGenderToHundred(word: string, gender: SpanishGender): string {
  return gender === 'feminine' && word.endsWith('ientos')
    ? `${word.slice(0, -2)}as`
    : word;
}

/**
 * Forma ADJETIVA de la unidad: la que acompaña a un sustantivo.
 * 1 → `un` / `una`; 21 → `veintiún` / `veintiuna`.
 */
function adjectivalOne(gender: SpanishGender, soldered: boolean): string {
  if (gender === 'feminine') return soldered ? 'veintiuna' : 'una';
  return soldered ? 'veintiún' : 'un';
}

/**
 * 0–999 en forma adjetiva (la que acompaña al sustantivo que sigue: `mil`,
 * `millones` o la propia moneda). La forma libre se obtiene después, en
 * {@link spanishCardinal}, revirtiendo la apócope del último término.
 */
function below1000(n: number, gender: SpanishGender): string {
  if (n < 30) {
    if (n === 1) return adjectivalOne(gender, false);
    if (n === 21) return adjectivalOne(gender, true);
    return SMALL[n];
  }

  if (n < 100) {
    const ten = Math.floor(n / 10);
    const unit = n % 10;
    if (unit === 0) return TENS[ten];
    return `${TENS[ten]} y ${unit === 1 ? adjectivalOne(gender, false) : SMALL[unit]}`;
  }

  // 100 exacto es `cien`; 101–199 apocopa a `ciento`.
  if (n === 100) return 'cien';

  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const head = applyGenderToHundred(HUNDREDS[hundred], gender);
  return rest === 0 ? head : `${head} ${below1000(rest, gender)}`;
}

/**
 * 0–999 999. `mil` es invariable y no admite «un» delante, así que 1000 es
 * `mil` a secas y 21 000 es `veintiún mil` (o `veintiuna mil` en femenino: el
 * numeral concuerda con el sustantivo final, no con `mil`).
 */
function below1e6(n: number, gender: SpanishGender): string {
  if (n < 1000) return below1000(n, gender);

  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? 'mil' : `${below1000(thousands, gender)} mil`;
  return rest === 0 ? head : `${head} ${below1000(rest, gender)}`;
}

/**
 * 0–(10¹² − 1). `millón`/`millones` es un sustantivo masculino: el numeral que
 * lo cuenta va SIEMPRE en masculino («doscientos millones de unidades»), y el
 * género del importe solo alcanza al resto que acompaña a la moneda.
 *
 * De aquí sale `mil millones` para 10⁹ sin ningún caso especial, que es la
 * escala larga del español.
 */
function below1e12(n: number, gender: SpanishGender): string {
  if (n < 1e6) return below1e6(n, gender);

  const millions = Math.floor(n / 1e6);
  const rest = n % 1e6;
  const head =
    millions === 1 ? 'un millón' : `${below1e6(millions, 'masculine')} millones`;
  return rest === 0 ? head : `${head} ${below1e6(rest, gender)}`;
}

/** Igual que {@link below1e12} una escala más arriba: `billón` = 10¹². */
function integerToWords(n: number, gender: SpanishGender): string {
  if (n < 1e12) return below1e12(n, gender);

  const billions = Math.floor(n / 1e12);
  const rest = n % 1e12;
  const head =
    billions === 1 ? 'un billón' : `${below1e6(billions, 'masculine')} billones`;
  return rest === 0 ? head : `${head} ${below1e12(rest, gender)}`;
}

export interface SpanishCardinalOptions {
  /**
   * Género del sustantivo al que acompaña el numeral. Por defecto masculino,
   * que es el de `peso`.
   */
  gender?: SpanishGender;
  /**
   * `true` cuando el numeral acompaña a un sustantivo y por tanto apocopa
   * (`veintiún pesos`). `false` (por defecto) da la forma libre, la que se dice
   * al contar en voz alta (`veintiuno`).
   */
  adjectival?: boolean;
}

/**
 * Entero no negativo a letras.
 *
 * @throws RangeError si el valor no es un entero seguro no negativo.
 */
export function spanishCardinal(
  value: number,
  options: SpanishCardinalOptions = {},
): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `spanishCardinal espera un entero no negativo; recibió ${value}`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `spanishCardinal no puede representar ${value} sin perder precisión ` +
        `(máximo ${Number.MAX_SAFE_INTEGER})`,
    );
  }

  const gender = options.gender ?? 'masculine';
  const words = integerToWords(value, gender);

  if (options.adjectival) return words;

  // La composición se hace siempre en forma adjetiva porque cada grupo
  // interno acompaña a `mil`/`millones`. La forma libre solo difiere en el
  // ÚLTIMO término, y solo cuando ese término es la unidad apocopada.
  if (gender === 'feminine') return words;
  if (words === 'un') return 'uno';
  if (words.endsWith(' un')) return `${words.slice(0, -3)} uno`;
  if (words === 'veintiún') return 'veintiuno';
  if (words.endsWith(' veintiún')) return `${words.slice(0, -9)} veintiuno`;
  return words;
}

/** Sustantivo contable con su género, para concordar el numeral. */
export interface CountedNoun {
  singular: string;
  plural: string;
  gender?: SpanishGender;
}

export interface AmountInWordsOptions {
  /** Unidad monetaria. Por defecto `peso`/`pesos` (masculino). */
  unit?: CountedNoun;
  /** Fracción de la unidad. Por defecto `centavo`/`centavos` (masculino). */
  fraction?: CountedNoun;
  /** Decimales de la fracción. Por defecto 2. */
  fractionDigits?: number;
  /**
   * Cuándo decir la fracción:
   *  · `nonzero` (por defecto) — solo si hay céntimos.
   *  · `always` — siempre, incluso «CON CERO CENTAVOS».
   *  · `never` — nunca; el importe se trunca a la unidad.
   */
  fractionMode?: 'nonzero' | 'always' | 'never';
  /**
   * Sufijo literal que se pega al final, p. ej. `M/CTE` («moneda corriente»),
   * que es lo que la práctica colombiana imprime en la factura. Vacío por
   * defecto: es una convención comercial, no una exigencia del anexo.
   */
  suffix?: string;
  /** Mayúsculas, como se imprime en el documento. Por defecto `true`. */
  uppercase?: boolean;
}

const DEFAULT_UNIT: CountedNoun = {
  singular: 'peso',
  plural: 'pesos',
  gender: 'masculine',
};

const DEFAULT_FRACTION: CountedNoun = {
  singular: 'centavo',
  plural: 'centavos',
  gender: 'masculine',
};

/** Descomposición decimal exacta de un importe, sin coma flotante. */
interface DecimalParts {
  negative: boolean;
  /** Parte entera en dígitos, sin ceros a la izquierda superfluos. */
  integer: string;
  /** Parte fraccionaria en dígitos, ya truncada y rellenada a la escala. */
  fraction: string;
}

/**
 * Lee un importe como texto decimal y lo parte en signo, entero y fracción
 * TRUNCADA a `digits`.
 *
 * Acepta `number` y `string` porque `Prisma.Decimal` llega como texto y un
 * `number` intermedio ya habría perdido la escala. Para `number` se usa
 * `String(n)`, que da la representación decimal más corta que reconstruye el
 * mismo valor: `String(0.13) === '0.13'`, mientras que `(0.13).toFixed(8)` da
 * `'0.13000000'` pero `(0.145).toFixed(2)` redondearía a `'0.15'`.
 */
function splitDecimal(
  value: number | string,
  digits: number,
): DecimalParts {
  let raw: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Importe no finito: ${value}`);
    }
    raw = String(value);
  } else {
    raw = value.trim();
  }

  const match = /^([+-]?)(\d*)(?:[.,](\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match || (!match[2] && !match[3])) {
    throw new RangeError(`Importe no numérico: ${JSON.stringify(raw)}`);
  }

  const negative = match[1] === '-';
  let digitsAll = `${match[2] || ''}${match[3] || ''}`;
  // Posición del punto decimal contada desde la izquierda de `digitsAll`.
  let point = (match[2] || '').length + (match[4] ? parseInt(match[4], 10) : 0);

  if (point <= 0) {
    digitsAll = `${'0'.repeat(1 - point)}${digitsAll}`;
    point = 1;
  } else if (point > digitsAll.length) {
    digitsAll = `${digitsAll}${'0'.repeat(point - digitsAll.length)}`;
  }

  const integer = digitsAll.slice(0, point).replace(/^0+(?=\d)/, '');
  const fractionRaw = digitsAll.slice(point);
  // Truncado, nunca redondeo: Anexo 1.9 §11.2.
  const fraction = fractionRaw.slice(0, digits).padEnd(digits, '0');

  return { negative, integer, fraction };
}

/**
 * `millón`, `millones`, `billón` y `billones` son SUSTANTIVOS, no numerales, así
 * que el nombre de lo contado se les une con la preposición `de`: «un millón DE
 * pesos», «mil millones DE pesos». `mil` sí es numeral y no la lleva («mil
 * pesos»), y la preposición desaparece en cuanto hay resto por debajo del
 * millón, porque entonces el sustantivo ya no va pegado a la escala: «cinco
 * millones trescientos cincuenta y cinco mil pesos».
 */
const SCALE_NOUNS = ['millón', 'millones', 'billón', 'billones'] as const;

function needsDeBeforeNoun(numeral: string): boolean {
  return SCALE_NOUNS.some(
    (scale) => numeral === scale || numeral.endsWith(` ${scale}`),
  );
}

/** Numeral concordado con `noun`, en la forma adjetiva que exige acompañarlo. */
function countedPhrase(count: number, noun: CountedNoun): string {
  const gender = noun.gender ?? 'masculine';
  const numeral = spanishCardinal(count, { gender, adjectival: true });
  const word = count === 1 ? noun.singular : noun.plural;
  const link = needsDeBeforeNoun(numeral) ? ' de ' : ' ';
  return `${numeral}${link}${word}`;
}

/**
 * Importe monetario a letras.
 *
 * @example
 * amountToSpanishWords(5355000)                       // 'CINCO MILLONES TRESCIENTOS CINCUENTA Y CINCO MIL PESOS'
 * amountToSpanishWords(1, { suffix: 'M/CTE' })        // 'UN PESO M/CTE'
 * amountToSpanishWords('1234.56')                     // 'MIL DOSCIENTOS TREINTA Y CUATRO PESOS CON CINCUENTA Y SEIS CENTAVOS'
 *
 * @throws RangeError si el importe no es numérico, no es finito, o su parte
 *   entera excede `Number.MAX_SAFE_INTEGER`.
 */
export function amountToSpanishWords(
  amount: number | string,
  options: AmountInWordsOptions = {},
): string {
  const unit = options.unit ?? DEFAULT_UNIT;
  const fractionNoun = options.fraction ?? DEFAULT_FRACTION;
  const fractionDigits = options.fractionDigits ?? 2;
  const fractionMode = options.fractionMode ?? 'nonzero';
  const uppercase = options.uppercase ?? true;

  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new RangeError(
      `fractionDigits debe ser un entero no negativo; recibió ${fractionDigits}`,
    );
  }

  const parts = splitDecimal(
    amount,
    fractionMode === 'never' ? 0 : fractionDigits,
  );

  const integerValue = Number(parts.integer);
  if (!Number.isSafeInteger(integerValue)) {
    throw new RangeError(
      `Parte entera fuera del rango representable: ${parts.integer}`,
    );
  }
  const fractionValue = parts.fraction ? Number(parts.fraction) : 0;

  const segments: string[] = [];
  if (parts.negative && (integerValue > 0 || fractionValue > 0)) {
    segments.push('menos');
  }
  segments.push(countedPhrase(integerValue, unit));

  const sayFraction =
    fractionMode === 'always' ||
    (fractionMode === 'nonzero' && fractionValue > 0);
  if (sayFraction && fractionDigits > 0) {
    segments.push('con', countedPhrase(fractionValue, fractionNoun));
  }

  if (options.suffix) segments.push(options.suffix);

  const sentence = segments.join(' ');
  return uppercase ? sentence.toLocaleUpperCase('es-CO') : sentence;
}
