import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { VexiPublicWidgetComponent } from './vexi-public-widget.component';
import { VexiPublicApi, VexiPublicConfig } from './vexi-public.api';
import { VexiPublicPresenceService } from './vexi-public-presence.service';
import { TenantFacade } from '../../core/store/tenant/tenant.facade';
import { AuthFacade } from '../../core/store/auth/auth.facade';
import { AppType } from '../../core/models/environment.enum';
import { CartService } from '../../private/modules/ecommerce/services/cart.service';
import { CheckoutService } from '../../private/modules/ecommerce/services/checkout.service';
import { StoreUiService } from '../../private/modules/ecommerce/services/store-ui.service';
import { PqrService } from '../../shared/services/pqr.service';
import { CurrencyFormatService } from '../../shared/pipes/currency/currency.pipe';

@Component({ standalone: true, template: '' })
class BlankPage {}

/** Vexi público F2 — the storefront widget. */
describe('VexiPublicWidgetComponent', () => {
  let fixture: ComponentFixture<VexiPublicWidgetComponent>;
  let api: jasmine.SpyObj<VexiPublicApi>;
  const domainConfig = signal<any>(null);
  const lastPlacedOrder = signal<any>(null);

  const ENABLED: VexiPublicConfig = {
    enabled: true,
    name: 'Vexi',
    greeting: '¡Hola! Soy Vexi, de Tienda Demo.',
    whatsapp_number: '573001234567',
    store_name: 'Tienda Demo',
  };

  async function setup(appType: AppType, config: VexiPublicConfig | null) {
    sessionStorage.clear();
    domainConfig.set({ environment: appType, store_id: 10, customConfig: { ecommerce: { checkout: {} } } });
    lastPlacedOrder.set(null);
    api = jasmine.createSpyObj<VexiPublicApi>('VexiPublicApi', [
      'getConfig',
      'createSession',
      'sendMessage',
    ]);
    api.getConfig.and.returnValue(
      of(config ?? { ...ENABLED, enabled: false, greeting: '', store_name: null, whatsapp_number: null }),
    );
    api.createSession.and.returnValue(
      of({ session_id: 's-1', token: 't-1', expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    );
    api.sendMessage.and.returnValue(of({ reply: 'Claro, te ayudo.', cards: [] }));

    await TestBed.configureTestingModule({
      imports: [VexiPublicWidgetComponent],
      providers: [
        provideRouter([{ path: '**', component: BlankPage }]),
        { provide: VexiPublicApi, useValue: api },
        { provide: TenantFacade, useValue: { domainConfig } },
        { provide: AuthFacade, useValue: { isAuthenticated: signal(false) } },
        { provide: CartService, useValue: { cart: signal(null), addToCart: () => undefined } },
        { provide: CheckoutService, useValue: { lastPlacedOrder } },
        { provide: StoreUiService, useValue: { openLoginModal: jasmine.createSpy('openLoginModal') } },
        { provide: PqrService, useValue: { createPublic: () => of({ success: true, data: { ticket_number: 'PQR-1' } }) } },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => undefined, format: (v: number) => `$${v}` } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VexiPublicWidgetComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (testId: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  async function openAndAccept() {
    q('vexi-public-bubble')!.click();
    fixture.detectChanges();
    q('vexi-public-accept')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('flag off (vexi_public.enabled false) → no bubble and Vexi is not active', async () => {
    await setup(AppType.STORE_ECOMMERCE, null);
    expect(api.getConfig).toHaveBeenCalledTimes(1);
    expect(q('vexi-public-bubble')).toBeNull();
    expect(TestBed.inject(VexiPublicPresenceService).active()).toBeFalse();
  });

  it('not a public store app (admin) → no config request and no bubble', async () => {
    await setup(AppType.STORE_ADMIN, ENABLED);
    expect(api.getConfig).not.toHaveBeenCalled();
    expect(q('vexi-public-bubble')).toBeNull();
  });

  for (const app of [AppType.STORE_ECOMMERCE, AppType.STORE_PRODUCT_PAGE, AppType.STORE_SERVICE_PAGE]) {
    it(`flag on in ${app} → WhatsApp-style bubble and the WhatsApp button yields to it`, async () => {
      await setup(app, ENABLED);
      const bubble = q('vexi-public-bubble')!;
      expect(bubble).not.toBeNull();
      expect(bubble.className).toContain('bg-[#25D366]');
      expect(TestBed.inject(VexiPublicPresenceService).active()).toBeTrue();
    });
  }

  for (const url of ['/checkout', '/pagar/tok-9']) {
    it(`hides the bubble on the payment route ${url}`, async () => {
      await setup(AppType.STORE_ECOMMERCE, ENABLED);
      expect(q('vexi-public-bubble')).not.toBeNull();
      await TestBed.inject(Router).navigateByUrl(url);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(q('vexi-public-bubble')).toBeNull();
    });
  }

  it('shows the data notice before the first message; nothing is sent until accepted', async () => {
    await setup(AppType.STORE_ECOMMERCE, ENABLED);
    q('vexi-public-bubble')!.click();
    fixture.detectChanges();
    expect(q('vexi-public-consent')).not.toBeNull();
    expect(text()).toContain('tratamiento de datos');
    expect(fixture.nativeElement.querySelector('input[aria-label="Mensaje para Vexi"]')).toBeNull();
    expect(api.createSession).not.toHaveBeenCalled();

    q('vexi-public-accept')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('vexi-public-consent')).toBeNull();
    expect(text()).toContain('¡Hola! Soy Vexi, de Tienda Demo.');
  });

  it('text only: a reply has no listen button, no audio element and no speech synthesis', async () => {
    await setup(AppType.STORE_ECOMMERCE, ENABLED);
    const speak = spyOn(window.speechSynthesis, 'speak');
    await openAndAccept();
    const cmp = fixture.componentInstance;
    cmp.draft.set('léemelo en voz alta');
    cmp.send();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.sendMessage).toHaveBeenCalled();
    expect(text()).toContain('Claro, te ayudo.');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('audio')).toBeNull();
    expect(el.textContent).not.toMatch(/escuchar/i);
    expect(el.querySelector('[aria-label*="scuchar"], [aria-label*="voz"]')).toBeNull();
    expect(speak).not.toHaveBeenCalled();
  });

  it('daily cap → shows the cap state, locks the input and offers the store WhatsApp', async () => {
    await setup(AppType.STORE_ECOMMERCE, ENABLED);
    api.sendMessage.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 429, error: { error_code: 'VEXI_PUBLIC_DAILY_CAP' } })),
    );
    await openAndAccept();
    const cmp = fixture.componentInstance;
    cmp.draft.set('hola');
    cmp.send();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('vexi-public-error')?.getAttribute('data-state')).toBe('daily_cap');
    expect(cmp.blocked()).toBeTrue();
    expect(text()).toContain('Abrir WhatsApp');
  });

  it('rate limit → asks to wait without locking the chat', async () => {
    await setup(AppType.STORE_ECOMMERCE, ENABLED);
    api.sendMessage.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 429, error: { error_code: 'VEXI_PUBLIC_RATE_LIMITED' } })),
    );
    await openAndAccept();
    const cmp = fixture.componentInstance;
    cmp.draft.set('hola');
    cmp.send();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('vexi-public-error')?.getAttribute('data-state')).toBe('rate_limited');
    expect(cmp.blocked()).toBeFalse();
  });

  it('store requires registration → Vexi says so and offers login, nothing goes to the cart', async () => {
    await setup(AppType.STORE_ECOMMERCE, ENABLED);
    domainConfig.set({
      environment: AppType.STORE_ECOMMERCE,
      store_id: 10,
      customConfig: { ecommerce: { checkout: { require_registration: true } } },
    });
    const cart = TestBed.inject(CartService) as any;
    spyOn(cart, 'addToCart');
    await openAndAccept();
    fixture.componentInstance.goToCheckout({
      kind: 'order',
      items: [{ product_id: 5, variant_id: null, name: 'Camiseta', variant_name: null, sku: 'CAM', quantity: 1, unit_price: 50000 }],
    });
    fixture.detectChanges();
    expect(cart.addToCart).not.toHaveBeenCalled();
    expect(text()).toContain('pide iniciar sesión');
    expect(text()).toContain('Iniciar sesión');
  });

  it('after an order Vexi sent to checkout, it opens with the WhatsApp handoff for that order', async () => {
    await setup(AppType.STORE_ECOMMERCE, ENABLED);
    await openAndAccept();
    sessionStorage.setItem('vexi_public_handoff', 'true');
    lastPlacedOrder.set({ order_id: 9, order_number: 'ORD-77', public_order_token: 'tok-1' });
    await fixture.whenStable();
    fixture.detectChanges();
    const link = q('vexi-public-handoff') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toContain('https://wa.me/573001234567?text=');
    const message = decodeURIComponent(link.href.split('?text=')[1]);
    expect(message).toContain('*Pedido:* #ORD-77');
    expect(message).toContain('/pedido/tok-1');
    expect(sessionStorage.getItem('vexi_public_handoff')).toBeNull();
  });

  it('an order NOT started from Vexi does not trigger the handoff', async () => {
    await setup(AppType.STORE_ECOMMERCE, ENABLED);
    lastPlacedOrder.set({ order_id: 9, order_number: 'ORD-77', public_order_token: 'tok-1' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('vexi-public-handoff')).toBeNull();
  });
});
