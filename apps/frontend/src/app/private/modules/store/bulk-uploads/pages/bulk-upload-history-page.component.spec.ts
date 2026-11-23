import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { BulkUploadHistoryPageComponent } from './bulk-upload-history-page.component';
import { BulkUploadLogService } from '../services/bulk-upload-log.service';
import type { BulkUploadLog } from '../bulk-upload-log.interface';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';

/**
 * QUI-1009 — con cargas en curso, el historial se vuelve a pedir solo cada
 * 10 s. Un fallo pasajero de ese refresco no debe vaciar la lista ni detenerlo.
 */
describe('BulkUploadHistoryPageComponent — refresco de cargas en curso (QUI-1009)', () => {
  const list = jasmine.createSpy('list');

  const row = (status: BulkUploadLog['status']): BulkUploadLog =>
    ({ id: 31, upload_type: 'products', status, file_name: 'productos.xlsx' }) as unknown as BulkUploadLog;
  const page = (rows: BulkUploadLog[]) => of({ data: rows, total: rows.length, page: 1, limit: 20 });

  function create(): BulkUploadHistoryPageComponent {
    return TestBed.createComponent(BulkUploadHistoryPageComponent).componentInstance;
  }

  beforeEach(async () => {
    jasmine.clock().install();
    list.calls.reset();
    await TestBed.configureTestingModule({
      imports: [BulkUploadHistoryPageComponent],
      providers: [
        { provide: BulkUploadLogService, useValue: { list } },
        { provide: StoreSettingsFacade, useValue: { timezone: () => 'America/Bogota' } },
      ],
    })
      .overrideComponent(BulkUploadHistoryPageComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
  });

  afterEach(() => jasmine.clock().uninstall());

  it('un fallo del refresco automático conserva la lista y vuelve a intentar a los 10 s', () => {
    list.and.returnValues(
      page([row('running')]),
      throwError(() => new Error('502')),
      page([row('completed')]),
    );
    const component = create();
    expect(component.uploads()[0].status).toBe('running');

    jasmine.clock().tick(10_000);

    expect(list).toHaveBeenCalledTimes(2);
    expect(component.uploads()[0].status).toBe('running');
    expect(component.listError()).toBeNull();
    expect(component.hasActiveUploads()).toBeTrue();

    jasmine.clock().tick(10_000);

    expect(list).toHaveBeenCalledTimes(3);
    expect(component.uploads()[0].status).toBe('completed');
    expect(component.hasActiveUploads()).toBeFalse();
  });

  it('un fallo al pedir la lista a mano sigue vaciándola y mostrando el error', () => {
    list.and.returnValue(throwError(() => new Error('500')));

    const component = create();

    expect(component.uploads()).toEqual([]);
    expect(component.totalItems()).toBe(0);
    expect(component.listError()).toBe('No se pudo cargar el historial de cargas.');
    expect(component.loading()).toBeFalse();
  });
});
