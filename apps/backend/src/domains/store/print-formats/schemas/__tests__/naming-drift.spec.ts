/**
 * [print-editor-dsk] — Compuerta de deriva de nombres (camelCase legado vs.
 * snake_case canónico) para `normalizeDefinition()`.
 *
 * Cubre, con conteo y comparación reales (no aserciones de "coinciden" sin
 * haber comparado):
 *
 *  1. Los 8 alias documentados en `CAMEL_TO_SNAKE_ALIASES` se reescriben en
 *     cada uno de sus 5 sitios reales (raíz, `paper`, `logo`,
 *     `company_block.fields[]`, `sections[].fields[]`).
 *  2. La forma snake_case gana cuando ambas están presentes.
 *  3. `custom_template`, `tokens` y las claves dentro de `styles` NO se
 *     tocan.
 *  4. Una definición normalizada (una plantilla de sistema real) pasa
 *     `validatePrintFormatDefinition()` sin errores — incluyendo, como
 *     comprobación exhaustiva, las 16 plantillas de sistema de
 *     `apps/backend/prisma/seeds/print-templates.seed.ts` normalizadas una
 *     por una (17 filas existen en `print_templates` en desarrollo; 2 no son
 *     de sistema y no viven en este seed — ver el comentario junto al
 *     `describe` de abajo).
 */
import {
  CAMEL_TO_SNAKE_ALIASES,
  normalizeDefinition,
} from '../definition-normalizer';
import { validatePrintFormatDefinition } from '../ajv-instance';
import { SYSTEM_PRINT_TEMPLATES } from '../../../../../../prisma/seeds/print-templates.seed';

/**
 * Fixture representativo con los 8 alias camelCase legados en sus 5 sitios
 * reales, más un caso de "ambas formas presentes" en `paper` y en un campo
 * de sección, para probar que la snake_case gana. Deliberadamente evita
 * `columns` y `styles.theme_tokens` — ninguno de los dos es parte de la
 * tabla de 8 alias, y mezclarlos aquí solo probaría un gap de schema no
 * relacionado con la deriva de nombres que cubre este spec.
 */
function buildCamelCaseFixture() {
  return {
    // Sin `v` a propósito — prueba el estampado de versión.
    paper: {
      format: 'thermal_80',
      width_mm: 80,
      is_roll: true,
      heightMm: 200,
      marginTopMm: 5,
      marginRightMm: 3,
      marginBottomMm: 5,
      // Ambas formas presentes en el mismo campo — la snake_case debe ganar.
      marginLeftMm: 99,
      margin_left_mm: 3,
      copies: 1,
    },
    logo: {
      url: 'https://vendix-s3.example.com/stores/5/logo.png',
      position: 'left',
      sizeMm: 20,
      opacity: 100,
    },
    companyBlock: {
      fields: [{ key: 'NIT', enabled: true, customLabel: 'RUT' }],
    },
    sections: [
      {
        id: 'sec_one',
        type: 'header',
        title: 'Encabezado',
        enabled: true,
        order: 1,
        fields: [{ id: 'f1', key: 'x', label: 'X', enabled: true, customLabel: 'Custom X' }],
      },
      {
        id: 'sec_two',
        type: 'footer',
        title: 'Pie',
        enabled: true,
        order: 2,
        fields: [
          {
            id: 'f2',
            key: 'y',
            label: 'Y',
            enabled: true,
            // Ambas formas presentes — la snake_case debe ganar.
            customLabel: 'FromCamel',
            custom_label: 'FromSnake',
          },
        ],
      },
    ],
    styles: {
      font_family: 'Courier New',
      font_size_base_pt: 9,
    },
    tokens: [{ token: 'foo', path: 'order.foo' }],
    custom_template: '{{ order.number }}',
  };
}

describe('CAMEL_TO_SNAKE_ALIASES — tabla explícita', () => {
  it('tiene exactamente los 8 alias documentados', () => {
    expect(CAMEL_TO_SNAKE_ALIASES).toEqual({
      heightMm: 'height_mm',
      marginTopMm: 'margin_top_mm',
      marginRightMm: 'margin_right_mm',
      marginBottomMm: 'margin_bottom_mm',
      marginLeftMm: 'margin_left_mm',
      sizeMm: 'size_mm',
      customLabel: 'custom_label',
      companyBlock: 'company_block',
    });
    expect(Object.keys(CAMEL_TO_SNAKE_ALIASES)).toHaveLength(8);
  });
});

describe('normalizeDefinition() — reescritura de los 8 alias en sus 5 sitios', () => {
  const fixture = buildCamelCaseFixture();
  // Clon profundo previo a normalizar — prueba que normalizeDefinition() es
  // pura (no muta la entrada), comparando la entrada DESPUÉS de la llamada
  // contra esta copia tomada ANTES.
  const fixtureSnapshotBefore = JSON.parse(JSON.stringify(fixture));

  const normalized = normalizeDefinition(fixture) as Record<string, any>;

  it('no muta el payload de entrada', () => {
    expect(fixture).toEqual(fixtureSnapshotBefore);
  });

  it('estampa v: 2 cuando la clave está ausente', () => {
    expect(normalized.v).toBe(2);
  });

  it('paper: heightMm -> height_mm', () => {
    expect(normalized.paper.height_mm).toBe(200);
    expect(normalized.paper).not.toHaveProperty('heightMm');
  });

  it('paper: marginTopMm -> margin_top_mm', () => {
    expect(normalized.paper.margin_top_mm).toBe(5);
    expect(normalized.paper).not.toHaveProperty('marginTopMm');
  });

  it('paper: marginRightMm -> margin_right_mm', () => {
    expect(normalized.paper.margin_right_mm).toBe(3);
    expect(normalized.paper).not.toHaveProperty('marginRightMm');
  });

  it('paper: marginBottomMm -> margin_bottom_mm', () => {
    expect(normalized.paper.margin_bottom_mm).toBe(5);
    expect(normalized.paper).not.toHaveProperty('marginBottomMm');
  });

  it('paper: marginLeftMm -> margin_left_mm, snake_case gana cuando ambas están presentes', () => {
    // Fixture trae marginLeftMm: 99 Y margin_left_mm: 3 — la snake_case (3)
    // debe ganar, no la camelCase (99).
    expect(normalized.paper.margin_left_mm).toBe(3);
    expect(normalized.paper).not.toHaveProperty('marginLeftMm');
  });

  it('logo: sizeMm -> size_mm', () => {
    expect(normalized.logo.size_mm).toBe(20);
    expect(normalized.logo).not.toHaveProperty('sizeMm');
  });

  it('raíz: companyBlock -> company_block', () => {
    expect(normalized).not.toHaveProperty('companyBlock');
    expect(normalized.company_block).toBeDefined();
    expect(Array.isArray(normalized.company_block.fields)).toBe(true);
  });

  it('company_block.fields[]: customLabel -> custom_label', () => {
    expect(normalized.company_block.fields[0].custom_label).toBe('RUT');
    expect(normalized.company_block.fields[0]).not.toHaveProperty('customLabel');
  });

  it('sections[].fields[]: customLabel -> custom_label', () => {
    expect(normalized.sections[0].fields[0].custom_label).toBe('Custom X');
    expect(normalized.sections[0].fields[0]).not.toHaveProperty('customLabel');
  });

  it('sections[].fields[]: snake_case gana cuando ambas están presentes', () => {
    expect(normalized.sections[1].fields[0].custom_label).toBe('FromSnake');
    expect(normalized.sections[1].fields[0]).not.toHaveProperty('customLabel');
  });

  it('NO toca custom_template', () => {
    expect(normalized.custom_template).toBe(fixture.custom_template);
  });

  it('NO toca tokens (misma referencia)', () => {
    expect(normalized.tokens).toBe(fixture.tokens);
  });

  it('NO toca ninguna clave dentro de styles (misma referencia)', () => {
    expect(normalized.styles).toBe(fixture.styles);
    expect(normalized.styles).toEqual({ font_family: 'Courier New', font_size_base_pt: 9 });
  });
});

describe('normalizeDefinition() + validatePrintFormatDefinition() — fixture representativo válido', () => {
  it('la definición normalizada del fixture camelCase pasa AJV sin errores', () => {
    const fixture = buildCamelCaseFixture();
    const normalized = normalizeDefinition(fixture);

    const result = validatePrintFormatDefinition(normalized);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('normalizeDefinition() + validatePrintFormatDefinition() — las 16 plantillas de sistema del seed', () => {
  // Comprobación exhaustiva: cargar las plantillas de sistema desde el seed
  // (no desde la base de datos), pasar cada una por `normalizeDefinition()`
  // y luego por `validatePrintFormatDefinition()`, y CONTAR cuántas validan
  // sin errores. Nada de afirmar "todas validan" sin haber corrido una
  // validación por plantilla.
  //
  // El conteo cuenta plantillas de SISTEMA, no filas: la base de datos de
  // desarrollo tiene además plantillas creadas a mano en pruebas anteriores
  // (`is_system = false`) que el seed no declara. Subió de 15 a 16 con
  // `pos_electronic_invoice`.
  it('el seed declara exactamente 16 plantillas de sistema', () => {
    expect(SYSTEM_PRINT_TEMPLATES.length).toBe(16);
  });

  it('las 16 plantillas normalizadas validan sin errores', () => {
    expect(SYSTEM_PRINT_TEMPLATES.length).toBeGreaterThan(0);

    const results = SYSTEM_PRINT_TEMPLATES.map((tpl) => {
      const normalized = normalizeDefinition(tpl.definition);
      const validation = validatePrintFormatDefinition(normalized);
      return {
        format_type: tpl.format_type,
        name: tpl.name,
        valid: validation.valid,
        errors: validation.errors,
      };
    });

    const failures = results.filter((r) => !r.valid);

    // Diagnóstico legible si algo falla: nombra qué plantilla y qué error
    // de AJV la tumbó, en vez de un booleano ciego.
    expect({
      totalChecked: results.length,
      failureCount: failures.length,
      failures: failures.map((f) => ({
        format_type: f.format_type,
        name: f.name,
        errors: f.errors,
      })),
    }).toEqual({
      totalChecked: SYSTEM_PRINT_TEMPLATES.length,
      failureCount: 0,
      failures: [],
    });
  });

  it('cada plantilla normalizada queda con v: 2 estampado', () => {
    for (const tpl of SYSTEM_PRINT_TEMPLATES) {
      const normalized = normalizeDefinition(tpl.definition) as Record<string, any>;
      expect(normalized.v).toBe(2);
    }
  });
});
