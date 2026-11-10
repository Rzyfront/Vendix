import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { PosCashRegisterService } from './pos-cash-register.service';

// QUI-992 — resolveRegisterId: open session > stored value > null.
describe('PosCashRegisterService.resolveRegisterId', () => {
  let service: PosCashRegisterService;
  let http: HttpTestingController;
  const KEY = 'pos_register_id';
  let originalRegister: string | null;

  beforeEach(() => {
    originalRegister = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PosCashRegisterService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    if (originalRegister === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, originalRegister);
  });

  it('the open session wins over storage and rewrites the stored key', async () => {
    localStorage.setItem(KEY, 'STALE');
    const result = service.resolveRegisterId();
    http
      .expectOne((r) => r.url.endsWith('/sessions/active'))
      .flush({
        data: {
          id: 1,
          cash_register_id: 7,
          status: 'open',
          register: { id: 7, code: 'CAJA-7' },
        },
      });
    expect(await result).toBe('CAJA-7');
    expect(localStorage.getItem(KEY)).toBe('CAJA-7');
  });

  it('uses the stored value when there is no session', async () => {
    localStorage.setItem(KEY, 'POS-01');
    const result = service.resolveRegisterId();
    http
      .expectOne((r) => r.url.endsWith('/sessions/active'))
      .flush({ data: null });
    expect(await result).toBe('POS-01');
  });

  it('returns null when there is neither session nor stored value', async () => {
    const result = service.resolveRegisterId();
    http
      .expectOne((r) => r.url.endsWith('/sessions/active'))
      .flush({ data: null });
    expect(await result).toBeNull();
  });
});
