/**
 * A.4 — CP-DTLP-20260827 — AJV schema validation tests for `PrintFormatDefinition v2`.
 *
 * Skill: vendix-validation, vendix-prisma-schema.
 *
 * Status: pending_runtime_check (backend unhealthy 2026-08-27 — otro agente en watch reload).
 *
 * El schema `definition-v2.schema.json` valida el shape de `definition` y `overrides`
 * para los 11 formatos del Hub (incluyendo `dispatch_ticket`, post-B.3). Esta spec
 * prueba 5 casos (no 4 como decía el task spec original):
 *
 *  1. Definición completa válida → AJV exit 0.
 *  2. `paper.width_mm: 0` → falla por min 58.
 *  3. `paper.margin_top_mm: 100` → falla por max 50.
 *  4. `paper.format: 'invalid'` → falla por enum.
 *  5. `columns.width_percent` suma 60+60+60 (over 100) — el schema NO valida
 *     este invariante (es custom). La validación se delega a un keyword AJV
 *     (`addKeyword`) en código de aplicación, o a `PrintFiscalValidatorService`.
 *     Esta spec verifica que el schema NO LO RECHAZA (para no crear falsos
 *     positivos antes de tener el keyword custom).
 *
 * NOTA sobre dependencias:
 *
 *   Esta spec importa `ajv` y `ajv-formats` (peerDependencies del backend).
 *   Si no están instalados en el momento de correr jest, la spec falla
 *   con `Cannot find module 'ajv'`. La instalación de los paquetes es
 *   responsabilidad del orquestador o del owner — no la modifica esta spec.
 *   Plan B si ajv no está: usar `class-validator` (ya en backend) con un
 *   DTO paralelo, pero AJV es preferible porque valida la rama `v=2` sin
 *   acoplar a clases TypeScript.
 */
import * as fs from 'fs';
import * as path from 'path';

import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

describe('PrintFormatDefinition v2 — AJV schema validation', () => {
  let validate: ValidateFunction;
  let validDefinition: Record<string, unknown>;

  beforeAll(() => {
    const schemaPath = path.join(
      __dirname,
      '..',
      'definition-v2.schema.json',
    );
    const schemaRaw = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaRaw);

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    validate = ajv.compile(schema);

    validDefinition = {
      v: 2,
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        margin_top_mm: 0,
        margin_right_mm: 0,
        margin_bottom_mm: 0,
        margin_left_mm: 0,
        copies: 1,
      },
      logo: {
        url: 'https://example.com/logo.png',
        position: 'left',
        size_mm: 25,
        opacity: 100,
      },
      company_block: {
        fields: [
          { key: 'NIT', enabled: true, format: 'text' },
          { key: 'address', enabled: true, format: 'text' },
        ],
      },
      sections: [
        { id: 'header', type: 'header', title: '', enabled: true, order: 0 },
        {
          id: 'customer_info',
          type: 'customer_info',
          title: 'Destinatario',
          enabled: true,
          order: 1,
        },
        {
          id: 'items_table',
          type: 'items_table',
          title: 'Productos',
          enabled: true,
          order: 2,
        },
        {
          id: 'footer',
          type: 'footer',
          title: '',
          enabled: true,
          order: 3,
        },
      ],
      columns: [
        {
          key: 'items.sku',
          label: '#',
          width_percent: 10,
          align: 'left',
          format: 'text',
          enabled: true,
        },
        {
          key: 'items.product_name',
          label: 'SKU/Descripción',
          width_percent: 50,
          align: 'left',
          format: 'text',
          enabled: true,
        },
        {
          key: 'items.ordered_qty',
          label: 'Cant.pedida',
          width_percent: 20,
          align: 'right',
          format: 'number',
          enabled: true,
        },
        {
          key: 'items.dispatched_qty',
          label: 'Cant.despachada',
          width_percent: 20,
          align: 'right',
          format: 'number',
          enabled: true,
        },
      ],
      styles: {
        font_family: 'Courier New',
        font_size_base_pt: 9,
        primary_color: '#000000',
        header_alignment: 'center',
        show_borders: true,
        compact_mode: true,
      },
      tokens: [
        {
          token: 'document.number',
          path: 'order.number',
          description: 'Número de la orden',
          example: 'ORD-2026-0001',
        },
      ],
    };
  });

  it('1. accepts a complete valid definition (full shape for dispatch_ticket)', () => {
    const ok = validate(validDefinition);
    if (!ok && validate.errors) {
      // eslint-disable-next-line no-console
      console.error('AJV errors:', JSON.stringify(validate.errors, null, 2));
    }
    expect(ok).toBe(true);
  });

  it('2. rejects paper.width_mm=0 (minimum is 58)', () => {
    const def = JSON.parse(JSON.stringify(validDefinition));
    def.paper = { ...(def.paper as object), width_mm: 0 };
    const ok = validate(def);
    expect(ok).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: '/paper/width_mm',
          keyword: 'minimum',
          message: expect.stringContaining('58') as unknown as string,
        }),
      ]),
    );
  });

  it('3. rejects paper.margin_top_mm=100 (maximum is 50)', () => {
    const def = JSON.parse(JSON.stringify(validDefinition));
    def.paper = {
      ...(def.paper as object),
      margin_top_mm: 100,
    };
    const ok = validate(def);
    expect(ok).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: '/paper/margin_top_mm',
          keyword: 'maximum',
          message: expect.stringContaining('50') as unknown as string,
        }),
      ]),
    );
  });

  it('4. rejects paper.format="invalid" (not in enum)', () => {
    const def = JSON.parse(JSON.stringify(validDefinition));
    def.paper = {
      ...(def.paper as object),
      format: 'invalid',
    };
    const ok = validate(def);
    expect(ok).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: '/paper/format',
          keyword: 'enum',
        }),
      ]),
    );
  });

  /**
   * 5. Caso documentado en el task spec:
   *    `columns.width_percent` 60+60+60 = 180 (>100).
   *
   *    El schema AJV NO valida este invariante (es un constraint custom
   *    sobre `sum(enabled columns) === 100`). El task spec lo describe
   *    como "validación custom separada" y este spec verifica exactamente
   *    eso — que el schema NO rechaza este caso. La validación debe
   *    aplicarse mediante:
   *
   *    a) AJV custom keyword `addKeyword({ keyword: 'columnsSum100' })`
   *       registrado en el bootstrap del módulo (B.x).
   *    b) `PrintFiscalValidatorService.assertColumnsSum100()` antes de
   *       persistir.
   *
   *    Mientras esa validación custom no exista, el schema permite
   *    silenciosamente una definición con `sum > 100`. El renderer
   *    (B.5) detecta el caso en runtime y emite warning.
   */
  it('5. does NOT enforce columns.width_percent sum (documented as custom validation)', () => {
    const def = JSON.parse(JSON.stringify(validDefinition));
    def.columns = [
      { key: 'items.a', label: 'A', width_percent: 60, align: 'left', enabled: true },
      { key: 'items.b', label: 'B', width_percent: 60, align: 'left', enabled: true },
      { key: 'items.c', label: 'C', width_percent: 60, align: 'left', enabled: true },
    ];
    const ok = validate(def);
    // El schema NO valida este invariante — test verifica que efectivamente
    // NO rechaza, dejando la validación a código AJV custom o servicio.
    expect(ok).toBe(true);
  });
});