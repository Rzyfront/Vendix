import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { FiscalRequirementsService } from '../../../../../../shared/services/fiscal-requirements.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { OrgInvoicingService, OrgResolutionRow } from '../../services/org-invoicing.service';
import { OrgInvoiceResolutionsComponent } from './org-invoice-resolutions.component';

describe('OrgInvoiceResolutionsComponent edicion y cambio de tipo', () => {
  function configure(): void {
    const service = jasmine.createSpyObj<OrgInvoicingService>('OrgInvoicingService', [
      'getResolutions',
      'getResolutionsInUse',
      'updateResolution',
      'createResolution',
    ]);
    service.getResolutions.and.returnValue(of({ success: true, data: [] } as any));
    service.getResolutionsInUse.and.returnValue(
      of({ success: true, data: { accounting_entity_id: 1, items: [] } } as any),
    );
    service.updateResolution.and.returnValue(of({ success: true, data: {} } as any));

    TestBed.configureTestingModule({
      providers: [
        { provide: OrgInvoicingService, useValue: service },
        { provide: AuthFacade, useValue: { fiscalScope: () => 'ORGANIZATION' } },
        { provide: ApiErrorService, useValue: { humanize: () => 'error' } },
        { provide: FiscalRequirementsService, useValue: { presentFiscalError: () => false } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['info', 'success']) },
      ],
    });
  }

  it('al editar una serie sin uso, cambiar el tipo actualiza selectedType e isInternalSeries', () => {
    configure();
    const cmp = TestBed.runInInjectionContext(() => new OrgInvoiceResolutionsComponent());
    const row = {
      id: 3,
      document_type: 'sales_invoice',
      resolution_number: '18764000001234',
      prefix: 'FE',
      range_from: 1,
      range_to: 1000,
      current_number: 0,
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_to: '2027-01-01T00:00:00.000Z',
      resolution_date: '2026-01-01T00:00:00.000Z',
      is_active: true,
    } as unknown as OrgResolutionRow;

    cmp.openEditModal(row);
    expect(cmp.isInternalSeries()).toBeFalse();

    cmp.resolutionForm.controls.document_type.setValue('credit_note');

    expect(cmp.selectedType()).toBe('credit_note');
    expect(cmp.isInternalSeries()).toBeTrue();
    // Serie interna: el numero de resolucion deja de ser obligatorio.
    cmp.resolutionForm.controls.resolution_number.setValue('');
    expect(cmp.resolutionForm.controls.resolution_number.valid).toBeTrue();
  });
});
