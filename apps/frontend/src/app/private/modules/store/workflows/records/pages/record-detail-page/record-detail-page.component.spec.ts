import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { throwError } from 'rxjs';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { DialogService, ToastService } from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { RecordDetail } from '../../interfaces/records.interfaces';
import { RecordsApiService } from '../../services/records-api.service';
import { RecordDetailPageComponent } from './record-detail-page.component';

const RECORD = { id: 5, flows: [{ id: 9, key: 'renovacion', name: 'Renovación' }] } as unknown as RecordDetail;

const planLimit = () =>
  new HttpErrorResponse({
    status: 402,
    error: { error_code: 'WORKFLOW_PLAN_LIMIT_REACHED', message: 'Llegaste al límite de tu plan.' },
  });

const rejected = () =>
  new HttpErrorResponse({
    status: 422,
    error: { error_code: 'WORKFLOW_FORM_INVALID', message: 'Falta: Contrato' },
  });

describe('RecordDetailPageComponent · plan limit (P7.1)', () => {
  let api: jasmine.SpyObj<RecordsApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let page: RecordDetailPageComponent;

  const picked = () =>
    ({ target: { files: [new File(['%PDF'], 'contrato.pdf')], value: 'contrato.pdf' } }) as unknown as Event;

  beforeEach(() => {
    api = jasmine.createSpyObj('RecordsApiService', ['uploadFile', 'startFlow']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: RecordsApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: DialogService, useValue: { confirm: () => Promise.resolve(false) } },
        { provide: StoreSettingsFacade, useValue: { timezone: signal('America/Bogota') } },
        { provide: CurrencyPipe, useValue: { transform: (n: number) => String(n) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map() } } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });
    page = TestBed.runInInjectionContext(() => new RecordDetailPageComponent());
    page.detail.set(RECORD);
  });

  it('al iniciar un flujo con el límite del plan no agrega un error propio al paywall', () => {
    api.startFlow.and.returnValue(throwError(() => planLimit()));
    page.startFlow(RECORD.id, 9);
    expect(page.startError()).toBe('');
    expect(page.starting()).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('al iniciar un flujo, otro rechazo sí muestra su mensaje', () => {
    api.startFlow.and.returnValue(throwError(() => rejected()));
    page.startFlow(RECORD.id, 9);
    expect(page.startError()).toBe('Falta: Contrato');
  });

  it('al subir un archivo con el almacenamiento al tope no agrega un error propio al paywall', () => {
    api.uploadFile.and.returnValue(throwError(() => planLimit()));
    page.onFilePicked(picked());
    expect(api.uploadFile).toHaveBeenCalledTimes(1);
    expect(page.uploadError()).toBe('');
    expect(page.uploading()).toBeFalse();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('al subir un archivo, otro rechazo sí muestra su mensaje', () => {
    api.uploadFile.and.returnValue(throwError(() => rejected()));
    page.onFilePicked(picked());
    expect(page.uploadError()).toBe('Falta: Contrato');
  });
});
