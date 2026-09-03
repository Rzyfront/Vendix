/**
 * [print-editor-dsk] — Compuerta de exhaustividad entre el universo cerrado
 * `PrintSectionTypeEnum` (`enums/print-format.enum.ts`) y los `case`
 * realmente despachados por `PrintLayoutComposerService.renderSection()`
 * en el `switch (section.type)`.
 *
 * Estilo tomado de `__tests__/paper-definitions-parity.spec.ts` — este spec
 * también hace introspección de FUENTE (no de comportamiento en runtime):
 * lee el `.ts` del compositor con `fs.readFileSync`, extrae con una
 * expresión regular todos los `case '<x>':` dentro del bloque del switch, y
 * compara el conjunto extraído contra `PRINT_SECTION_TYPES` con una
 * diferencia de conjuntos real — no una aserción de "coinciden" sin haber
 * comparado.
 *
 * Por qué introspección de fuente y no un test de comportamiento: un test
 * que llamara `compose()` con una sección de cada tipo y verificara el HTML
 * de salida no distinguiría "cae en un `case` con nombre" de "cae en el
 * `default` genérico" — ambos pueden producir HTML no vacío. La única
 * forma de afirmar que el switch NOMBRA los 21 tipos (y no solo los tolera
 * vía `default`) es leer el código fuente y contar los `case` literalmente.
 *
 * Si este test falla:
 *  - `missingFromEnum` no vacío → el compositor ganó un `case` nuevo sin su
 *    entrada correspondiente en `PrintSectionTypeEnum`.
 *  - `missingFromComposer` no vacío → el enum declara un tipo que el
 *    compositor ya no despacha (o nunca despachó) con un `case` propio.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PRINT_SECTION_TYPES } from '../../enums/print-format.enum';

const COMPOSER_PATH = path.join(__dirname, '..', 'print-layout-composer.service.ts');

const SWITCH_MARKER = 'switch (section.type) {';

/**
 * Extrae, del `switch (section.type) { ... }` del compositor, todos los
 * literales de `case '<x>':` en el orden en que aparecen. Acota el bloque
 * con conteo de profundidad de llaves desde la apertura del switch hasta su
 * cierre — el bloque no contiene ninguna otra llave anidada (cada `case`
 * es un `return this.render...(...)` de una sola línea), así que el conteo
 * simple es exacto.
 */
function extractSectionTypeCases(source: string): string[] {
  const markerIdx = source.indexOf(SWITCH_MARKER);
  if (markerIdx === -1) {
    throw new Error(
      `No se encontró "${SWITCH_MARKER}" en print-layout-composer.service.ts — ` +
        'el compositor cambió de forma y este spec ya no puede introspectarlo. ' +
        'Actualiza SWITCH_MARKER o la lógica de extracción.',
    );
  }

  const braceStart = markerIdx + SWITCH_MARKER.length - 1; // índice de la '{' de apertura
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }
  if (braceEnd === -1) {
    throw new Error('Llaves desbalanceadas al buscar el cierre de switch (section.type) { ... }.');
  }

  const block = source.slice(braceStart, braceEnd + 1);
  const caseRegex = /case\s+'([^']+)'\s*:/g;
  const cases: string[] = [];
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = caseRegex.exec(block)) !== null) {
    cases.push(match[1]);
  }
  return cases;
}

describe('print-layout-composer — exhaustividad de section.type', () => {
  const source = fs.readFileSync(COMPOSER_PATH, 'utf-8');
  const extractedCases = extractSectionTypeCases(source);

  it('sanity check: la extracción realmente encontró case statements', () => {
    // Guarda contra un falso-verde silencioso: si el regex o el marcador
    // dejaran de matchear, `extractedCases` sería `[]` y la comparación de
    // conjuntos de abajo "pasaría" vacía-contra-vacía sin haber probado nada.
    expect(extractedCases.length).toBeGreaterThan(0);
  });

  it('los case extraídos del switch no tienen duplicados', () => {
    const asSet = new Set(extractedCases);
    expect(asSet.size).toBe(extractedCases.length);
  });

  it('PRINT_SECTION_TYPES coincide EXACTAMENTE con los case de switch (section.type)', () => {
    const extractedSet = new Set(extractedCases);
    const enumSet = new Set(PRINT_SECTION_TYPES as string[]);

    const missingFromEnum = extractedCases.filter((c) => !enumSet.has(c));
    const missingFromComposer = (PRINT_SECTION_TYPES as string[]).filter(
      (t) => !extractedSet.has(t),
    );

    expect({ missingFromEnum, missingFromComposer }).toEqual({
      missingFromEnum: [],
      missingFromComposer: [],
    });
  });

  it('el universo cerrado tiene 21 tipos (16 con case propio + 5 genéricos explícitos)', () => {
    expect(extractedCases.length).toBe(21);
    expect(PRINT_SECTION_TYPES.length).toBe(21);
  });
});
