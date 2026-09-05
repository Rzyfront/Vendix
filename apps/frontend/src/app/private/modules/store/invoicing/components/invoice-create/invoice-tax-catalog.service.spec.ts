import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import {
  InvoiceTaxCatalogService,
  taxCatalogLoadMessage,
} from './invoice-tax-catalog.service';
import { environment } from '../../../../../../../environments/environment';

/**
 * Paso 9 del plan AIU — el catálogo distingue cómo terminó la carga.
 *
 * La propiedad custodiada: un 403 y un 500 dejan la lista en `[]` (un
 * catálogo vacío nunca rompe la pantalla) pero el estado expuesto los
 * distingue —`forbidden` frente a `error`— para que la superficie no los
 * presente como «catálogo vacío».
 */
describe('InvoiceTaxCatalogService · estado de carga (paso 9)', () => {
  let service: InvoiceTaxCatalogService;
  let httpMock: HttpTestingController;
  const url = environment.apiUrl + '/store/taxes';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InvoiceTaxCatalogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('carga real: estado ok y tarifas mapeadas a porcentaje', async () => {
    const done = firstValueFrom(service.load());
    httpMock.expectOne((req) => req.url === url).flush({
      success: true,
      data: [
        {
          id: 3,
          name: 'IVA',
          tax_type: 'iva',
          tax_rates: [{ id: 7, name: 'IVA 19%', rate: '0.19000' }],
        },
      ],
    });

    const options = await done;
    expect(service.catalogState()).toBe('ok');
    expect(options).toEqual([
      {
        id: 7,
        name: 'IVA · IVA 19%',
        rate: 19,
        tax_type: 'iva',
        default_is_inclusive: false,
      },
    ]);
  });

  it('403: lista vacía pero estado forbidden (permiso, no vacío)', async () => {
    const done = firstValueFrom(service.load());
    httpMock
      .expectOne((req) => req.url === url)
      .flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    await expectAsync(done).toBeResolvedTo([]);
    expect(service.catalogState()).toBe('forbidden');
    expect(taxCatalogLoadMessage('forbidden')).toContain('store:taxes:read');
  });

  it('500: lista vacía pero estado error (servidor, no vacío)', async () => {
    const done = firstValueFrom(service.load());
    httpMock
      .expectOne((req) => req.url === url)
      .flush('Error', { status: 500, statusText: 'Server Error' });

    await expectAsync(done).toBeResolvedTo([]);
    expect(service.catalogState()).toBe('error');
    expect(taxCatalogLoadMessage('error')).toContain('no respondió');
  });

  it('tras invalidate, una carga buena vuelve el estado a ok', async () => {
    const first = firstValueFrom(service.load());
    httpMock
      .expectOne((req) => req.url === url)
      .flush('Error', { status: 500, statusText: 'Server Error' });
    await first;
    expect(service.catalogState()).toBe('error');

    service.invalidate();
    const second = firstValueFrom(service.load());
    httpMock.expectOne((req) => req.url === url).flush({ success: true, data: [] });
    await expectAsync(second).toBeResolvedTo([]);
    expect(service.catalogState()).toBe('ok');
  });
});
