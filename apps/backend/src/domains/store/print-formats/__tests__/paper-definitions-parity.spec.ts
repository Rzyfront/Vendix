/**
 * E.11 slice 2 — paso 9 del plan de cierre.
 *
 * Compuerta de paridad geométrica entre el builder pdfkit
 * (`InvoicePdfBuilder.GEOMETRY`) y el registry canónico
 * (`PAPER_DEFINITIONS` en `print-templates/paper-definitions.ts`).
 *
 * La fidelidad 100 % del PDF respecto al builder exige que los dos coincidan
 * en lo que el builder decide: ancho del papel, alto (cuando es fijo), modo
 * rollo y márgenes. La tolerancia existe porque el builder trabaja en
 * Puntos PostScript y redondea a entero pt — una diferencia de 0,1 mm entre
 * 215.9 mm (registry) y 216 mm (612 pt / MM) es la conversión legítima de
 * la unidad física al múltiplo entero de pt que pdfkit sabe estampar.
 *
 * Lo que NO se tolera: divergencias de `is_roll` (un térmico con
 * `bottom_reserve` de multipágina quemaría papel; una hoja con doble pasada
 * mediría sin necesidad y consumiría CPU). Si este spec falla en `is_roll`,
 * la causa raíz está en la desalineación entre el registry y el builder, no
 * en la unidad.
 *
 * El spec NO prueba la paridad numérica de importes entre HTML y PDF —esa
 * la cubre `print-gateway.engine-pdf.spec.ts` y el spec de paridad fina
 * planificado en el slice 3—. Aquí se cierra lo que el slice 2 prometió:
 * los 5 papeles tienen una sola fuente de verdad, y el builder la lee sin
 * discrepar en lo que decide la composición.
 */
import { GEOMETRY } from '../../invoicing/services/invoice-pdf.builder';
import { PAPER_DEFINITIONS } from '../print-templates/paper-definitions';
import { PrintFormat } from '../../settings/interfaces/store-settings.interface';

/**
 * Puntos por milímetro — el mismo factor que `MM = 2.834645669` que el
 * builder importa de pdfkit. Centralizado acá para que la conversión sea la
 * MISMA en spec y runtime: una diferencia de 1e-3 en MM haría que la
 * tolerancia del spec NO correspondiera con la conversión real.
 */
const MM = 2.834645669;

/**
 * Tolerancia máxima admitida entre el ancho del builder y el del registry.
 *
 * 0,5 mm cubre el redondeo a entero pt: 612 pt ÷ 2.834645669 = 215,97 mm.
 * El registry declara 215,9 mm y el builder 612 pt. La diferencia es 0,07 mm
 * — bien dentro de la tolerancia. Una diferencia mayor a 0,5 mm indica que
 * el builder o el registry cambió sin que el otro le siguiera.
 */
const MM_TOLERANCE = 0.5;

describe('E.11 slice 2 — paridad geométrica builder ↔ PAPER_DEFINITIONS', () => {
  const formats: PrintFormat[] = [
    'letter',
    'a4',
    'half_letter',
    'thermal_80',
    'thermal_58',
  ];

  formats.forEach((format) => {
    describe(`papel ${format}`, () => {
      const registry = PAPER_DEFINITIONS[format];
      const builder = GEOMETRY[format];

      it('existe en PAPER_DEFINITIONS', () => {
        expect(registry).toBeDefined();
        expect(registry.code).toBe(format);
      });

      it('existe en el builder', () => {
        expect(builder).toBeDefined();
      });

      it('ancho coincide dentro de tolerancia de redondeo a entero pt', () => {
        const builder_width_mm = builder.width / MM;
        const registry_width_mm = registry.width_mm;
        const diff = Math.abs(builder_width_mm - registry_width_mm);

        // Imprime los dos para que un fallo futuro sepa cuál de los dos lados
        // cambió y cuánto. La aserción es la última línea.
        // eslint-disable-next-line no-console
        console.log(
          `[${format}] registry=${registry_width_mm} mm · ` +
            `builder=${builder.width} pt = ${builder_width_mm.toFixed(4)} mm · ` +
            `diff=${diff.toFixed(4)} mm (tol=${MM_TOLERANCE} mm)`,
        );

        expect(diff).toBeLessThanOrEqual(MM_TOLERANCE);
      });

      it('modo rollo coincide exactamente (cero tolerancia)', () => {
        expect(builder.roll).toBe(registry.is_roll);
      });

      it('alto fijo coincide (cuando registry NO es rollo)', () => {
        if (registry.is_roll) {
          // En rollo el alto se MIDE; no hay equivalencia que comparar.
          return;
        }

        const builder_height_mm = builder.height / MM;
        const registry_height_mm = registry.height_mm;
        if (registry_height_mm == null) {
          // Registry dice que NO es rollo pero tampoco tiene alto fijo: es
          // una inconsistencia interna del registry, no del builder.
          throw new Error(
            `PAPER_DEFINITIONS.${format} tiene is_roll=false pero height_mm=null`,
          );
        }

        const diff = Math.abs(builder_height_mm - registry_height_mm);
        expect(diff).toBeLessThanOrEqual(MM_TOLERANCE);
      });
    });
  });

  it('los 5 papeles del registry coinciden con los 5 del builder', () => {
    const registryKeys = Object.keys(PAPER_DEFINITIONS).sort();
    const builderKeys = Object.keys(GEOMETRY).sort();
    expect(registryKeys).toEqual(builderKeys);
  });
});
