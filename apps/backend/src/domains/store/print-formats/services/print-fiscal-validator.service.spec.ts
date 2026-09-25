import { Test, TestingModule } from '@nestjs/testing';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { VendixHttpException } from 'src/common/errors';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';

describe('PrintFiscalValidatorService', () => {
  let service: PrintFiscalValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrintFiscalValidatorService],
    }).compile();

    service = module.get<PrintFiscalValidatorService>(PrintFiscalValidatorService);
  });

  // `pos_sale_ticket` salió de esta canasta: desde la paridad FE exige leyenda
  // no fiscal (casos abajo). `kitchen_ticket` sigue siendo no fiscal sin
  // chequeos y preserva la intención del caso (B.6 intacto).
  it('should pass validation for non-fiscal formats without checks', () => {
    const nonFiscalDef: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [],
    };

    expect(() =>
      service.assertFiscalCompliance(
        'kitchen_ticket' as unknown as 'fiscal_electronic_invoice',
        nonFiscalDef,
      ),
    ).not.toThrow();
  });

  it('should reject fiscal invoice missing mandatory sections (CUFE, QR, items, totals)', () => {
    const invalidFiscalDef: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [
        { id: '1', type: 'header', title: 'Header', enabled: true, order: 1 },
        // missing cufe, qr, items, totals
      ],
    };

    expect(() =>
      service.assertFiscalCompliance('fiscal_electronic_invoice', invalidFiscalDef),
    ).toThrow(VendixHttpException);
  });

  it('should accept fiscal invoice with all mandatory sections enabled', () => {
    const validFiscalDef: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [
        { id: '1', type: 'fiscal_header', title: 'Header', enabled: true, order: 1 },
        { id: '2', type: 'fiscal_cufe_box', title: 'CUFE', enabled: true, order: 2 },
        { id: '3', type: 'items_table', title: 'Items', enabled: true, order: 3 },
        { id: '4', type: 'totals_summary', title: 'Totals', enabled: true, order: 4 },
        { id: '5', type: 'fiscal_qr_section', title: 'QR', enabled: true, order: 5 },
      ],
    };

    expect(() =>
      service.assertFiscalCompliance('fiscal_electronic_invoice', validFiscalDef),
    ).not.toThrow();
  });

  it('should reject custom fiscal template missing CUFE or QR tokens', () => {
    const invalidCustomDef: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [],
      custom_template: '<div>Factura de {{store.name}} pero sin QR ni CUFE</div>',
    };

    expect(() =>
      service.assertFiscalCompliance('fiscal_electronic_invoice', invalidCustomDef),
    ).toThrow(VendixHttpException);
  });

  // CP-DTLP-20260827 (Phase B.6) — dispatch_ticket es NO fiscal: aunque el
  // usuario suba una custom_template sin {{fiscal.cufe}}, NO debe lanzar
  // 422. Antes de B.6 la guarda vivía en una comparación explícita de dos
  // valores; ahora es declarativa via FISCAL_FORMATS.
  it('should NOT reject dispatch_ticket with custom_template missing CUFE (non-fiscal)', () => {
    const dispatchCustomDef: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [],
      custom_template: '<div>Despacho de {{customer.name}} sin CUFE (no aplica)</div>',
    };

    expect(() =>
      service.assertFiscalCompliance(
        'dispatch_ticket' as unknown as 'fiscal_electronic_invoice',
        dispatchCustomDef,
      ),
    ).not.toThrow();
  });

  // CP-DTLP-20260827 (Phase B.6) — quotation ya era no-fiscal antes; este test
  // fija el invariante de que ningún formato fuera de FISCAL_FORMATS dispara
  // PRINT_FISCAL_STRUCTURE_VIOLATION_001, sin importar qué tan "vacía" luzca
  // la custom_template.
  it('should NOT reject quotation with empty custom_template (non-fiscal baseline)', () => {
    const quotationEmptyDef: PrintFormatDefinition = {
      paper: { format: 'letter', width_mm: 216, is_roll: false, margin_mm: 18, copies: 1 },
      sections: [],
      custom_template: '',
    };

    expect(() =>
      service.assertFiscalCompliance('quotation', quotationEmptyDef),
    ).not.toThrow();
  });

  // Paridad FE — el tiquete POS exige leyenda no fiscal con código propio
  // (el invariante B.6 reserva PRINT_FISCAL_STRUCTURE_VIOLATION_001 a fiscales).
  it('should reject pos_sale_ticket structured without enabled f_disclaimer', () => {
    const def: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [
        {
          id: 'sec_footer', type: 'footer', title: 'Pie', enabled: true, order: 6,
          fields: [
            { id: 'f_msg', key: 'receipts.receipt_footer', label: 'Mensaje', enabled: true, position: 'center' },
          ],
        },
      ],
    };

    let err: any;
    try {
      service.assertFiscalCompliance('pos_sale_ticket', def);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(VendixHttpException);
    expect(err.errorCode).toBe('PRINT_TICKET_DISCLAIMER_REQUIRED_001');
  });

  it('should reject pos_sale_ticket custom without the disclaimer token', () => {
    const def: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [],
      custom_template: '<div>Ticket de {{store.name}} sin leyenda</div>',
    };

    let err: any;
    try {
      service.assertFiscalCompliance('pos_sale_ticket', def);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(VendixHttpException);
    expect(err.errorCode).toBe('PRINT_TICKET_DISCLAIMER_REQUIRED_001');
  });

  it('should accept pos_sale_ticket structured with enabled f_disclaimer', () => {
    const def: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [
        {
          id: 'sec_footer', type: 'footer', title: 'Pie', enabled: true, order: 6,
          fields: [
            { id: 'f_disclaimer', key: 'document.non_fiscal_disclaimer', label: 'Leyenda', enabled: true, position: 'center' },
          ],
        },
      ],
    };

    expect(() =>
      service.assertFiscalCompliance('pos_sale_ticket', def),
    ).not.toThrow();
  });

  it('should accept pos_sale_ticket custom containing the disclaimer token', () => {
    const def: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [],
      custom_template: '<div>Ticket</div><p>{{document.non_fiscal_disclaimer}}</p>',
    };

    expect(() =>
      service.assertFiscalCompliance('pos_sale_ticket', def),
    ).not.toThrow();
  });
});
