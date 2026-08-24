import {
  amountToSpanishWords,
  spanishCardinal,
} from './amount-in-words.util';

/**
 * INVERSA INDEPENDIENTE, escrita a propósito dentro de la spec.
 *
 * La prueba de propiedad exige reconstruir el número desde las letras. Si el
 * parser viviera en producción compartiría constantes con el generador y un
 * error simétrico (p. ej. «cincocientos» en las dos tablas) pasaría inadvertido.
 * Aquí las tablas se reescriben a mano, así que la prueba compara dos
 * implementaciones que solo coinciden si ambas dicen español.
 */
const WORD_VALUES: Record<string, number> = {
  cero: 0,
  uno: 1,
  un: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciséis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintiún: 21,
  veintiuna: 21,
  veintidós: 22,
  veintitrés: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiséis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};

const WORD_SCALES: Record<string, number> = {
  mil: 1e3,
  millón: 1e6,
  millones: 1e6,
  billón: 1e12,
  billones: 1e12,
};

/** Letras → entero. Lanza ante cualquier token que el español no admita. */
function wordsToInteger(phrase: string): number {
  const tokens = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let total = 0;
  let group = 0;

  for (const token of tokens) {
    if (token === 'y' || token === 'de') continue;

    if (token in WORD_VALUES) {
      group += WORD_VALUES[token];
      continue;
    }

    if (token in WORD_SCALES) {
      const scale = WORD_SCALES[token];
      if (scale === 1e3) {
        group = (group || 1) * 1e3;
      } else {
        total += (group || 1) * scale;
        group = 0;
      }
      continue;
    }

    throw new Error(`Token no reconocido en «${phrase}»: ${token}`);
  }

  return total + group;
}

/** Letras de un importe → `{ units, cents }`, con signo aplicado a units. */
function wordsToAmount(phrase: string): { units: number; cents: number } {
  let text = phrase.trim().toLowerCase();
  let sign = 1;
  if (text.startsWith('menos ')) {
    sign = -1;
    text = text.slice('menos '.length);
  }
  text = text.replace(/\s+m\/cte$/, '');

  const [unitsPart, centsPart] = text.split(/\s+con\s+/);
  const stripNoun = (part: string, ...nouns: string[]) => {
    const tokens = part.trim().split(/\s+/);
    const last = tokens[tokens.length - 1];
    if (!nouns.includes(last)) {
      throw new Error(`Falta el sustantivo (${nouns.join('/')}) en «${part}»`);
    }
    return tokens.slice(0, -1).join(' ');
  };

  return {
    units: sign * wordsToInteger(stripNoun(unitsPart, 'peso', 'pesos')),
    cents: centsPart
      ? wordsToInteger(stripNoun(centsPart, 'centavo', 'centavos'))
      : 0,
  };
}

describe('spanishCardinal', () => {
  describe('casos frontera del español', () => {
    const free: ReadonlyArray<[number, string]> = [
      [0, 'cero'],
      [1, 'uno'],
      [6, 'seis'],
      [11, 'once'],
      [15, 'quince'],
      [16, 'dieciséis'],
      [17, 'diecisiete'],
      [20, 'veinte'],
      [21, 'veintiuno'],
      [22, 'veintidós'],
      [26, 'veintiséis'],
      [30, 'treinta'],
      [31, 'treinta y uno'],
      [99, 'noventa y nueve'],
      [100, 'cien'],
      [101, 'ciento uno'],
      [115, 'ciento quince'],
      [121, 'ciento veintiuno'],
      [200, 'doscientos'],
      [500, 'quinientos'],
      [700, 'setecientos'],
      [900, 'novecientos'],
      [999, 'novecientos noventa y nueve'],
      [1000, 'mil'],
      [1001, 'mil uno'],
      [1100, 'mil cien'],
      [2000, 'dos mil'],
      [21000, 'veintiún mil'],
      [100000, 'cien mil'],
      [500000, 'quinientos mil'],
      [1000000, 'un millón'],
      [2000000, 'dos millones'],
      [21000000, 'veintiún millones'],
      [100000000, 'cien millones'],
      [1000000000, 'mil millones'],
      [2000000000, 'dos mil millones'],
      [1000000000000, 'un billón'],
      [2000000000000, 'dos billones'],
    ];

    it.each(free)('%i → «%s»', (value, expected) => {
      expect(spanishCardinal(value)).toBe(expected);
    });
  });

  describe('formas irregulares que un generador ingenuo se come', () => {
    it('500 es quinientos, nunca «cincocientos»', () => {
      expect(spanishCardinal(500)).toBe('quinientos');
      expect(spanishCardinal(500)).not.toContain('cinco');
    });

    it('700 es setecientos, nunca «sietecientos»', () => {
      expect(spanishCardinal(700)).toBe('setecientos');
      expect(spanishCardinal(700)).not.toContain('siete');
    });

    it('900 es novecientos, nunca «nuevecientos»', () => {
      expect(spanishCardinal(900)).toBe('novecientos');
      expect(spanishCardinal(900)).not.toContain('nueve');
    });

    it('100 exacto es «cien» y 101 apocopa a «ciento»', () => {
      expect(spanishCardinal(100)).toBe('cien');
      expect(spanishCardinal(101)).toBe('ciento uno');
      expect(spanishCardinal(199)).toBe('ciento noventa y nueve');
    });

    it('«cien» reaparece cuando 100 es exacto dentro de una escala', () => {
      expect(spanishCardinal(100000)).toBe('cien mil');
      expect(spanishCardinal(100000000)).toBe('cien millones');
      expect(spanishCardinal(101000)).toBe('ciento un mil');
    });

    it('21 se escribe soldado y con tilde', () => {
      expect(spanishCardinal(21)).toBe('veintiuno');
      expect(spanishCardinal(21, { adjectival: true })).toBe('veintiún');
    });

    it('1000 es «mil», nunca «un mil»; 10^6 sí es «un millón»', () => {
      expect(spanishCardinal(1000)).toBe('mil');
      expect(spanishCardinal(1000000)).toBe('un millón');
    });

    it('la escala es LARGA: 10^9 es «mil millones», no «un billón»', () => {
      expect(spanishCardinal(1e9)).toBe('mil millones');
      expect(spanishCardinal(1e12)).toBe('un billón');
    });
  });

  describe('apócope y género', () => {
    it('la forma adjetiva apocopa ante sustantivo', () => {
      expect(spanishCardinal(1, { adjectival: true })).toBe('un');
      expect(spanishCardinal(31, { adjectival: true })).toBe('treinta y un');
      expect(spanishCardinal(101, { adjectival: true })).toBe('ciento un');
      expect(spanishCardinal(1001, { adjectival: true })).toBe('mil un');
    });

    it('el femenino concuerda con el sustantivo, no con la escala', () => {
      const f = { gender: 'feminine' as const, adjectival: true };
      expect(spanishCardinal(1, f)).toBe('una');
      expect(spanishCardinal(21, f)).toBe('veintiuna');
      expect(spanishCardinal(31, f)).toBe('treinta y una');
      expect(spanishCardinal(200, f)).toBe('doscientas');
      // `quinientos` no lleva la `c` de las demás centenas: es la que se cuela
      // sin feminizar si el predicado busca «cientos» en vez de «ientos».
      expect(spanishCardinal(500, f)).toBe('quinientas');
      expect(spanishCardinal(700, f)).toBe('setecientas');
      expect(spanishCardinal(900, f)).toBe('novecientas');
      expect(spanishCardinal(521, f)).toBe('quinientas veintiuna');
      expect(spanishCardinal(200000, f)).toBe('doscientas mil');
      expect(spanishCardinal(21000, f)).toBe('veintiuna mil');
    });

    it('«millón» y «billón» son masculinos y no se feminizan', () => {
      const f = { gender: 'feminine' as const, adjectival: true };
      expect(spanishCardinal(1000000, f)).toBe('un millón');
      expect(spanishCardinal(200000000, f)).toBe('doscientos millones');
      expect(spanishCardinal(1e12, f)).toBe('un billón');
    });
  });

  describe('rechazos', () => {
    it.each([-1, 1.5, NaN, Infinity])('rechaza %p', (value) => {
      expect(() => spanishCardinal(value)).toThrow(RangeError);
    });

    it('rechaza por encima de MAX_SAFE_INTEGER en vez de mentir', () => {
      expect(() => spanishCardinal(2 ** 53)).toThrow(RangeError);
    });
  });
});

describe('amountToSpanishWords', () => {
  it('cero pesos', () => {
    expect(amountToSpanishWords(0)).toBe('CERO PESOS');
  });

  it('un peso en singular, dos en plural', () => {
    expect(amountToSpanishWords(1)).toBe('UN PESO');
    expect(amountToSpanishWords(2)).toBe('DOS PESOS');
  });

  it('apocopa ante el sustantivo de la moneda', () => {
    expect(amountToSpanishWords(21)).toBe('VEINTIÚN PESOS');
    expect(amountToSpanishWords(31)).toBe('TREINTA Y UN PESOS');
    expect(amountToSpanishWords(101)).toBe('CIENTO UN PESOS');
  });

  it('dice los centavos y solo cuando existen', () => {
    expect(amountToSpanishWords('1234.56')).toBe(
      'MIL DOSCIENTOS TREINTA Y CUATRO PESOS CON CINCUENTA Y SEIS CENTAVOS',
    );
    expect(amountToSpanishWords('1234.00')).toBe(
      'MIL DOSCIENTOS TREINTA Y CUATRO PESOS',
    );
    expect(amountToSpanishWords('0.01')).toBe('CERO PESOS CON UN CENTAVO');
  });

  it('«always» dice los centavos en cero y «never» los calla', () => {
    expect(amountToSpanishWords(1000, { fractionMode: 'always' })).toBe(
      'MIL PESOS CON CERO CENTAVOS',
    );
    expect(amountToSpanishWords('1000.99', { fractionMode: 'never' })).toBe(
      'MIL PESOS',
    );
  });

  it('TRUNCA los centavos, no los redondea (Anexo 1.9 §11.2)', () => {
    // Redondear diría «SESENTA CENTAVOS» donde el XML declara ,59.
    expect(amountToSpanishWords('10.599')).toBe(
      'DIEZ PESOS CON CINCUENTA Y NUEVE CENTAVOS',
    );
    expect(amountToSpanishWords('10.005')).toBe('DIEZ PESOS');
  });

  it('no pierde el centavo por coma flotante', () => {
    // (0.13).toFixed(8) === '0.13000000' pero 0.1 + 0.03 === 0.13000000000000003
    expect(amountToSpanishWords(0.1 + 0.03)).toBe(
      'CERO PESOS CON TRECE CENTAVOS',
    );
    expect(amountToSpanishWords(0.29)).toBe(
      'CERO PESOS CON VEINTINUEVE CENTAVOS',
    );
  });

  it('pega el sufijo de moneda corriente sin tocar el numeral', () => {
    expect(amountToSpanishWords(5355000, { suffix: 'M/CTE' })).toBe(
      'CINCO MILLONES TRESCIENTOS CINCUENTA Y CINCO MIL PESOS M/CTE',
    );
  });

  it('el mayor importe de una factura — Decimal(12,2)', () => {
    expect(amountToSpanishWords('9999999999.99')).toBe(
      'NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE MILLONES ' +
        'NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE PESOS ' +
        'CON NOVENTA Y NUEVE CENTAVOS',
    );
  });

  it('concuerda con una unidad monetaria femenina', () => {
    const libra = {
      unit: { singular: 'libra', plural: 'libras', gender: 'feminine' as const },
      fraction: {
        singular: 'penique',
        plural: 'peniques',
        gender: 'masculine' as const,
      },
    };
    expect(amountToSpanishWords(1, libra)).toBe('UNA LIBRA');
    expect(amountToSpanishWords(21, libra)).toBe('VEINTIUNA LIBRAS');
    expect(amountToSpanishWords(200, libra)).toBe('DOSCIENTAS LIBRAS');
    // `millón` sigue siendo masculino aunque la moneda sea femenina.
    expect(amountToSpanishWords(1000000, libra)).toBe('UN MILLÓN DE LIBRAS');
    expect(amountToSpanishWords('1.01', libra)).toBe('UNA LIBRA CON UN PENIQUE');
  });

  describe('«millón» es sustantivo y pide la preposición «de»', () => {
    it('la lleva cuando la escala queda pegada al sustantivo', () => {
      expect(amountToSpanishWords(1_000_000)).toBe('UN MILLÓN DE PESOS');
      expect(amountToSpanishWords(2_000_000)).toBe('DOS MILLONES DE PESOS');
      expect(amountToSpanishWords(1e9)).toBe('MIL MILLONES DE PESOS');
      expect(amountToSpanishWords(1e12)).toBe('UN BILLÓN DE PESOS');
    });

    it('la pierde en cuanto hay resto por debajo del millón', () => {
      expect(amountToSpanishWords(1_000_100)).toBe('UN MILLÓN CIEN PESOS');
      expect(amountToSpanishWords(5_355_000)).toBe(
        'CINCO MILLONES TRESCIENTOS CINCUENTA Y CINCO MIL PESOS',
      );
    });

    it('«mil» es numeral y nunca la lleva', () => {
      expect(amountToSpanishWords(1000)).toBe('MIL PESOS');
      expect(amountToSpanishWords(100_000)).toBe('CIEN MIL PESOS');
    });
  });

  it('un importe negativo se dice, no se esconde', () => {
    expect(amountToSpanishWords('-1500.50')).toBe(
      'MENOS MIL QUINIENTOS PESOS CON CINCUENTA CENTAVOS',
    );
    expect(amountToSpanishWords('-0.00')).toBe('CERO PESOS');
  });

  it('minúsculas cuando el consumidor las pide', () => {
    expect(amountToSpanishWords(101, { uppercase: false })).toBe(
      'ciento un pesos',
    );
  });

  it.each(['', 'abc', '1.2.3', '$1000'])('rechaza «%s»', (raw) => {
    expect(() => amountToSpanishWords(raw)).toThrow(RangeError);
  });

  it('rechaza un importe no finito', () => {
    expect(() => amountToSpanishWords(Number.NaN)).toThrow(RangeError);
    expect(() => amountToSpanishWords(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});

describe('propiedad: las letras reconstruyen el importe', () => {
  /** LCG determinista — la prueba debe fallar igual en cada corrida. */
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  it('reconstruye 2000 importes aleatorios de Decimal(12,2)', () => {
    const random = makeRandom(20260824);
    for (let i = 0; i < 2000; i++) {
      const units = Math.floor(random() * 10_000_000_000);
      const cents = Math.floor(random() * 100);
      const amount = `${units}.${String(cents).padStart(2, '0')}`;

      const words = amountToSpanishWords(amount, {
        uppercase: false,
        fractionMode: 'always',
      });
      const parsed = wordsToAmount(words);

      expect({ amount, ...parsed }).toEqual({ amount, units, cents });
    }
  });

  it('reconstruye todos los enteros de 0 a 2000, donde vive cada irregular', () => {
    for (let n = 0; n <= 2000; n++) {
      expect(wordsToInteger(spanishCardinal(n))).toBe(n);
      expect(wordsToInteger(spanishCardinal(n, { adjectival: true }))).toBe(n);
    }
  });

  it('reconstruye las fronteras de escala', () => {
    const boundaries = [
      999, 1000, 1001, 9999, 10_000, 100_000, 999_999, 1_000_000, 1_000_001,
      999_999_999, 1_000_000_000, 1_000_000_001, 999_999_999_999,
      1_000_000_000_000, 1_000_000_000_001,
    ];
    for (const n of boundaries) {
      expect(wordsToInteger(spanishCardinal(n))).toBe(n);
    }
  });
});
