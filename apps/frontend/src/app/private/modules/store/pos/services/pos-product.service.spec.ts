import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { Product, PosProductService, ScaleCodeLookupResult } from './pos-product.service';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';

/**
 * Búsqueda por código de balanza: `lookupWeightProductByScaleCode` (probador
 * de formatos de etiqueta) distingue cada motivo, y `getWeightProductByScaleCode`
 * (POS) se apoya en él y aplana todo lo que no es "encontrado" a `null`.
 */
describe('PosProductService — búsqueda por código de balanza', () => {
  let service: PosProductService;
  let http: HttpTestingController;

  const weightProduct = { id: 7, name: 'Queso costeño', pricing_type: 'weight', price: 32000 };
  const unitProduct = { id: 8, name: 'Queso en tajadas', pricing_type: 'unit', price: 9000 };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: StoreContextService, useValue: {} },
        { provide: StoreSettingsFacade, useValue: { settings: () => null } },
      ],
    });
    service = TestBed.inject(PosProductService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Responde la única petición pendiente con la forma estándar del backend. */
  function respond(data: unknown[]): void {
    const req = http.expectOne((r) => r.url.endsWith('/store/products'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('scale_code')).toBe('1234');
    expect(req.request.params.get('is_lodging')).toBe('false');
    req.flush({ success: true, data });
  }

  function lookup(): { result?: ScaleCodeLookupResult; error?: unknown } {
    const out: { result?: ScaleCodeLookupResult; error?: unknown } = {};
    service.lookupWeightProductByScaleCode(1234).subscribe({
      next: (r) => (out.result = r),
      error: (e) => (out.error = e),
    });
    return out;
  }

  describe('lookupWeightProductByScaleCode', () => {
    it('sin resultados → not_found', () => {
      const out = lookup();
      respond([]);
      expect(out.result).toEqual({ status: 'not_found' });
    });

    it('un producto de peso → found con el producto', () => {
      const out = lookup();
      respond([weightProduct]);
      expect(out.result?.status).toBe('found');
      expect(out.result?.status === 'found' && out.result.product.name).toBe('Queso costeño');
    });

    it('varios productos → multiple con la cantidad', () => {
      const out = lookup();
      respond([weightProduct, { ...weightProduct, id: 9 }, { ...weightProduct, id: 10 }]);
      expect(out.result).toEqual({ status: 'multiple', count: 3 });
    });

    it('un producto que no se vende por peso → not_weight con el producto', () => {
      const out = lookup();
      respond([unitProduct]);
      expect(out.result?.status).toBe('not_weight');
      expect(out.result?.status === 'not_weight' && out.result.product.name).toBe(
        'Queso en tajadas',
      );
    });

    it('acepta la respuesta paginada (data.data)', () => {
      const out = lookup();
      const req = http.expectOne((r) => r.url.endsWith('/store/products'));
      req.flush({ success: true, data: { data: [weightProduct], meta: { total: 1 } } });
      expect(out.result?.status).toBe('found');
    });

    it('un error HTTP se propaga y un reintento vuelve a consultar', () => {
      const first = lookup();
      http
        .expectOne((r) => r.url.endsWith('/store/products'))
        .flush('caído', { status: 503, statusText: 'Service Unavailable' });
      expect(first.result).toBeUndefined();
      expect(first.error).toBeTruthy();

      // El probador reintenta con la misma llamada; esta vez responde bien.
      const retry = lookup();
      respond([weightProduct]);
      expect(retry.result?.status).toBe('found');
    });
  });

  describe('getWeightProductByScaleCode (POS) conserva su comportamiento', () => {
    function pos(): { value?: Product | null } {
      const out: { value?: Product | null } = {};
      service.getWeightProductByScaleCode(1234).subscribe((v) => (out.value = v));
      return out;
    }

    it('devuelve el producto solo si hay uno y es de peso', () => {
      const out = pos();
      respond([weightProduct]);
      expect(out.value?.name).toBe('Queso costeño');
    });

    it('sin resultados, varios o no de peso → null', () => {
      for (const data of [[], [weightProduct, { ...weightProduct, id: 9 }], [unitProduct]]) {
        const out = pos();
        respond(data);
        expect(out.value).toBeNull();
      }
    });

    it('un error HTTP → null (no rompe el escaneo)', () => {
      const out = pos();
      http
        .expectOne((r) => r.url.endsWith('/store/products'))
        .flush('caído', { status: 500, statusText: 'Server Error' });
      expect(out.value).toBeNull();
    });
  });
});
