import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideMockStore } from '@ngrx/store/testing';
import { of, throwError } from 'rxjs';

import { SupportDocumentsReportPageComponent } from './support-documents-report-page.component';
import { SupportDocumentsReportService } from '../../services/support-documents-report.service';
import { ReportExportService } from '../../services/report-export.service';
import { selectDateRange } from '../../state/reports.selectors';
import {
  SupportDocumentReportRow,
  SupportDocumentsListResponse,
  SupportDocumentsReportQuery,
  SupportDocumentsSummary,
} from '../../interfaces/support-documents-report.interface';
import { SuppliersService } from '../../../inventory/services/suppliers.service';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../../shared/components';
import { storeToday } from '../../../../../../shared/utils/date.util';

const TZ = 'America/Bogota';

const row = (over: Partial<SupportDocumentReportRow> = {}): SupportDocumentReportRow => ({
  id: 1,
  issue_date: '2026-11-03T00:00:00.000Z',
  invoice_type: 'support_document',
  invoice_number: 'DS-1',
  status: 'accepted',
  dian_status: 'accepted',
  supplier_id: 11,
  supplier_name: 'Proveedor Uno',
  supplier_tax_id: '900111',
  cuds: 'abc',
  related_invoice_number: null,
  subtotal_amount: 1000,
  tax_amount: 190,
  withholding_amount: 25,
  total_amount: 1190,
  currency: 'COP',
  accepted_at: '2026-11-03T15:00:00.000Z',
  counts_in_totals: true,
  ...over,
});

const listResponse = (rows: SupportDocumentReportRow[]): SupportDocumentsListResponse => ({
  success: true,
  data: rows,
  meta: { total: rows.length, page: 1, limit: 25, totalPages: 1 },
});

const summary: SupportDocumentsSummary = {
  document_count: 2,
  excluded_count: 1,
  support: { count: 1, subtotal_amount: 1000, tax_amount: 190, withholding_amount: 25, total_amount: 1190 },
  adjustment: { count: 1, subtotal_amount: 100, tax_amount: 19, withholding_amount: 0, total_amount: 119 },
  net: { subtotal_amount: 900, tax_amount: 171, withholding_amount: 25, total_amount: 1071 },
};

describe('SupportDocumentsReportPageComponent', () => {
  let fixture: ComponentFixture<SupportDocumentsReportPageComponent>;
  let component: SupportDocumentsReportPageComponent;
  let service: jasmine.SpyObj<SupportDocumentsReportService>;
  let exportService: jasmine.SpyObj<ReportExportService>;
  let toast: jasmine.SpyObj<ToastService>;

  const lastListQuery = (): SupportDocumentsReportQuery =>
    service.getList.calls.mostRecent().args[0];
  const lastSummaryQuery = (): SupportDocumentsReportQuery =>
    service.getSummary.calls.mostRecent().args[0];
  const dropdown = () => fixture.debugElement.query(By.css('app-options-dropdown'));

  beforeEach(() => {
    service = jasmine.createSpyObj<SupportDocumentsReportService>(
      'SupportDocumentsReportService',
      ['getList', 'getSummary', 'exportXlsx'],
    );
    service.getList.and.returnValue(of(listResponse([row(), row({
      id: 2,
      invoice_type: 'support_adjustment_note',
      invoice_number: 'NAS-1',
      status: 'voided',
      related_invoice_number: 'DS-1',
      counts_in_totals: false,
    })])));
    service.getSummary.and.returnValue(of(summary));
    service.exportXlsx.and.returnValue(of(new Blob(['xlsx'])));
    exportService = jasmine.createSpyObj<ReportExportService>('ReportExportService', ['downloadBlob']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success']);

    TestBed.configureTestingModule({
      imports: [SupportDocumentsReportPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideMockStore({
          selectors: [
            {
              selector: selectDateRange,
              value: { start_date: '2026-10-01', end_date: '2026-10-31', preset: 'lastMonth' },
            },
          ],
        }),
        { provide: SupportDocumentsReportService, useValue: service },
        {
          provide: SuppliersService,
          useValue: {
            getSuppliers: () =>
              of({ success: true, data: [{ id: 11, name: 'Proveedor Uno', tax_id: '900111' }] }),
          },
        },
        { provide: StoreSettingsFacade, useValue: { timezone: () => TZ } },
        { provide: CurrencyFormatService, useValue: { format: (v: number) => `$${v}` } },
        { provide: ReportExportService, useValue: exportService },
        { provide: ToastService, useValue: toast },
      ],
    });
    // Render superficial: se prueba el cableado de la página, no los hijos compartidos.
    TestBed.overrideComponent(SupportDocumentsReportPageComponent, {
      set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });

    fixture = TestBed.createComponent(SupportDocumentsReportPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga lista y totales con el período compartido de Compras (preset por nombre)', () => {
    expect(service.getList).toHaveBeenCalledTimes(1);
    expect(service.getSummary).toHaveBeenCalledTimes(1);
    expect(lastListQuery()).toEqual({ page: 1, limit: 25, date_preset: 'lastMonth' });
    expect(lastSummaryQuery()).toEqual(lastListQuery());
    expect(component.totalItems()).toBe(2);
    expect(component.summary()).toEqual(summary);
  });

  it('aplana filas: tipo, estado y si suma en totales', () => {
    const [support, note] = component.viewRows();
    expect(support.type_label).toBe('Documento soporte');
    expect(support.counts_label).toBe('Sí');
    expect(note.type_label).toBe('Nota de ajuste');
    expect(note.related_invoice_number).toBe('DS-1');
    expect(note.counts_label).toBe('No');
    expect(component.countText()).toBe('1 soporte · 1 ajuste · 1 anulados/cancelados fuera');
    expect(component.totalText()).toBe('Soporte $1190 − ajustes $119');
  });

  it('los filtros del dropdown disparan la consulta de lista y totales', () => {
    component.onPageChange(3);
    dropdown().triggerEventHandler('filterChange', {
      status: ['accepted', 'rejected', 'bogus'],
      invoice_type: ['support_adjustment_note'],
      supplier_id: '11',
    });

    const expected: SupportDocumentsReportQuery = {
      page: 1,
      limit: 25,
      date_preset: 'lastMonth',
      status: ['accepted', 'rejected'],
      invoice_type: ['support_adjustment_note'],
      supplier_id: 11,
    };
    expect(lastListQuery()).toEqual(expected);
    expect(lastSummaryQuery()).toEqual(expected);
    expect(component.filterValues()).toEqual({
      status: ['accepted', 'rejected'],
      invoice_type: ['support_adjustment_note'],
      supplier_id: '11',
    });
  });

  it('un rango propio viaja como fechas explícitas (custom)', () => {
    fixture.debugElement
      .query(By.css('vendix-date-range-filter'))
      .triggerEventHandler('valueChange', {
        start_date: '2026-11-01',
        end_date: '2026-11-15',
        preset: 'custom',
      });

    expect(lastListQuery()).toEqual({
      page: 1,
      limit: 25,
      date_preset: 'custom',
      date_from: '2026-11-01',
      date_to: '2026-11-15',
    });
    expect(service.getSummary).toHaveBeenCalledTimes(2);
  });

  it('limpiar filtros vuelve al mes en curso sin estado, tipo ni proveedor', () => {
    dropdown().triggerEventHandler('filterChange', { status: ['voided'], invoice_type: [], supplier_id: '11' });
    dropdown().triggerEventHandler('clearAllFilters', undefined);

    expect(lastListQuery()).toEqual({ page: 1, limit: 25, date_preset: 'thisMonth' });
    expect(component.hasFilters()).toBeFalse();
  });

  it('ordenar por total envía sort_by y sort_order', () => {
    component.onSort({ column: 'total_amount', direction: 'asc' });
    expect(lastListQuery()).toEqual(
      jasmine.objectContaining({ sort_by: 'total_amount', sort_order: 'asc', page: 1 }),
    );
  });

  it('el botón Exportar XLSX descarga el dataset completo con los filtros activos', () => {
    const action = component.dropdownActions().find((a) => a.action === 'export-xlsx');
    expect(action?.label).toBe('Exportar XLSX');

    dropdown().triggerEventHandler('filterChange', {
      status: ['accepted'],
      invoice_type: [],
      supplier_id: null,
    });
    component.onPageChange(2);
    dropdown().triggerEventHandler('actionClick', 'export-xlsx');

    expect(service.exportXlsx).toHaveBeenCalledOnceWith({
      date_preset: 'lastMonth',
      status: ['accepted'],
    });
    expect(exportService.downloadBlob).toHaveBeenCalledOnceWith(
      jasmine.any(Blob),
      `documentos_soporte_${storeToday(TZ)}`,
    );
    expect(component.exporting()).toBeFalse();
  });

  it('si el export falla avisa y libera el botón', () => {
    service.exportXlsx.and.returnValue(throwError(() => new Error('boom')));
    dropdown().triggerEventHandler('actionClick', 'export-xlsx');

    expect(exportService.downloadBlob).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(component.exporting()).toBeFalse();
  });
});
