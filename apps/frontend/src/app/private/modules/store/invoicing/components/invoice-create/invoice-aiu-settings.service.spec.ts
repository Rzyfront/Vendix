import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { InvoiceAiuSettingsService } from './invoice-aiu-settings.service';

describe('InvoiceAiuSettingsService', () => {
  let service: InvoiceAiuSettingsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InvoiceAiuSettingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('returns explicit document defaults without reading tenant settings', async () => {
    const settings = await firstValueFrom(service.load());

    expect(settings).toEqual({
      regime: 'et_462_1',
      contract_object: '',
      enforce_minimum_base: true,
      minimum_base_percent: 10,
      note: '',
      note_length: 0,
      note_valid: false,
      note_min_length: 20,
      note_max_length: 5000,
      note_prefix: 'Contrato de servicios AIU por concepto de:',
      is_default: true,
    });
    httpMock.expectNone((request) => request.url.includes('/aiu-settings'));
    httpMock.expectNone((request) => request.url.includes('/store/settings'));
  });
});
