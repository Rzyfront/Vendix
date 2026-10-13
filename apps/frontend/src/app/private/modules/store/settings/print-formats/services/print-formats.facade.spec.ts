import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PrintGatewayClientService } from '../../../../../../shared/services/print/print-gateway-client.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { StorePrintFormatDetail } from '../../../../../../core/models/print-formats.model';
import { PrintFormatsFacade } from './print-formats.facade';

describe('PrintFormatsFacade POS legacy draft preparation', () => {
  let facade: PrintFormatsFacade;
  let client: jasmine.SpyObj<PrintGatewayClientService>;
  let toast: jasmine.SpyObj<ToastService>;

  const detail = (): StorePrintFormatDetail => ({
    format_type: 'pos_sale_ticket', name: 'Ticket POS', category: 'Ventas POS', is_active: true,
    gateway_enabled: true, is_customized: true, template_id: null, template_name: 'Legacy',
    definition: {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
      sections: [{ id: 'sec_footer', type: 'footer', title: 'Mi pie', enabled: true, order: 8,
        custom_content: 'texto preservado', fields: [{ id: 'f_msg', key: 'receipts.receipt_footer', label: 'Mi despedida', enabled: true, position: 'left' }] }],
      columns: [{ id: 'col_desc', key: 'description', label: 'Detalle propio', enabled: true, width_percent: 100, align: 'left' }],
      styles: { font_family: 'Courier New', primary_color: '#123456' },
    },
    overrides: null, available_tokens: [],
  });

  beforeEach(() => {
    client = jasmine.createSpyObj<PrintGatewayClientService>('PrintGatewayClientService', [
      'getFormatDetail', 'previewFormat', 'cloneLibraryTemplate', 'listFormats',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['info', 'error', 'success']);
    client.previewFormat.and.returnValue(of({ html: '<p>preview</p>', width_mm: 80, is_roll: true, definition: detail().definition }));
    client.listFormats.and.returnValue(of([]));
    TestBed.configureTestingModule({ providers: [
      PrintFormatsFacade,
      { provide: PrintGatewayClientService, useValue: client },
      { provide: ToastService, useValue: toast },
    ] });
    facade = TestBed.inject(PrintFormatsFacade);
  });

  it('repairs on load while retaining styles, custom fields, and sections without mutating the API detail', async () => {
    const response = detail();
    client.getFormatDetail.and.returnValue(of(response));
    await facade.selectFormat('pos_sale_ticket');

    const draft = facade.draftDefinition()!;
    expect(draft.sections[0].fields).toEqual([
      jasmine.objectContaining({ id: 'f_msg', label: 'Mi despedida', position: 'left' }),
      jasmine.objectContaining({ id: 'f_disclaimer', enabled: true, position: 'center' }),
    ]);
    expect(draft.sections[0].custom_content).toBe('texto preservado');
    expect(draft.styles).toEqual({ font_family: 'Courier New', primary_color: '#123456' });
    expect(draft.columns).toEqual(response.definition.columns);
    expect(response.definition.sections[0].fields).toHaveSize(1);
    expect(toast.info).toHaveBeenCalled();
  });

  it('repairs a cloned POS template and preserves its customizations', async () => {
    const response = detail();
    client.cloneLibraryTemplate.and.returnValue(of(response));
    await facade.cloneTemplate(42);

    expect(facade.draftDefinition()?.sections[0].fields?.map((field) => field.id)).toEqual(['f_msg', 'f_disclaimer']);
    expect(facade.draftDefinition()?.styles?.font_family).toBe('Courier New');
    expect(facade.draftDefinition()?.sections[0].custom_content).toBe('texto preservado');
    expect(toast.info).toHaveBeenCalled();
  });
});
