import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import {
  CURRENCY_PENDING_PLACEHOLDER,
  Currency,
  CurrencyFormatService,
  CurrencyPipe,
} from './currency.pipe';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../environments/environment';

/**
 * Moneda real de la tienda del defecto: peso colombiano, miles con punto y CERO
 * decimales. Es exactamente la combinación que el fallback en-US traiciona
 * (`$100,436.18` en vez de `$100.436`).
 */
const COP: Currency = {
  code: 'COP',
  name: 'Peso colombiano',
  symbol: '$',
  decimal_places: 0,
  position: 'before',
  format_style: 'dot_comma',
  state: 'active',
};

/** Las tres cifras literales de la orden de compra 215 del reporte. */
const UNIT = 436.18;
const SUBTOTAL = 100000;
const TOTAL = 100436.18;

const SETTINGS_URL = `${environment.apiUrl}/store/settings`;
const CURRENCIES_URL = `${environment.apiUrl}/public/currencies/active`;

/** Deja correr la cola de microtareas (las promesas internas del servicio). */
const drain = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Host que consume la moneda por las DOS vías que existen en la app:
 *
 *  - `| currency`  — el pipe impuro, el consumo mayoritario en plantillas.
 *  - `money(...)`  — un helper de componente que llama a
 *    `CurrencyFormatService.format()` directamente. Es el patrón del detalle de
 *    orden de compra (`purchase-order-detail.component.ts`), la pantalla del
 *    defecto, que NO usa el pipe.
 *
 * OnPush a propósito: si el repintado dependiera de que un ancestro corra
 * detección de cambios, este host no se enteraría nunca.
 */
@Component({
  standalone: true,
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span data-testid="pipe-total">{{ total | currency }}</span>
    <span data-testid="method-total">{{ money(total) }}</span>
  `,
})
class CurrencyHostComponent {
  private readonly currency = inject(CurrencyFormatService);
  readonly total = TOTAL;
  money(v: number): string {
    return this.currency.format(v);
  }
}

describe('CurrencyFormatService / CurrencyPipe — formato del tenant', () => {
  let service: CurrencyFormatService;
  let httpMock: HttpTestingController;

  /** Mutable: cada caso decide qué sabe el tenant ANTES de inyectar. */
  let storeId: number | null = null;

  const tenantStub = {
    getCurrentDomainConfig: () => null,
    getCurrentStoreId: () => storeId,
  };

  beforeEach(() => {
    storeId = null;
    localStorage.removeItem('vendix_auth_state');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TenantFacade, useValue: tenantStub },
      ],
    });
  });

  afterEach(() => {
    httpMock?.verify();
    localStorage.removeItem('vendix_auth_state');
  });

  /**
   * Estado del enlace profundo en frío: hay sesión y tienda, pero la moneda
   * todavía viaja por HTTP. El servicio se auto-arranca al inyectarse, así que
   * las precondiciones se fijan ANTES de `TestBed.inject`.
   */
  async function startColdLoad(): Promise<TestRequest> {
    storeId = 10;
    // Sesión válida SIN `store_settings`: es lo que fuerza el GET /store/settings.
    localStorage.setItem(
      'vendix_auth_state',
      JSON.stringify({ user: { id: 1 }, tokens: { access_token: 'tok' } }),
    );

    service = TestBed.inject(CurrencyFormatService);
    httpMock = TestBed.inject(HttpTestingController);

    await drain();
    return httpMock.expectOne(SETTINGS_URL);
  }

  /** Responde los dos saltos de la cascada: ajustes → catálogo de monedas. */
  async function finishColdLoad(settings: TestRequest): Promise<void> {
    settings.flush({ success: true, data: { general: { currency: 'COP' } } });
    await drain();
    httpMock.expectOne(CURRENCIES_URL).flush({ success: true, data: [COP] });
    await drain();
  }

  describe('sin ajustes resueltos (resolution = pending)', () => {
    it('no pinta cifra: devuelve el marcador, nunca un número creíble y equivocado', async () => {
      const settings = await startColdLoad();

      expect(service.resolution()).toBe('pending');
      expect(service.format(UNIT)).toBe(CURRENCY_PENDING_PLACEHOLDER);
      expect(service.format(SUBTOTAL)).toBe(CURRENCY_PENDING_PLACEHOLDER);
      expect(service.format(TOTAL)).toBe(CURRENCY_PENDING_PLACEHOLDER);
      // Lo que NO debe salir: el formato estadounidense del reporte del defecto.
      expect(service.format(TOTAL)).not.toContain('100,436.18');

      await finishColdLoad(settings);
    });
  });

  describe('con ajustes dot_comma / 0 decimales', () => {
    beforeEach(async () => {
      await finishColdLoad(await startColdLoad());
    });

    it('pinta las cifras de la orden en pesos colombianos', () => {
      expect(service.resolution()).toBe('resolved');
      expect(service.format(UNIT)).toBe('$436');
      expect(service.format(SUBTOTAL)).toBe('$100.000');
      expect(service.format(TOTAL)).toBe('$100.436');
    });

    it('respeta el override explícito de decimales', () => {
      expect(service.format(TOTAL, 2)).toBe('$100.436,18');
    });
  });

  describe('cuando la resolución termina sin moneda (resolution = unresolved)', () => {
    it('degrada al fallback histórico en vez de esconder el dinero para siempre', async () => {
      // Sin sesión y sin tienda: la cascada no llega ni a pedir nada.
      service = TestBed.inject(CurrencyFormatService);
      httpMock = TestBed.inject(HttpTestingController);
      await drain();

      expect(service.resolution()).toBe('unresolved');
      expect(service.format(TOTAL)).toBe('$100,436.18');
    });
  });

  describe('transición pending → resolved (el repintado que hoy no ocurre)', () => {
    let fixture: ComponentFixture<CurrencyHostComponent>;

    const textOf = (testid: string) =>
      (fixture.nativeElement as HTMLElement)
        .querySelector(`[data-testid="${testid}"]`)!
        .textContent!.trim();

    it('repinta las cifras ya pintadas cuando la moneda llega, sin tocar nada más', async () => {
      const settings = await startColdLoad();

      fixture = TestBed.createComponent(CurrencyHostComponent);
      fixture.detectChanges();

      expect(textOf('pipe-total')).toBe(CURRENCY_PENDING_PLACEHOLDER);
      expect(textOf('method-total')).toBe(CURRENCY_PENDING_PLACEHOLDER);

      await finishColdLoad(settings);
      await fixture.whenStable();

      // Ni un input cambió, ni hubo click: solo llegó la moneda.
      expect(textOf('pipe-total')).toBe('$100.436');
      expect(textOf('method-total')).toBe('$100.436');
    });
  });
});
