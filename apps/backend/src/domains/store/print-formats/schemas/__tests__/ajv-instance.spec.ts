/**
 * [print-editor-dsk P1.1] — AJV instance spec.
 *
 * Skill: vendix-validation.
 *
 * Companion to `ajv-instance.ts`. Covers the 5 cases from the task spec:
 *
 *  1. Valid v2 definition (full shape, all v2 fields populated) → valid=true.
 *  2. Invalid: `margin_top_mm = 60` (over max 50) → invalid.
 *  3. Invalid: enabled columns sum 99 (≠ 100, custom keyword fails) → invalid.
 *  4. Invalid: `custom_template` unbalanced (`{{` opens ≠ `}}` closes) → invalid.
 *  5. Valid: minimal v2 definition (`{ v: 2, paper: { format: 'thermal_80' } }`)
 *     → valid=true (all v2 fields are optional except `v` + `paper.format`).
 *
 * Status: pending_runtime_check (backend unhealthy 2026-08-27 — parallel
 * sub-agent holds watch-reload; CI re-run after the dust settles).
 *
 * Like the sibling `definition-v2.spec.ts`, this spec relies on AJV 8.x
 * being hoisted from the workspace root. If the run errors with
 * `Cannot find module 'ajv'`, the workspace `npm install` was not run —
 * NOT a spec defect.
 */
import {
  validatePrintFormatDefinition,
  ajv,
  validateDefinitionV2,
} from '../ajv-instance';

describe('AJV instance — PrintFormatDefinition v2', () => {
  // Full v2 definition used as the happy-path baseline. Mirrors the shape
  // from `definition-v2.spec.ts` so behavior changes between the two specs
  // stay attributable to AJV-vs-custom-keyword, not data drift.
  const validDefinition = {
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

  it('1. accepts a complete valid v2 definition', () => {
    const result = validatePrintFormatDefinition(validDefinition);
    if (!result.valid) {
      // eslint-disable-next-line no-console
      console.error(
        'AJV errors:',
        JSON.stringify(result.errors, null, 2),
      );
    }
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('2. rejects margin_top_mm=60 (maximum is 50)', () => {
    const def = JSON.parse(JSON.stringify(validDefinition));
    def.paper.margin_top_mm = 60;
    const result = validatePrintFormatDefinition(def);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: '/paper/margin_top_mm',
          keyword: 'maximum',
        }),
      ]),
    );
  });

  it('3. rejects enabled columns whose width_percent sums to 99 (custom keyword)', () => {
    const def = JSON.parse(JSON.stringify(validDefinition));
    // Override columns: enabled columns sum to 10 + 50 + 19 + 20 = 99 (≠ 100)
    def.columns = [
      {
        key: 'a',
        label: 'A',
        width_percent: 10,
        align: 'left',
        enabled: true,
      },
      {
        key: 'b',
        label: 'B',
        width_percent: 50,
        align: 'left',
        enabled: true,
      },
      {
        key: 'c',
        label: 'C',
        width_percent: 19,
        align: 'right',
        enabled: true,
      },
      {
        key: 'd',
        label: 'D',
        width_percent: 20,
        align: 'right',
        enabled: true,
      },
    ];
    const result = validatePrintFormatDefinition(def);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: 'columnsWidthSum100',
        }),
      ]),
    );
  });

  it('4. rejects custom_template with unbalanced Handlebars braces', () => {
    const def = JSON.parse(JSON.stringify(validDefinition));
    def.custom_template = 'Hello {{ name'; // 1 open, 0 close
    const result = validatePrintFormatDefinition(def);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: 'customTemplateBalanced',
        }),
      ]),
    );
  });

  it('5. accepts a minimal v2 definition (only v + paper.format required)', () => {
    const minimal = {
      v: 2,
      paper: { format: 'thermal_80' },
    };
    const result = validatePrintFormatDefinition(minimal);
    if (!result.valid) {
      // eslint-disable-next-line no-console
      console.error(
        'AJV errors (minimal):',
        JSON.stringify(result.errors, null, 2),
      );
    }
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // -- Module-load smoke checks ---------------------------------------------
  // Ensures the AJV singleton + compiled validator are exported correctly so
  // `PrintFormatsService` can wire them at module-init time.

  it('exports an AJV singleton instance', () => {
    expect(ajv).toBeDefined();
    expect(typeof ajv.compile).toBe('function');
  });

  it('exports a compiled v2 validator function', () => {
    expect(validateDefinitionV2).toBeDefined();
    expect(typeof validateDefinitionV2).toBe('function');
    // Sanity: a known-good doc validates, a known-bad doc fails.
    expect(validateDefinitionV2(validDefinition)).toBe(true);
    expect(validateDefinitionV2({ v: 99, paper: { format: 'x' } })).toBe(
      false,
    );
  });
});