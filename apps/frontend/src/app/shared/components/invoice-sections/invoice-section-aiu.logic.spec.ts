import {
  aiuBucketListLabel,
  aiuSuggestionPlan,
  aiuTaxSuggestionOrigin,
  aiuTaxSuggestions,
  aiuTaxableComponents,
} from './invoice-section-aiu.logic';
import type { AiuTaxRuleValue } from './invoice-section-aiu.logic';

/**
 * La sugerencia de tributos, probada donde es PURA.
 *
 * La propiedad que estas pruebas existen para custodiar es la segunda de la
 * lista de C.4 y la que este tipo de función falla siempre: **quitar un tributo
 * sugerido no lo puede volver a poner**. Si la sugerencia se recalculara sólo
 * sobre el estado de la matriz, quitar la fila la haría reaparecer como
 * sugerencia — el operador quita, la pantalla repone. La prueba «sin memoria de
 * descarte reaparece» deja ese defecto escrito al lado del arreglo, para que
 * quien borre el parámetro `dismissed` vea exactamente qué vuelve.
 *
 * La otra propiedad custodiada es que una sugerencia SIN tarifa determinada
 * (`rate: null`) no es aplicable. El validador del contrato fija las tarifas
 * admisibles del IVA y del INC y NO fija ninguna para las retenciones, así que
 * proponer un porcentaje de retefuente sería inventarlo — y un número inventado
 * en una casilla de impuestos se guarda igual que uno correcto.
 */
describe('invoice-section-aiu.logic · sugerencia de tributos', () => {
  const ivaMatrix: AiuTaxRuleValue[] = [
    { bucket: 'administracion', taxable: true, tax_code: '01', rate: '19.00' },
    { bucket: 'imprevistos', taxable: true, tax_code: '01', rate: '19.00' },
    { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
    { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
  ];

  /** Base «sólo Utilidad»: las otras dos porciones conservan el código con
   *  `taxable:false`. Es el caso que distingue «declarado» de «presente». */
  const utilidadMatrix: AiuTaxRuleValue[] = [
    { bucket: 'administracion', taxable: false, tax_code: '01', rate: '0.00' },
    { bucket: 'imprevistos', taxable: false, tax_code: '01', rate: '0.00' },
    { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
    { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
  ];

  describe('aiuTaxSuggestions', () => {
    it('no sugiere nada sin responsabilidades', () => {
      expect(aiuTaxSuggestions({ responsibilities: [], rules: [] })).toEqual([]);
    });

    it('no inventa sugerencias para las responsabilidades que no dicen nada del documento', () => {
      // O-15 autorretenedor retiene sobre sus PROPIOS ingresos; O-49 no
      // responsable de IVA no quita el IVA del documento, que lo decide el
      // servicio y el emisor.
      const out = aiuTaxSuggestions({
        responsibilities: ['O-15', 'O-47', 'O-49', 'R-99-PN', 'O-14', 'O-16'],
        rules: [],
      });
      expect(out).toEqual([]);
    });

    it('deriva IVA al 19,00 % de «Responsable de IVA»', () => {
      const out = aiuTaxSuggestions({
        responsibilities: ['O-48'],
        rules: [],
      });
      expect(out.length).toBe(1);
      expect(out[0].tax_code).toBe('01');
      expect(out[0].rate).toBe('19.00');
      expect(out[0].tax_label).toBe('IVA (01)');
      expect(aiuTaxSuggestionOrigin(out[0])).toBe(
        'Sugerido por «Responsable de IVA» (O-48) en las responsabilidades fiscales del cliente.',
      );
    });

    it('junta en UNA sugerencia las dos responsabilidades que insinúan el mismo tributo', () => {
      const out = aiuTaxSuggestions({
        responsibilities: ['O-48', 'O-17'],
        rules: [],
      });
      expect(out.length).toBe(1);
      expect(out[0].sources.length).toBe(2);
    });

    it('no propone tarifa donde la ley no fija una sola', () => {
      const out = aiuTaxSuggestions({
        responsibilities: ['O-13', 'O-19'],
        rules: [],
      });
      expect(out.map((suggestion) => suggestion.tax_code)).toEqual(['06', '04']);
      expect(out.every((suggestion) => suggestion.rate === null)).toBe(true);
    });

    it('no sugiere un tributo que la matriz ya declara gravable', () => {
      expect(
        aiuTaxSuggestions({ responsibilities: ['O-48'], rules: ivaMatrix }),
      ).toEqual([]);
      expect(
        aiuTaxSuggestions({ responsibilities: ['O-48'], rules: utilidadMatrix }),
      ).toEqual([]);
    });

    it('una fila con el código pero NO gravable no cuenta como declarada', () => {
      const out = aiuTaxSuggestions({
        responsibilities: ['O-48'],
        rules: [
          {
            bucket: 'administracion',
            taxable: false,
            tax_code: '01',
            rate: '0.00',
          },
        ],
      });
      expect(out.length).toBe(1);
    });

    it('QUITAR un tributo sugerido no lo vuelve a poner', () => {
      // 1. Se sugiere.
      expect(
        aiuTaxSuggestions({ responsibilities: ['O-48'], rules: [] }).length,
      ).toBe(1);
      // 2. Aplicado, desaparece.
      expect(
        aiuTaxSuggestions({ responsibilities: ['O-48'], rules: ivaMatrix })
          .length,
      ).toBe(0);
      // 3. EL DEFECTO, escrito: sin memoria del descarte, quitar la fila lo
      //    repone tal cual.
      expect(
        aiuTaxSuggestions({ responsibilities: ['O-48'], rules: [] }).length,
      ).toBe(1);
      // 4. Con la memoria del descarte, no vuelve.
      expect(
        aiuTaxSuggestions({
          responsibilities: ['O-48'],
          rules: [],
          dismissed: new Set(['01']),
        }),
      ).toEqual([]);
    });

    it('descartar un tributo no descarta los demás', () => {
      const out = aiuTaxSuggestions({
        responsibilities: ['O-48', 'O-13'],
        rules: [],
        dismissed: new Set(['01']),
      });
      expect(out.map((suggestion) => suggestion.tax_code)).toEqual(['06']);
    });
  });

  describe('aiuTaxableComponents', () => {
    it('consulta la tabla del contrato para cada base, y nunca devuelve el costo', () => {
      expect(aiuTaxableComponents('aiu')).toEqual([
        'administracion',
        'imprevistos',
        'utilidad',
      ]);
      expect(aiuTaxableComponents('utilidad')).toEqual(['utilidad']);
      expect(aiuTaxableComponents('subtotal')).toEqual([
        'administracion',
        'imprevistos',
        'utilidad',
      ]);
    });
  });

  describe('aiuSuggestionPlan', () => {
    const iva = aiuTaxSuggestions({ responsibilities: ['O-48'], rules: [] })[0];

    it('escribe las porciones que la base grava y ninguna más', () => {
      expect(
        aiuSuggestionPlan({ suggestion: iva, rules: [], basis: 'aiu' }).writes,
      ).toEqual(['administracion', 'imprevistos', 'utilidad']);
      expect(
        aiuSuggestionPlan({ suggestion: iva, rules: [], basis: 'utilidad' })
          .writes,
      ).toEqual(['utilidad']);
    });

    it('respeta la porción que ya declara OTRO tributo en vez de reemplazarlo', () => {
      // La matriz admite UNA regla por porción (`TAX_BUCKET_DUPLICATED`), así
      // que escribir ahí no sería añadir un tributo: sería reemplazar el que
      // alguien eligió.
      const plan = aiuSuggestionPlan({
        suggestion: iva,
        rules: [
          { bucket: 'imprevistos', taxable: true, tax_code: '04', rate: '8.00' },
        ],
        basis: 'aiu',
      });
      expect(plan.keeps).toEqual([{ bucket: 'imprevistos', tax_code: '04' }]);
      expect(plan.writes).toEqual(['administracion', 'utilidad']);
    });
  });

  describe('aiuBucketListLabel', () => {
    it('enumera en español, sin coma antes de la «y»', () => {
      expect(
        aiuBucketListLabel(['administracion', 'imprevistos', 'utilidad']),
      ).toBe('Administración, Imprevistos y Utilidad');
      expect(aiuBucketListLabel(['administracion', 'utilidad'])).toBe(
        'Administración y Utilidad',
      );
      expect(aiuBucketListLabel(['utilidad'])).toBe('Utilidad');
      expect(aiuBucketListLabel([])).toBe('');
    });
  });
});
