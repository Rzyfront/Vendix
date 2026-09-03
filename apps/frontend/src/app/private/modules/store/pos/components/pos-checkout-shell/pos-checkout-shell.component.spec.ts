import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { PosCheckoutShellComponent } from './pos-checkout-shell.component';
import type { PosPaymentStepComponent } from './steps/pos-payment-step.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../../shared/components';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { PosCartService } from '../../services/pos-cart.service';
import { PosPaymentService } from '../../services/pos-payment.service';
import { PosRestaurantIntegrationService } from '../../services/pos-restaurant-integration.service';
import { StoreOrdersService } from '../../../orders/services/store-orders.service';
import { PosCustomer } from '../../models/customer.model';
import { CartItem, CartState } from '../../models/cart.model';

/**
 * QUI-727 (F.1 Step 8) — la máquina tri-estado de venta (anónimo / alias /
 * cliente), su bloqueo bajo modo crédito y el vaciado del alias al asignar
 * cliente (ADR-9), PROBADOS sobre la instancia real del componente.
 *
 * ## Por qué NO se monta el template completo
 *
 * `PosCheckoutShellComponent` importa 8 componentes reales (`app-modal`,
 * `app-steps-line`, `app-address-form-fields`, `app-pos-customer-selector`,
 * `app-pos-consumo-step`, `app-pos-payment-step`, `app-pos-shipping-step`,
 * `app-icon`), cada uno con su propio grafo de servicios (p.ej.
 * `PosPaymentStepComponent` inyecta `PosPaymentService`, `StoreOrdersService`,
 * `PosWalletService`, `WompiService`, `StoreSettingsFacade`). Montar ese árbol
 * completo (`fixture.detectChanges()` sobre el template real) es
 * desproporcionado para lo que este spec custodia: la lógica de la
 * máquina de estados vive en signals/computed/métodos del PROPIO shell, no en
 * el DOM proyectado. Este spec:
 *
 * 1. Sobrescribe el `template` del shell por un `<div></div>` inerte (vía
 *    `TestBed.overrideComponent`) para poder llamar `fixture.detectChanges()`
 *    sin instanciar los 8 hijos reales — necesario SOLO para forzar el flush
 *    de los `effect()` del constructor (Angular flushea los root effects
 *    pendientes en cada `detectChanges()`, ver `rootEffectScheduler` en
 *    `ComponentFixture`).
 * 2. Sustituye el signal `paymentStep` (un `viewChild(PosPaymentStepComponent)`,
 *    siempre `undefined` sin el hijo real montado) por un signal real de
 *    Angular que expone solo `.mode()` — el ÚNICO miembro que los `effect()`
 *    de modo crédito leen. Es un doble de colaborador honesto: no afirma
 *    nada sobre sí mismo, solo permite que la lógica REAL del shell reaccione
 *    a un cambio de modo de pago sin requerir el collector completo.
 *
 * Todo lo demás (métodos públicos, signals, computed) se ejercita
 * directamente sobre `component`, sin necesidad de render.
 *
 * ## Qué NO cubre este spec (ver reporte del agente)
 *
 * - El collector de Cobro real (`PosPaymentStepComponent`) entrando a modo
 *   crédito por interacción de usuario — se simula su `.mode()` directamente.
 * - Los paths HTTP de `createCounterAndFire` / `openPickedTableThenAppend`
 *   (mesas de restaurante) — fuera del alcance de este step (tri-estado +
 *   crédito + ADR-9), no tocan alias/cliente de forma distinta a los paths
 *   cubiertos aquí.
 *
 * Skills: `vendix-zoneless-signals`, `vendix-angular-forms`, `how-to-test`.
 */
describe('PosCheckoutShellComponent — máquina tri-estado de venta', () => {
  let fixture: ComponentFixture<PosCheckoutShellComponent>;
  let component: PosCheckoutShellComponent;
  let posSettings: WritableSignal<any>;
  let checkoutSettings: WritableSignal<any>;
  let payMode: WritableSignal<'contado' | 'credito'>;
  let updateOrderFromEditorSpy: jasmine.Spy;

  function buildCartState(overrides: Partial<CartState> = {}): CartState {
    const item: CartItem = {
      id: 'line-1',
      product: { id: 1, name: 'Producto de prueba', sku: 'SKU-1' } as any,
      quantity: 1,
      unitPrice: 10,
      finalPrice: 10,
      totalPrice: 10,
      taxAmount: 0,
      addedAt: new Date(),
    } as CartItem;
    return {
      items: [item],
      customer: null,
      notes: '',
      internalNotes: '',
      appliedDiscounts: [],
      pendingBookings: [],
      summary: { subtotal: 10, tax: 0, total: 10 } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      linkedOrderId: null,
      linkedOrderNumber: null,
      ...overrides,
    } as CartState;
  }

  function buildCustomer(overrides: Partial<PosCustomer> = {}): PosCustomer {
    return {
      id: 42,
      email: 'ana@example.com',
      first_name: 'Ana',
      last_name: 'Restrepo',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    } as PosCustomer;
  }

  beforeEach(() => {
    // Ambas banderas en true por defecto: las tres opciones del radiogroup
    // "Tipo de venta" están disponibles salvo que un test las apague o que
    // el collector entre en modo crédito (ver el describe dedicado).
    posSettings = signal<any>({
      allow_anonymous_sales: true,
      anonymous_sales_as_default: false,
      allow_alias_sales: true,
      alias_sales_as_default: false,
    });
    checkoutSettings = signal<any>({ require_customer_data: false });

    updateOrderFromEditorSpy = jasmine
      .createSpy('updateOrderFromEditor')
      .and.returnValue(of({ data: { id: 501 } }));

    TestBed.configureTestingModule({
      imports: [PosCheckoutShellComponent],
      providers: [
        {
          provide: CurrencyFormatService,
          useValue: { loadCurrency: () => undefined } as unknown as CurrencyFormatService,
        },
        {
          provide: StoreSettingsFacade,
          useValue: {
            pos: posSettings,
            checkout: checkoutSettings,
          } as unknown as StoreSettingsFacade,
        },
        { provide: PosCartService, useValue: {} as unknown as PosCartService },
        {
          provide: PosPaymentService,
          useValue: {
            saveDraft: () => of({ success: true, order: { id: 1 }, message: 'ok' }),
          } as unknown as PosPaymentService,
        },
        {
          provide: PosRestaurantIntegrationService,
          useValue: {
            isRestaurantMode: () => false,
            currentTableSession: () => null,
            maybeFireKitchen: () => of({ fired_item_ids: [] }),
          } as unknown as PosRestaurantIntegrationService,
        },
        {
          provide: StoreOrdersService,
          useValue: {
            updateOrderFromEditor: updateOrderFromEditorSpy,
          } as unknown as StoreOrdersService,
        },
        {
          provide: ToastService,
          useValue: {
            success: () => undefined,
            error: () => undefined,
            warning: () => undefined,
          } as unknown as ToastService,
        },
      ],
    });

    // Ver el docstring de arriba: el template real arrastra 8 componentes
    // hijos con su propio grafo de servicios. Lo sustituimos por un nodo
    // inerte para poder flushear los `effect()` del constructor sin montar
    // ese árbol.
    TestBed.overrideComponent(PosCheckoutShellComponent, {
      set: { template: '<div></div>', imports: [] },
    });

    fixture = TestBed.createComponent(PosCheckoutShellComponent);
    component = fixture.componentInstance;

    // Doble del collector de Cobro real: solo expone `.mode()`, que es lo
    // único que los `effect()` de modo crédito del shell leen de
    // `paymentStep()`. Debe asignarse ANTES del primer `detectChanges()`
    // para que el primer flush de efectos ya lea este signal.
    payMode = signal<'contado' | 'credito'>('contado');
    const fakePaymentStep = { mode: payMode } as unknown as PosPaymentStepComponent;
    (component as any).paymentStep = signal(fakePaymentStep);
  });

  describe('1. tri-estado de venta: anonymous | alias | customer', () => {
    it('arranca en modo "customer" por defecto', () => {
      expect(component.saleMode()).toBe('customer');
      expect(component.isAnonymousSale()).toBe(false);
    });

    it('onSelectSaleMode("anonymous") activa el modo anónimo y colapsa el sub-wizard de Cliente a un único paso "Tipo"', () => {
      component.onSelectSaleMode('anonymous');

      expect(component.saleMode()).toBe('anonymous');
      expect(component.isAnonymousSale()).toBe(true);
      expect(component.clienteSubSteps()).toEqual([{ label: 'Tipo' }]);
    });

    it('onSelectSaleMode("alias") activa el modo alias y abre el sub-paso "Alias"', () => {
      component.onSelectSaleMode('alias');

      expect(component.saleMode()).toBe('alias');
      expect(component.isAnonymousSale()).toBe(false);
      expect(component.clienteSubSteps()).toEqual([{ label: 'Tipo' }, { label: 'Alias' }]);
      expect(component.clienteSubStep()).toBe(1);
    });

    it('onSelectSaleMode("customer") activa el modo cliente y abre el sub-paso "Cliente"', () => {
      component.onSelectSaleMode('anonymous'); // arranca en otro modo
      component.onSelectSaleMode('customer');

      expect(component.saleMode()).toBe('customer');
      expect(component.isAnonymousSale()).toBe(false);
      expect(component.clienteSubSteps()).toEqual([{ label: 'Tipo' }, { label: 'Cliente' }]);
      expect(component.clienteSubStep()).toBe(1);
    });

    it('onAliasInput guarda en el signal el texto crudo del input, sin recortar (el recorte vive en el borde de escritura)', () => {
      component.onSelectSaleMode('alias');
      component.onAliasInput({ target: { value: '  Mesa 5  ' } } as unknown as Event);

      expect(component.customerAlias()).toBe('  Mesa 5  ');
      // customerAliasForPayload es privado; se ejercita indirectamente vía
      // createRetailDraft más abajo (test de ADR-9) y aquí solo se verifica
      // que el signal captura el valor crudo del input tal cual el usuario
      // escribió — el recorte ocurre en el borde de escritura, no en el
      // signal.
    });
  });

  describe('2. bloqueo del modo alias bajo modo crédito (paridad con anónimo, QUI-737 B.4)', () => {
    it('canBeAnonymous() y canBeAlias() son true en modo contado', () => {
      payMode.set('contado');

      expect(component.canBeAnonymous()).toBe(true);
      expect(component.canBeAlias()).toBe(true);
    });

    it('canBeAnonymous() y canBeAlias() se apagan EN PARIDAD apenas el collector entra a crédito', () => {
      payMode.set('credito');

      expect(component.canBeAnonymous()).toBe(false);
      expect(component.canBeAlias()).toBe(false);
    });

    it('REGRESIÓN: si ya se había elegido alias y el collector entra a crédito, el effect fuerza el modo de vuelta a "customer"', () => {
      component.onSelectSaleMode('alias');
      expect(component.saleMode()).toBe('alias');

      // Flush inicial de los `effect()` del constructor. En contado, el
      // effect de crédito es un no-op y el modo alias sobrevive intacto.
      fixture.detectChanges();
      expect(component.saleMode()).toBe('alias');

      // El collector entra a crédito → el effect de paridad debe forzar el
      // modo de vuelta a "customer" (misma regla que ya protegía "anonymous").
      payMode.set('credito');
      fixture.detectChanges();

      expect(component.saleMode()).toBe('customer');
    });

    it('REGRESIÓN: el mismo effect protege el modo "anonymous" (caso ya cubierto, usado aquí como control de paridad)', () => {
      component.onSelectSaleMode('anonymous');
      fixture.detectChanges();
      expect(component.saleMode()).toBe('anonymous');

      payMode.set('credito');
      fixture.detectChanges();

      expect(component.saleMode()).toBe('customer');
    });
  });

  describe('3. ADR-9 — alias y customer_id son mutuamente excluyentes', () => {
    it('selectCustomer() vacía cualquier alias existente (customer gana)', () => {
      component.onSelectSaleMode('alias');
      component.customerAlias.set('Mesa 5');
      expect(component.saleMode()).toBe('alias');
      expect(component.customerAlias()).toBe('Mesa 5');

      component.selectCustomer(buildCustomer());

      expect(component.saleMode()).toBe('customer');
      expect(component.customerAlias()).toBe('');
    });

    it('el payload de actualización de orden manda customer_id=null y el alias cuando el modo es alias', () => {
      fixture.componentRef.setInput('mode', 'edit');
      fixture.componentRef.setInput('editingOrderId', 501);
      fixture.componentRef.setInput('cartState', buildCartState({ customer: null }));
      component.onSelectSaleMode('alias');
      component.customerAlias.set('Mesa 5');

      component.onPrimaryConfirm();

      expect(updateOrderFromEditorSpy).toHaveBeenCalledTimes(1);
      const payload = updateOrderFromEditorSpy.calls.mostRecent().args[1];
      expect(payload.customer_id).toBeNull();
      expect(payload.customer_alias).toBe('Mesa 5');
    });

    it('el payload de actualización de orden manda el customer_id real y customer_alias=undefined cuando el modo es customer (aunque quede un alias viejo en el signal)', () => {
      const customer = buildCustomer();
      fixture.componentRef.setInput('mode', 'edit');
      fixture.componentRef.setInput('editingOrderId', 501);
      fixture.componentRef.setInput('cartState', buildCartState({ customer }));
      // Simula el vaciado ADR-9: seleccionar cliente limpia el alias.
      component.customerAlias.set('un alias viejo que selectCustomer ya vació');
      component.selectCustomer(customer);

      component.onPrimaryConfirm();

      const payload = updateOrderFromEditorSpy.calls.mostRecent().args[1];
      expect(payload.customer_id).toBe(42);
      expect(payload.customer_alias).toBeUndefined();
    });
  });
});
