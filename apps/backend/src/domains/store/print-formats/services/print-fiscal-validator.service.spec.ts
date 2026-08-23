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

  it('should pass validation for non-fiscal formats without checks', () => {
    const nonFiscalDef: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [],
    };

    expect(() =>
      service.assertFiscalCompliance('pos_sale_ticket', nonFiscalDef),
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
});
