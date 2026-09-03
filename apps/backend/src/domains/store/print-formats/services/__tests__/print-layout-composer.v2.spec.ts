/**
 * [print-editor-dsk P1.3] — Unit tests for the v2 fields the composer must
 * consume after the PrintFormatDefinition interface migration:
 *
 *   1. paper.margin_mm (legacy, v1) — still honored when per-side absent
 *   2. paper.margin_top_mm / right / bottom / left (v2) — drive per-side
 *      body padding; @page margin uses the max
 *   3. paper.format === 'custom' — emits `${width_mm}mm ${height_mm}mm`
 *   4. definition.logo.url — fallback when data.store.logo_url is empty
 *   5. definition.company_block.fields — rendered ONLY for fiscal formats
 *      (inferred by the presence of `fiscal_*` sections)
 *   6. definition.company_block — NOT rendered for non-fiscal formats
 *
 * Skills: vendix-backend (NestJS testing), vendix-fiscal-scope (fiscal
 * inference via section types).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrintLayoutComposerService } from '../print-layout-composer.service';
import { PrintTemplateCompilerService } from '../print-template-compiler.service';
import { PrintFormatDefinition } from '../../interfaces/print-format.interface';
import { StandardPrintDataModel } from '../../interfaces/standard-print-data.model';

describe('PrintLayoutComposerService — v2 fields (P1.3)', () => {
  let composer: PrintLayoutComposerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrintLayoutComposerService, PrintTemplateCompilerService],
    }).compile();

    composer = module.get<PrintLayoutComposerService>(PrintLayoutComposerService);
  });

  const baseData: StandardPrintDataModel = {
    store: {
      name: 'Mi Tienda',
      legal_name: 'Mi Tienda S.A.S.',
      tax_id: '900123456',
      tax_regime: 'Común',
      address: 'Calle 1 # 2-3',
      city: 'Bogotá',
      phone: '+57 1 555 5555',
      email: 'info@mitienda.co',
    },
    document: {
      id: 1,
      number: '1234',
      date: '2026-08-27',
      date_formatted: '2026-08-27',
      time: '10:30',
      state: 'paid',
      state_label: 'Pagado',
    },
    items: [],
    taxes: [],
    totals: {
      subtotal: 100000,
      subtotal_formatted: '$100.000',
      discount_total: 0,
      discount_total_formatted: '$0',
      shipping_total: 0,
      shipping_total_formatted: '$0',
      tax_total: 0,
      tax_total_formatted: '$0',
      grand_total: 100000,
      grand_total_formatted: '$100.000',
    },
  };

  const v1Paper = {
    format: 'letter' as const,
    width_mm: 216,
    height_mm: 280,
    is_roll: false,
    margin_mm: 10,
    copies: 1,
  };

  it('1. v1 paper (only margin_mm) — output respects v1 margin', () => {
    const def: PrintFormatDefinition = {
      v: 1,
      paper: v1Paper,
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, baseData);
    // @page margin: max(top/right/bottom/left) = 10mm (todos heredan de margin_mm)
    expect(html).toMatch(/@page\s*\{[\s\S]*margin:\s*10mm/);
    // Body padding per-side: todos 10mm
    expect(html).toMatch(/padding:\s*10mm\s*10mm\s*10mm\s*10mm/);
  });

  it('2. v2 paper (per-side margins) — body padding uses all 4 sides', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: {
        ...v1Paper,
        margin_top_mm: 5,
        margin_right_mm: 12,
        margin_bottom_mm: 8,
        margin_left_mm: 20,
      },
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, baseData);
    // @page margin: max(5, 12, 8, 20) = 20mm
    expect(html).toMatch(/@page\s*\{[\s\S]*margin:\s*20mm/);
    // Body padding per-side respeta los 4 lados en orden CSS (T R B L)
    expect(html).toMatch(/padding:\s*5mm\s*12mm\s*8mm\s*20mm/);
  });

  it('3. custom paper format with width_mm/height_mm — @page size: 100mm 200mm', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: {
        format: 'custom',
        width_mm: 100,
        height_mm: 200,
        is_roll: false,
        margin_mm: 5,
        copies: 1,
      },
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, baseData);
    expect(html).toMatch(/@page\s*\{[\s\S]*size:\s*100mm\s*200mm/);
  });

  it('4. definition.logo.url set + empty data.store.logo_url — logo rendered from definition', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: v1Paper,
      logo: {
        url: 'https://example.com/logo.png',
        position: 'center',
        size_mm: 18,
        opacity: 80,
      },
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
      ],
    };
    const dataWithoutLogo: StandardPrintDataModel = {
      ...baseData,
      store: { ...baseData.store, logo_url: undefined } as any,
    };
    const html = composer.compose(def, dataWithoutLogo);
    // El logo de la definición se renderiza
    expect(html).toContain('https://example.com/logo.png');
    expect(html).toMatch(/class="store-logo"[^>]*text-align:\s*center/);
    // Y opacity se aplica como estilo inline (0.8 = 80/100)
    expect(html).toMatch(/opacity:\s*0\.8/);
  });

  it('5. definition.company_block.fields set for fiscal format — company block rendered', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: v1Paper,
      company_block: {
        fields: [
          { key: 'NIT', enabled: true },
          { key: 'address', enabled: true, custom_label: 'Dirección' },
          { key: 'phone', enabled: true },
          { key: 'email', enabled: false }, // disabled — must NOT appear
        ],
      },
      sections: [
        // Fiscal inference: presence of fiscal_* section types marks this
        // definition as fiscal (the composer has no formatType parameter).
        { id: 'h', type: 'fiscal_header', title: '', enabled: true, order: 1 },
        { id: 'q', type: 'fiscal_qr_section', title: '', enabled: true, order: 2 },
      ],
    };
    const html = composer.compose(def, baseData);
    // The company-block container is present
    expect(html).toContain('class="company-block"');
    // NIT default label + value
    expect(html).toContain('<span class="label">NIT:</span>');
    expect(html).toContain('<span class="value">900123456</span>');
    // Custom label overrides default
    expect(html).toContain('<span class="label">Dirección:</span>');
    expect(html).toContain('<span class="value">Calle 1 # 2-3</span>');
    // Phone field is enabled and should render
    expect(html).toContain('<span class="label">phone:</span>');
    // Disabled email field should NOT render
    expect(html).not.toContain('<span class="label">email:</span>');
  });

  it('6. definition.company_block set for non-fiscal format — NOT rendered', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: v1Paper,
      company_block: {
        fields: [
          { key: 'NIT', enabled: true },
          { key: 'address', enabled: true },
        ],
      },
      // Non-fiscal: sólo header (sin prefijo fiscal_*)
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
        { id: 'i', type: 'items_table', title: '', enabled: true, order: 2 },
        { id: 't', type: 'totals_summary', title: '', enabled: true, order: 3 },
      ],
    };
    const html = composer.compose(def, baseData);
    // El bloque no se renderiza en formato no fiscal
    expect(html).not.toContain('class="company-block"');
    expect(html).toContain('class="store-name"');
    expect(html).toContain('Mi Tienda');
  });
});

/**
 * [tirilla-80mm-negro-absoluto] — Regresión: en rollo térmico (80mm) el
 * documento sólo puede imprimir negro y blanco; en hoja (carta/A4) el color
 * de marca de la plantilla se conserva. Dos casos, uno espejo del otro a
 * propósito: si alguien "arreglara" el defecto aplicando negro a TODO
 * (incluida hoja), el caso espejo lo detecta.
 *
 * Las cuatro definiciones de rollo son copia fiel de
 * `prisma/seeds/print-templates.seed.ts` (paper + styles + sections +
 * columns de `pos_sale_ticket`, `pos_electronic_invoice`, `kitchen_ticket`
 * y `dispatch_ticket`) — no se importan desde ahí porque ese archivo vive
 * fuera del `rootDir` de Jest (`src/`) y ts-jest no lo compila. Copiarlas
 * también deja la prueba legible sin saltar a otro paquete.
 */
describe('PrintLayoutComposerService — tirilla 80mm en negro absoluto', () => {
  let composer: PrintLayoutComposerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrintLayoutComposerService, PrintTemplateCompilerService],
    }).compile();

    composer = module.get<PrintLayoutComposerService>(PrintLayoutComposerService);
  });

  /**
   * Extrae los colores del `<body>` compuesto — lo único que de verdad se
   * imprime. El `<head>` siempre contiene, como texto plano, los colores de
   * marca de las reglas que el bloque de negro de rollo pisa por cascada
   * (`!important`, al final de la hoja de estilos): un grep sobre el head
   * confundiría "una regla que perdió la cascada" con "un color que sale en
   * el papel". El body, en cambio, no lleva ni un solo `style="color:"` en
   * rollo tras este plan — si aparece uno, la regresión es real.
   */
  function bodyColors(html: string): string[] {
    const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
    const body = match ? match[1] : html;
    // El único lugar del body donde un color se "pinta de verdad" es un
    // atributo style="..."; el texto visible puede contener secuencias que
    // parecen hex sin serlo (p. ej. un número de documento "#4567" — 4, 5, 6
    // y 7 son dígitos hex válidos). Por eso el barrido va sólo sobre los
    // valores de style="...", tal como dice el comentario de arriba: si
    // sobrevive un style="color:" en rollo, ESO es la regresión real.
    const styleAttrs = body.match(/style="[^"]*"/gi) || [];
    const styleText = styleAttrs.join(' ');
    // Hex, `rgb()/rgba()/hsl()` y colores con nombre. Los tres, no sólo hex:
    // un `color: red` o un `rgb(107,114,128)` que alguien agregue mañana
    // imprime igual de mal y un grep de `#` no lo vería.
    const hexes = styleText.match(/#[0-9a-fA-F]{3,8}/g) || [];
    const funcs = styleText.match(/\b(?:rgba?|hsla?)\([^)]*\)/gi) || [];
    const named =
      styleText.match(
        /(?:color|background|background-color|border-color|border(?:-\w+)?)\s*:\s*([a-z]{3,20})\b/gi,
      ) || [];
    const namedValues = named
      .map((decl) => (decl.split(':')[1] || '').trim().toLowerCase())
      // `white`/`black` son los dos nombres admitidos; `none`, `solid`,
      // `dashed`, `transparent` e `inherit` no son colores visibles.
      .filter(
        (value) =>
          ![
            'none',
            'solid',
            'dashed',
            'dotted',
            'transparent',
            'inherit',
            'initial',
            'unset',
            'currentcolor',
            'white',
            'black',
          ].includes(value),
      );
    return Array.from(
      new Set(
        [...hexes, ...funcs, ...namedValues].map((c) =>
          c.toLowerCase().replace(/\s+/g, ''),
        ),
      ),
    );
  }

  const BLACK_AND_WHITE = ['#000', '#000000', '#fff', '#ffffff'];

  const rollPaper = {
    format: 'thermal_80' as const,
    width_mm: 80,
    is_roll: true,
    margin_mm: 0,
    copies: 1,
  };

  const rollStyles = (fontSize: number) => ({
    font_family: "'Courier New', Courier, monospace",
    font_size_base_pt: fontSize,
    primary_color: '#000000',
    header_alignment: 'center' as const,
    compact_mode: true,
  });

  /**
   * Un solo modelo "rico" que ejercita TODAS las rutas que antes emitían
   * color: descuento e IVA por ítem (rojo/gris), retención, total en letras,
   * discriminación de impuestos, QR con PNG real (para no caer en el
   * placeholder azul de "QR pendiente" — ese es otro defecto, no el de este
   * plan) y mesa/mesero para el ticket de cocina.
   */
  const richData: StandardPrintDataModel = {
    store: {
      name: 'Restaurante El Fogón',
      legal_name: 'El Fogón S.A.S.',
      tax_id: '900123456',
      tax_regime: 'Común',
      address: 'Calle 10 # 5-20',
      city: 'Medellín',
      phone: '+57 4 555 1234',
      email: 'ventas@elfogon.co',
    },
    customer: {
      name: 'Juan Pérez',
      tax_id: '1020304050',
      address: 'Cra 45 # 10-30',
      phone: '3001234567',
      email: 'juan@example.com',
    },
    document: {
      id: 99,
      number: '4567',
      date: '2026-09-01',
      date_formatted: '2026-09-01',
      time: '19:45',
      state: 'paid',
      state_label: 'Pagado',
      cashier_name: 'María López',
      pos_terminal: 'Caja 1',
      payment_method: 'Efectivo',
      amount_received: 100000,
      amount_received_formatted: '$100.000',
      change_due: 5500,
      change_due_formatted: '$5.500',
      table_number: 'Mesa 5',
      waiter_name: 'Carlos Ruiz',
    },
    fiscal: {
      cufe: 'a1b2c3d4e5f6'.padEnd(96, '0'),
      qr_code_content: 'NumFac:4567\nCUFE:a1b2c3',
      qr_code_png_base64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    },
    items: [
      {
        index: 1,
        product_name: 'Bandeja Paisa',
        variant_sku: 'BP-001',
        variant_attributes: 'Tamaño: Grande',
        quantity: 2,
        unit_price: 25000,
        unit_price_formatted: '$25.000',
        discount_amount: 3000,
        discount_formatted: '$3.000',
        tax_rate: 19,
        tax_amount: 4180,
        total_price: 50000,
        total_price_formatted: '$50.000',
        notes: 'Sin cebolla',
        dispatched_qty: 2,
      },
      {
        index: 2,
        product_name: 'Jugo Natural',
        variant_sku: 'JN-002',
        quantity: 1,
        unit_price: 8000,
        unit_price_formatted: '$8.000',
        total_price: 8000,
        total_price_formatted: '$8.000',
        dispatched_qty: 1,
      },
    ],
    taxes: [
      {
        name: 'IVA',
        rate: 19,
        base_amount: 50000,
        tax_amount: 9500,
        base_formatted: '$50.000',
        tax_formatted: '$9.500',
      },
    ],
    totals: {
      subtotal: 58000,
      subtotal_formatted: '$58.000',
      discount_total: 3000,
      discount_total_formatted: '$3.000',
      shipping_total: 0,
      shipping_total_formatted: '$0',
      tax_total: 9500,
      tax_total_formatted: '$9.500',
      withholding_total: 500,
      withholding_total_formatted: '$500',
      grand_total: 64000,
      grand_total_formatted: '$64.000',
      grand_total_in_words: 'Sesenta y cuatro mil pesos',
    },
  };

  // Copia fiel de SYSTEM_PRINT_TEMPLATES en prisma/seeds/print-templates.seed.ts
  const rollDefinitions: Record<string, PrintFormatDefinition> = {
    pos_sale_ticket: {
      v: 2,
      paper: rollPaper,
      styles: rollStyles(9),
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado', enabled: true, order: 1 },
        { id: 'sec_doc_info', type: 'document_info', title: 'Datos del Ticket', enabled: true, order: 2 },
        { id: 'sec_customer', type: 'customer_info', title: 'Datos del Cliente', enabled: true, order: 3 },
        { id: 'sec_items', type: 'items_table', title: 'Detalle de Productos', enabled: true, order: 4 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Totales y Medios de Pago', enabled: true, order: 5 },
        { id: 'sec_footer', type: 'footer', title: 'Pie de Ticket', enabled: true, order: 6 },
      ],
      columns: [
        { id: 'col_desc', key: 'product_name', label: 'Descripción', enabled: true, width_percent: 50, align: 'left' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 15, align: 'center' },
        { id: 'col_price', key: 'unit_price', label: 'Precio', enabled: true, width_percent: 15, align: 'right' },
        { id: 'col_tot', key: 'total_price', label: 'Total', enabled: true, width_percent: 20, align: 'right' },
      ],
    },
    pos_electronic_invoice: {
      v: 2,
      paper: rollPaper,
      styles: rollStyles(8.5),
      sections: [
        { id: 'sec_dian_header', type: 'fiscal_header', title: 'Cabecera Fiscal', enabled: true, order: 1 },
        { id: 'sec_doc_info', type: 'document_info', title: 'Datos de la Venta', enabled: true, order: 2 },
        { id: 'sec_dian_buyer', type: 'fiscal_buyer_info', title: 'Datos del Adquirente', enabled: true, order: 3 },
        { id: 'sec_items', type: 'items_table', title: 'Detalle', enabled: true, order: 4 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Liquidación Total', enabled: true, order: 5 },
        { id: 'sec_dian_taxes', type: 'fiscal_tax_breakdown', title: 'Discriminación de Impuestos', enabled: true, order: 6 },
        { id: 'sec_dian_cufe', type: 'fiscal_cufe_box', title: 'CUFE', enabled: true, order: 7 },
        { id: 'sec_dian_qr', type: 'fiscal_qr_section', title: 'QR DIAN', enabled: true, order: 8 },
        { id: 'sec_footer', type: 'footer', title: 'Pie', enabled: true, order: 9 },
      ],
      columns: [
        { id: 'col_desc', key: 'product_name', label: 'Descripción', enabled: true, width_percent: 50, align: 'left' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 15, align: 'center' },
        { id: 'col_tot', key: 'total_price', label: 'Total', enabled: true, width_percent: 35, align: 'right' },
      ],
    },
    kitchen_ticket: {
      v: 2,
      paper: rollPaper,
      styles: rollStyles(11),
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Comanda', enabled: true, order: 1 },
        { id: 'sec_table_info', type: 'table_info', title: 'Mesa, Mesero y Turno', enabled: true, order: 2 },
        { id: 'sec_items', type: 'kitchen_items', title: 'Platos y Modificadores', enabled: true, order: 3 },
        { id: 'sec_notes', type: 'custom_notes', title: 'Observaciones de Cocina', enabled: true, order: 4 },
      ],
      columns: [
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 25, align: 'center' },
        { id: 'col_desc', key: 'product_name', label: 'Plato / Preparación', enabled: true, width_percent: 75, align: 'left' },
      ],
    },
    dispatch_ticket: {
      v: 2,
      paper: rollPaper,
      styles: { ...rollStyles(9), show_borders: true },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Despacho', enabled: true, order: 1 },
        { id: 'sec_doc_info', type: 'document_info', title: 'Datos de la Orden', enabled: true, order: 2 },
        { id: 'sec_customer', type: 'customer_info', title: 'Cliente y Dirección de Entrega', enabled: true, order: 3 },
        { id: 'sec_items', type: 'items_table', title: 'Productos a Despachar', enabled: true, order: 4 },
        { id: 'sec_footer', type: 'footer', title: 'Despachado por', enabled: true, order: 5 },
      ],
      columns: [
        { id: 'col_idx', key: 'index', label: '#', enabled: true, width_percent: 8, align: 'center' },
        { id: 'col_sku', key: 'variant_sku', label: 'SKU / Código', enabled: true, width_percent: 30, align: 'left' },
        { id: 'col_desc', key: 'product_name', label: 'Descripción', enabled: true, width_percent: 32, align: 'left' },
        { id: 'col_qty', key: 'quantity', label: 'Cant. Pedida', enabled: true, width_percent: 15, align: 'center' },
        { id: 'col_disp', key: 'dispatched_qty', label: 'Cant. Despachada', enabled: true, width_percent: 15, align: 'center' },
      ],
    },
  };

  it.each(Object.entries(rollDefinitions))(
    '1.%s (rollo 80mm) — el body compuesto sólo imprime negro y blanco',
    (_name, def) => {
      const html = composer.compose(def, richData);
      // El interruptor de carril quedó marcado en el documento...
      expect(html).toContain('<body class="print-roll">');
      // ...y el bloque de negro absoluto va cableado para ese carril.
      expect(html).toContain('body.print-roll');
      expect(html).toContain('color: #000 !important');
      // Lo que de verdad se imprime — el body — no tiene un solo color que
      // no sea negro o blanco.
      const colors = bodyColors(html);
      const rogue = colors.filter((c) => !BLACK_AND_WHITE.includes(c));
      expect(rogue).toEqual([]);
    },
  );

  it('2. espejo — un formato de hoja (fiscal_electronic_invoice) SÍ conserva su color de marca', () => {
    const sheetDef: PrintFormatDefinition = {
      v: 2,
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 12,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Segoe UI', Arial, sans-serif",
        font_size_base_pt: 9,
        primary_color: '#1e3a8a',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_dian_header', type: 'fiscal_header', title: 'Cabecera Fiscal', enabled: true, order: 1 },
        { id: 'sec_dian_cufe', type: 'fiscal_cufe_box', title: 'CUFE', enabled: true, order: 2 },
        { id: 'sec_dian_buyer', type: 'fiscal_buyer_info', title: 'Adquirente', enabled: true, order: 3 },
        { id: 'sec_items', type: 'items_table', title: 'Detalle', enabled: true, order: 4 },
        { id: 'sec_dian_taxes', type: 'fiscal_tax_breakdown', title: 'Impuestos', enabled: true, order: 5 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Liquidación', enabled: true, order: 6 },
        { id: 'sec_dian_qr', type: 'fiscal_qr_section', title: 'QR DIAN', enabled: true, order: 7 },
      ],
      columns: [
        { id: 'col_desc', key: 'product_name', label: 'Descripción', enabled: true, width_percent: 60, align: 'left' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 15, align: 'center' },
        { id: 'col_tot', key: 'total_price', label: 'Total', enabled: true, width_percent: 25, align: 'right' },
      ],
    };

    const html = composer.compose(sheetDef, richData);

    // El carril de hoja no entra al bloque de negro absoluto...
    expect(html).toContain('<body class="print-sheet">');
    expect(html).not.toContain('body.print-roll');
    // ...y el color de marca de la plantilla sigue vivo en el documento.
    expect(html).toContain('#1e3a8a');
    expect(html).toContain('color: #1e3a8a');
  });

  /**
   * [tirilla-80mm-legible] — Regresión de la CAPA 1 del plan: la tirilla de
   * 80mm no sólo tenía que dejar de imprimir color (ya cubierto arriba),
   * también tenía que dejar de imprimirse ilegible por margen 0 y por una
   * monoespaciada de asta fina. `paper.margin_mm` es un campo REQUERIDO en
   * `PrintPaperConfig` (ver interfaces/print-format.interface.ts) — los
   * casos "sin margin_mm" usan `as any` a propósito para simular el dato
   * real que puede llegar sin ese campo (plantilla legacy incompleta), no
   * porque el tipo lo permita.
   */
  it('3. rollo sin margin_mm ni per-side — el default es 1.5mm, no 0', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        copies: 1,
      } as any,
      styles: rollStyles(9),
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, richData);
    expect(html).toMatch(/padding:\s*1\.5mm\s*1\.5mm\s*1\.5mm\s*1\.5mm/);
    expect(html).toMatch(/@page\s*\{[\s\S]*margin:\s*1\.5mm/);
  });

  it('4. rollo con margin_mm: 0 explícito — el default de 1.5mm NO pisa un valor configurado', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: rollPaper, // margin_mm: 0 explícito — dato que corrige la capa 2, no este código
      styles: rollStyles(9),
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, richData);
    expect(html).toMatch(/padding:\s*0mm\s*0mm\s*0mm\s*0mm/);
    expect(html).toMatch(/@page\s*\{[\s\S]*margin:\s*0;/);
  });

  it('5. hoja sin márgenes — sigue dando 10mm (sin regresión en el carril de hoja)', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: {
        format: 'letter',
        width_mm: 216,
        height_mm: 280,
        is_roll: false,
        copies: 1,
      } as any,
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, richData);
    expect(html).toMatch(/padding:\s*10mm\s*10mm\s*10mm\s*10mm/);
    expect(html).toMatch(/@page\s*\{[\s\S]*margin:\s*10mm/);
  });

  it('6. rollo con font_family Courier configurado — el body fuerza Arial/Helvetica y "Courier" no aparece en el HTML', () => {
    // rollStyles trae 'Courier New', Courier, monospace — igual que las
    // plantillas reales hoy en prisma/seeds/print-templates.seed.ts.
    const def: PrintFormatDefinition = rollDefinitions.pos_sale_ticket;
    const html = composer.compose(def, richData);
    expect(html).toMatch(/font-family:\s*Arial,\s*Helvetica,\s*sans-serif/);
    expect(html).not.toContain('Courier');
  });

  it('7. hoja con font_family configurado — SÍ se respeta (espejo del carril de hoja)', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 12,
        copies: 1,
      },
      styles: {
        font_family: "'Segoe UI', Arial, sans-serif",
        font_size_base_pt: 9,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, richData);
    expect(html).toContain("font-family: 'Segoe UI', Arial, sans-serif");
  });

  it('8. el bloque de negro absoluto de rollo trae font-weight: 600 !important y -webkit-font-smoothing: none', () => {
    const def: PrintFormatDefinition = rollDefinitions.pos_sale_ticket;
    const html = composer.compose(def, richData);
    expect(html).toContain('font-weight: 600 !important');
    expect(html).toContain('-webkit-font-smoothing: none');
  });

  it('9. precedencia — la regla base de 600 aparece en la cascada ANTES que la de .store-name con 700', () => {
    // La especificidad ((0,2,1) de .store-name > (0,1,1) de la regla base)
    // es lo que de verdad decide, no el orden — pero el plan pide fijar el
    // orden real en la hoja para que no dependa sólo de la especificidad si
    // alguien reescribe un selector mañana. Se asserta por índice de
    // posición en la cadena, no por presencia.
    const def: PrintFormatDefinition = rollDefinitions.pos_sale_ticket;
    const html = composer.compose(def, richData);
    const idxBase600 = html.indexOf('font-weight: 600 !important');
    const idxStoreNameSelector = html.indexOf('body.print-roll .store-name');
    const idx700 = html.indexOf('font-weight: 700 !important');
    expect(idxBase600).toBeGreaterThan(-1);
    expect(idxStoreNameSelector).toBeGreaterThan(-1);
    expect(idx700).toBeGreaterThan(-1);
    expect(idxBase600).toBeLessThan(idxStoreNameSelector);
    expect(idxStoreNameSelector).toBeLessThan(idx700);
  });
});
/**
 * Cotización: la nota, los términos y la vigencia guardados deben llegar al
 * papel.
 *
 * La plantilla sembrada de `quotation` declara `sec_terms` (`custom_notes`) y
 * `sec_validity` (`validity_banner`) SIN `fields`. Antes de este fix ambas
 * caían en `renderGenericFieldsSection`, que devuelve '' cuando no hay
 * campos: la sección estaba habilitada, el dato existía en la base, y el
 * compositor lo descartaba sin error ni log. Es el mismo defecto que ya se
 * había corregido para `table_info` (QUI-733 C.3).
 *
 * La definición es copia fiel de `prisma/seeds/print-templates.seed.ts`
 * (`format_type: 'quotation'`) por la misma razón que el describe anterior:
 * ese archivo vive fuera del `rootDir` de Jest.
 */
describe('PrintLayoutComposerService — cotización: notas, términos y vigencia', () => {
  let composer: PrintLayoutComposerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrintLayoutComposerService, PrintTemplateCompilerService],
    }).compile();

    composer = module.get<PrintLayoutComposerService>(PrintLayoutComposerService);
  });

  const quotationDefinition = (): PrintFormatDefinition =>
    ({
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 18,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "-apple-system, sans-serif",
        font_size_base_pt: 10,
        primary_color: '#2563eb',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Comercial', enabled: true, order: 1 },
        { id: 'sec_validity', type: 'validity_banner', title: 'Vigencia de la Oferta', enabled: true, order: 2 },
        { id: 'sec_terms', type: 'custom_notes', title: 'Términos y Condiciones', enabled: true, order: 3 },
      ],
      columns: [],
    }) as unknown as PrintFormatDefinition;

  const quotationData = (
    overrides: Partial<StandardPrintDataModel['document']> = {},
  ): StandardPrintDataModel => ({
    store: { name: 'Tech Solutions Bogotá' },
    customer: { name: 'Constructora Bolívar' },
    document: {
      id: 140,
      number: 'QT-20260902-0001',
      date: '2026-09-02',
      date_formatted: '02/09/2026',
      state: 'sent',
      state_label: 'Enviada',
      valid_until_formatted: '15/10/2026',
      notes: 'Entrega en obra Bogotá.\nSegunda línea de la nota.',
      terms_and_conditions: 'Pago 50% anticipado, 50% contra entrega.',
      ...overrides,
    },
    items: [],
    taxes: [],
    totals: {
      subtotal: 18800000,
      subtotal_formatted: '$18.800.000',
      discount_total: 0,
      discount_total_formatted: '$0',
      shipping_total: 0,
      shipping_total_formatted: '$0',
      tax_total: 3572000,
      tax_total_formatted: '$3.572.000',
      grand_total: 22372000,
      grand_total_formatted: '$22.372.000',
    },
  });

  /** Sólo el body: el `<head>` contiene la hoja de estilos, cuyos nombres de clase confundirían un grep. */
  function bodyOf(html: string): string {
    const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
    return match ? match[1] : html;
  }

  it('1. la nota guardada se imprime, con sus saltos de línea intactos', () => {
    const body = bodyOf(composer.compose(quotationDefinition(), quotationData()));
    expect(body).toContain('class="print-section section-notes"');
    expect(body).toContain('Entrega en obra Bogotá.');
    expect(body).toContain('Segunda línea de la nota.');
    // El salto sobrevive en el markup; lo pinta `white-space: pre-wrap`.
    expect(body).toMatch(/Entrega en obra Bogotá\.\s*\n\s*Segunda línea/);
  });

  it('2. los términos y condiciones se imprimen bajo su propia etiqueta', () => {
    const body = bodyOf(composer.compose(quotationDefinition(), quotationData()));
    expect(body).toContain('Pago 50% anticipado, 50% contra entrega.');
    expect(body).toContain('data-token="document.terms_and_conditions"');
    // Nota y términos son bloques distintos: rotular la nota como "letra
    // pequeña" era el defecto de presentación de la primera versión.
    expect(body).toContain('data-token="document.notes"');
    expect((body.match(/Términos y Condiciones/g) || []).length).toBe(1);
  });

  it('3. la vigencia y el estado en español se imprimen', () => {
    const body = bodyOf(composer.compose(quotationDefinition(), quotationData()));
    expect(body).toContain('class="print-section section-validity"');
    expect(body).toContain('Oferta válida hasta');
    expect(body).toContain('15/10/2026');
    expect(body).toContain('Enviada');
  });

  it('4. una cotización sin nota ni términos no emite el bloque (ni su etiqueta)', () => {
    const body = bodyOf(
      composer.compose(
        quotationDefinition(),
        quotationData({ notes: undefined, terms_and_conditions: undefined }),
      ),
    );
    expect(body).not.toContain('section-notes');
    expect(body).not.toContain('Términos y Condiciones');
    // La vigencia sigue porque el estado siempre existe.
    expect(body).toContain('section-validity');
  });

  it('5. sin vigencia ni estado, el banner tampoco se emite', () => {
    const body = bodyOf(
      composer.compose(
        quotationDefinition(),
        quotationData({ valid_until_formatted: undefined, state_label: undefined as any }),
      ),
    );
    expect(body).not.toContain('section-validity');
    expect(body).not.toContain('Oferta válida hasta');
  });

  it('6. si la plantilla configura `fields`, manda esa configuración y no el render propio', () => {
    const def = quotationDefinition();
    (def.sections as any[])[2].fields = [
      { id: 'f_custom', key: 'document.notes', label: 'Observaciones', enabled: true },
    ];
    const body = bodyOf(composer.compose(def, quotationData()));
    // Ruta genérica: `Etiqueta: valor` en una fila, con el label de la tienda.
    expect(body).toContain('Observaciones');
    expect(body).toContain('class="print-section section-generic"');
    expect(body).not.toContain('section-notes');
  });

  it('7. en modo tokenized las dos secciones emiten sus píldoras de token para el editor', () => {
    const html = composer.compose(quotationDefinition(), quotationData(), 'tokenized');
    const body = bodyOf(html);
    expect(body).toContain('data-token="document.notes"');
    expect(body).toContain('data-token="document.terms_and_conditions"');
    expect(body).toContain('data-token="document.valid_until_formatted"');
    expect(body).toContain('vendix-token-pill');
  });
});

describe('PrintLayoutComposerService — fiscal_header con datos de factura y resolución DIAN', () => {
  const composer = new PrintLayoutComposerService(new PrintTemplateCompilerService());

  const fiscalData: StandardPrintDataModel = {
    store: {
      name: 'A&ftecnicell',
      legal_name: 'ALMAZO VANEGAS AMILOY ALEXANDRA',
      tax_id: '1123408049-0',
      address: 'CR 21 N 14C-58',
      city: 'Riohacha',
      tax_regime: 'Responsable de IVA',
    },
    document: {
      id: 5,
      number: 'AYFT-5',
      date: '2026-09-02T10:00:00.000Z',
      date_formatted: '02/09/2026',
      state: 'accepted',
      state_label: 'Aprobada por DIAN',
      payment_method: 'Contado (Efectivo)',
    },
    fiscal: {
      cufe: '500af3335bb566ec7bcdef8bcb9b1ed6be50632909592ec0ad16441e933f9dd80d9d89914b23b2716b245d3b9519ae68',
      resolution_number: '18764000001234',
      resolution_prefix: 'AYFT',
      resolution_range_from: 1,
      resolution_range_to: 1000,
      resolution_date: '15/01/2026',
      resolution_valid_from: '15/01/2026',
      resolution_valid_to: '15/01/2027',
    },
    items: [
      {
        index: 1,
        product_name: 'PANTALLA SAMSUNG GALAXY A21S',
        variant_sku: '1',
        quantity: 1,
        unit_price: 40000,
        unit_price_formatted: '$40.000',
        total_price: 40000,
        total_price_formatted: '$40.000',
      },
    ],
    taxes: [],
    totals: {
      subtotal: 40000,
      subtotal_formatted: '$40.000',
      discount_total: 0,
      discount_total_formatted: '$0',
      shipping_total: 0,
      shipping_total_formatted: '$0',
      tax_total: 0,
      tax_total_formatted: '$0',
      grand_total: 40000,
      grand_total_formatted: '$40.000',
      grand_total_in_words: 'CUARENTA MIL PESOS M/CTE',
    },
  };

  it('en hoja carta, fiscal_header renderiza el título, número, fecha y caja de resolución DIAN', () => {
    const sheetDef: PrintFormatDefinition = {
      v: 2,
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 10,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: 'Arial',
        font_size_base_pt: 9,
        primary_color: '#1e3a8a',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_dian_header', type: 'fiscal_header', title: 'Cabecera Fiscal', enabled: true, order: 1 },
      ],
    };

    const html = composer.compose(sheetDef, fiscalData);

    expect(html).toContain('FACTURA ELECTRÓNICA DE VENTA');
    expect(html).toContain('No. AYFT-5');
    expect(html).toContain('Fecha de Emisión: 02/09/2026');
    expect(html).toContain('Forma de Pago: Contado (Efectivo)');
    expect(html).toContain('Resolución DIAN No. 18764000001234 del 15/01/2026');
    expect(html).toContain('Rango autorizado: AYFT1 a AYFT1000');
    expect(html).toContain('Vigencia: 15/01/2026 a 15/01/2027');
    expect(html).toContain('fiscal-header-container');
    expect(html).toContain('fiscal-doc-card');
  });

  it('en rollo 80mm, fiscal_header renderiza el título y la resolución DIAN', () => {
    const rollDef: PrintFormatDefinition = {
      v: 2,
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        margin_mm: 2,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: 'Arial',
        font_size_base_pt: 8.5,
        primary_color: '#000000',
        header_alignment: 'center',
        show_borders: false,
      },
      sections: [
        { id: 'sec_dian_header', type: 'fiscal_header', title: 'Cabecera Fiscal', enabled: true, order: 1 },
        { id: 'sec_doc_info', type: 'document_info', title: 'Datos Venta', enabled: true, order: 2 },
      ],
    };

    const html = composer.compose(rollDef, fiscalData);

    expect(html).toContain('FACTURA ELECTRÓNICA DE VENTA');
    expect(html).toContain('Resolución DIAN No. 18764000001234 del 15/01/2026');
    expect(html).toContain('class="fiscal-doc-card roll-card"');
  });
});

