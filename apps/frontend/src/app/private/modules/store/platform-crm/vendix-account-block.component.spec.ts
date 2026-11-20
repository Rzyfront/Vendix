import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { VendixAccountBlockComponent } from './vendix-account-block.component';
import { PlatformCrmService } from './platform-crm.service';
import {
  PLATFORM_CRM_PERMISSIONS,
  PlatformCrmLinkItem,
  PlatformCrmLinkList,
  canManageVendixAccount,
  canSeeVendixAccount,
} from './platform-crm.interface';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { DialogService, ToastService } from '../../../../shared/components';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

/**
 * Vendix Platform · bloque "Cuenta Vendix" de la ficha CRM.
 * Como comercial de Vendix, veo todas las cuentas (organizaciones o tiendas)
 * que mi cliente creó y paga, enlazo otra o desenlazo una (con confirmación y
 * motivo) sin tocar las demás; fuera de la tienda plataforma el bloque no existe.
 */
/** `user.store` de la sesión en la tienda de Vendix Platform y en una ajena. */
const PLATFORM_STORE = { id: 1, organizations: { id: 1, is_platform: true } };
const TENANT_STORE = { id: 70, organizations: { id: 7, is_platform: false } };

describe('VendixAccountBlockComponent', () => {
  const orgItem = (): PlatformCrmLinkItem => ({
    id: 7,
    status: 'linked',
    note: 'Cerró con el plan anual',
    linked_at: '2026-11-10T15:00:00.000Z',
    linked_by: { id: 3, first_name: 'Ana', last_name: 'Comercial' },
    linked_store: null,
    scope: 'organization',
    organization: {
      id: 42,
      name: 'Panadería La Espiga',
      state: 'active',
      subscriptions: [
        {
          store_name: 'Sede Centro',
          plan_name: 'Plan Pro',
          state: 'active',
          current_period_end: '2026-12-15T17:00:00.000Z',
          trial_ends_at: null,
        },
      ],
    },
  });
  const storeItem = (): PlatformCrmLinkItem => ({
    id: 8,
    status: 'linked',
    note: null,
    linked_at: '2026-11-11T15:00:00.000Z',
    linked_by: { id: 3, first_name: 'Ana', last_name: 'Comercial' },
    linked_store: { id: 70, name: 'Sede Norte' },
    scope: 'store',
    organization: {
      id: 43,
      name: 'Ferretería El Clavo',
      state: 'active',
      subscriptions: [
        {
          store_name: 'Sede Norte',
          plan_name: 'Plan Básico',
          state: 'trial',
          current_period_end: null,
          trial_ends_at: '2026-12-31T17:00:00.000Z',
        },
      ],
    },
  });
  const thirdItem = (): PlatformCrmLinkItem => ({
    ...orgItem(),
    id: 9,
    note: null,
    organization: { id: 44, name: 'Café Arábigo', state: 'active', subscriptions: [] },
  });
  const list = (...links: PlatformCrmLinkItem[]): PlatformCrmLinkList => ({ links });

  let service: {
    getLinks: jasmine.Spy;
    unlinkById: jasmine.Spy;
    searchAccounts: jasmine.Spy;
    link: jasmine.Spy;
  };
  let dialog: { prompt: jasmine.Spy };
  let toast: { success: jasmine.Spy; error: jasmine.Spy };

  const setup = async (
    getLinks: jasmine.Spy,
    permissions: string[],
  ): Promise<ComponentFixture<VendixAccountBlockComponent>> => {
    service = {
      getLinks,
      unlinkById: jasmine.createSpy('unlinkById').and.returnValue(of(list())),
      searchAccounts: jasmine
        .createSpy('searchAccounts')
        .and.returnValue(of({ organizations: [], stores: [] })),
      link: jasmine.createSpy('link'),
    };
    dialog = { prompt: jasmine.createSpy('prompt').and.resolveTo('') };
    toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };

    TestBed.configureTestingModule({
      imports: [VendixAccountBlockComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PlatformCrmService, useValue: service },
        { provide: DialogService, useValue: dialog },
        { provide: ToastService, useValue: toast },
        // Campos compartidos del modal hijo pueden pedir el formateador de moneda (HttpClient): fuera del alcance.
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            currencyFormatStyle: () => 'dot_comma',
            currencyDecimals: () => 0,
            format: (v: number) => `$${Math.round(v)}`,
          },
        },
        {
          provide: AuthFacade,
          useValue: {
            hasPermission: (name: string) => permissions.includes(name),
            userStore: () => PLATFORM_STORE,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(VendixAccountBlockComponent);
    fixture.componentRef.setInput('customerId', 55);
    await settle(fixture);
    return fixture;
  };

  // Los handlers async (prompt → backend) no cuentan como tarea pendiente en
  // zoneless: se drena un macrotask antes de esperar estabilidad.
  const settle = async (fixture: ComponentFixture<unknown>): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const text = (fixture: ComponentFixture<unknown>): string =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

  const cards = (fixture: ComponentFixture<unknown>): HTMLElement[] =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '[data-testid="vendix-account-card"]',
      ),
    );

  const buttonsWith = (root: HTMLElement, label: string): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll('button')).filter((b) =>
      (b.textContent ?? '').includes(label),
    );

  const buttonWith = (fixture: ComponentFixture<unknown>, label: string): HTMLButtonElement | null =>
    buttonsWith(fixture.nativeElement as HTMLElement, label)[0] ?? null;

  const ALL = [PLATFORM_CRM_PERMISSIONS.READ, PLATFORM_CRM_PERMISSIONS.MANAGE];

  it('0 cuentas: «Sin cuenta Vendix enlazada» y ofrece enlazar', async () => {
    const fixture = await setup(jasmine.createSpy('getLinks').and.returnValue(of(list())), ALL);

    expect(service.getLinks).toHaveBeenCalledOnceWith(55);
    expect(cards(fixture)).toHaveSize(0);
    expect(text(fixture)).toContain('Sin cuenta Vendix enlazada.');
    expect(buttonWith(fixture, 'Enlazar con cuenta Vendix')).not.toBeNull();
    expect(buttonWith(fixture, 'Enlazar otra cuenta')).toBeNull();
  });

  it('1 cuenta: una tarjeta con la organización, su plan y la renovación', async () => {
    const fixture = await setup(jasmine.createSpy('getLinks').and.returnValue(of(list(orgItem()))), ALL);

    expect(cards(fixture)).toHaveSize(1);
    const content = text(fixture);
    expect(content).toContain('Cuenta Vendix');
    expect(content).toContain('Cliente consolidado');
    expect(content).toContain('1 cuenta enlazada');
    expect(content).toContain('Panadería La Espiga');
    expect(content).toContain('Plan Pro');
    expect(content).toContain('Sede Centro');
    expect(content).toContain('Renueva');
    expect(content).toContain('Cerró con el plan anual');
    expect(content).toContain('Organización completa.');
    expect(buttonWith(fixture, 'Desenlazar')).not.toBeNull();
    expect(buttonWith(fixture, 'Enlazar otra cuenta')).not.toBeNull();
  });

  it('3 cuentas: una tarjeta por cuenta, la tienda suelta dice cuál es y muestra solo su plan', async () => {
    const fixture = await setup(
      jasmine.createSpy('getLinks').and.returnValue(of(list(orgItem(), storeItem(), thirdItem()))),
      ALL,
    );

    const [org, store, third] = cards(fixture);
    expect(cards(fixture)).toHaveSize(3);
    expect(text(fixture)).toContain('3 cuentas enlazadas');
    const scope = store.querySelector('[data-testid="vendix-account-scope"]');
    expect((scope?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      'Tienda Sede Norte de esta organización.',
    );
    const storeText = (store.textContent ?? '').replace(/\s+/g, ' ');
    expect(storeText).toContain('Ferretería El Clavo');
    expect(storeText).toContain('Plan Básico');
    expect(storeText).toContain('En prueba');
    expect(storeText).toContain('Trial hasta');
    expect(storeText).not.toContain('Sede Centro');
    expect(org.textContent).toContain('Panadería La Espiga');
    expect(third.textContent).toContain('Aún no tiene tiendas con suscripción.');
    for (const card of cards(fixture)) {
      expect(buttonsWith(card, 'Desenlazar')).toHaveSize(1);
    }
  });

  it('solo lectura: muestra las cuentas pero no ofrece enlazar ni desenlazar', async () => {
    const linked = await setup(
      jasmine.createSpy('getLinks').and.returnValue(of(list(orgItem(), storeItem()))),
      [PLATFORM_CRM_PERMISSIONS.READ],
    );
    expect(text(linked)).toContain('Panadería La Espiga');
    expect(buttonWith(linked, 'Desenlazar')).toBeNull();
    expect(buttonWith(linked, 'Enlazar otra cuenta')).toBeNull();

    TestBed.resetTestingModule();
    const unlinked = await setup(
      jasmine.createSpy('getLinks').and.returnValue(of(list())),
      [PLATFORM_CRM_PERMISSIONS.READ],
    );
    expect(text(unlinked)).toContain('Sin cuenta Vendix enlazada.');
    expect(buttonWith(unlinked, 'Enlazar con cuenta Vendix')).toBeNull();
  });

  it('un 404 del backend borra el bloque sin delatar la función', async () => {
    const fixture = await setup(
      jasmine
        .createSpy('getLinks')
        .and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 }))),
      ALL,
    );

    expect(text(fixture).trim()).toBe('');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('otro error deja el bloque con «Reintentar», que vuelve a consultar', async () => {
    const getLinks = jasmine
      .createSpy('getLinks')
      .and.returnValues(
        throwError(() => new HttpErrorResponse({ status: 500 })),
        of(list(orgItem())),
      );
    const fixture = await setup(getLinks, ALL);

    expect(text(fixture)).toContain('No pudimos cargar la cuenta Vendix.');
    buttonWith(fixture, 'Reintentar')!.click();
    await settle(fixture);

    expect(getLinks).toHaveBeenCalledTimes(2);
    expect(text(fixture)).toContain('Panadería La Espiga');
  });

  it('desenlazar pide confirmación con motivo; si se cancela no llama al backend', async () => {
    const fixture = await setup(
      jasmine.createSpy('getLinks').and.returnValue(of(list(orgItem(), storeItem()))),
      ALL,
    );
    dialog.prompt.and.resolveTo(undefined);

    buttonsWith(cards(fixture)[1], 'Desenlazar')[0].click();
    await settle(fixture);

    expect(dialog.prompt).toHaveBeenCalledTimes(1);
    expect(dialog.prompt.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        confirmText: 'Desenlazar',
        placeholder: 'Motivo (opcional)',
        message: jasmine.stringContaining('la tienda Sede Norte'),
      }),
    );
    expect(service.unlinkById).not.toHaveBeenCalled();
    expect(cards(fixture)).toHaveSize(2);
  });

  it('desenlazar una cuenta llama al backend con su id y motivo, y deja las demás', async () => {
    const fixture = await setup(
      jasmine.createSpy('getLinks').and.returnValue(of(list(orgItem(), storeItem(), thirdItem()))),
      ALL,
    );
    dialog.prompt.and.resolveTo('  Vendió la ferretería  ');
    service.unlinkById.and.returnValue(of(list(orgItem(), thirdItem())));

    buttonsWith(cards(fixture)[1], 'Desenlazar')[0].click();
    await settle(fixture);

    expect(service.unlinkById).toHaveBeenCalledOnceWith(55, 8, { reason: 'Vendió la ferretería' });
    expect(toast.success).toHaveBeenCalledWith('Enlace deshecho');
    expect(cards(fixture)).toHaveSize(2);
    expect(text(fixture)).not.toContain('Ferretería El Clavo');
    expect(text(fixture)).toContain('Panadería La Espiga');
    expect(text(fixture)).toContain('Café Arábigo');
  });

  it('desenlazar la última cuenta deja el cliente sin enlace; sin motivo no manda reason', async () => {
    const fixture = await setup(jasmine.createSpy('getLinks').and.returnValue(of(list(orgItem()))), ALL);

    buttonWith(fixture, 'Desenlazar')!.click();
    await settle(fixture);

    expect(service.unlinkById).toHaveBeenCalledOnceWith(55, 7, {});
    expect(text(fixture)).toContain('Sin cuenta Vendix enlazada.');
  });

  it('desenlazar que falla avisa con el mensaje del backend y conserva las cuentas', async () => {
    const fixture = await setup(jasmine.createSpy('getLinks').and.returnValue(of(list(orgItem()))), ALL);
    service.unlinkById.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 404,
            error: { error_code: 'PLATFORM_CRM_012', message: 'x' },
          }),
      ),
    );

    buttonWith(fixture, 'Desenlazar')!.click();
    await settle(fixture);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(text(fixture)).toContain('Panadería La Espiga');
  });
});

describe('canSeeVendixAccount / canManageVendixAccount', () => {
  const ALL = [PLATFORM_CRM_PERMISSIONS.READ, PLATFORM_CRM_PERMISSIONS.MANAGE];
  const auth = (perms: string[], store: unknown = PLATFORM_STORE, owner = false) => ({
    hasPermission: (name: string) => perms.includes(name),
    userStore: () => store,
    isOwner: () => owner,
  });

  it('un owner de tienda sin el permiso de sistema no ve el bloque', () => {
    expect(canSeeVendixAccount(auth(['store:crm_pipeline:read'], TENANT_STORE, true))).toBeFalse();
    expect(canManageVendixAccount(auth(['store:crm_pipeline:manage'], TENANT_STORE, true))).toBeFalse();
  });

  it('con `platform:crm_link:read` lo ve; gestionar exige `platform:crm_link:manage`', () => {
    expect(canSeeVendixAccount(auth([PLATFORM_CRM_PERMISSIONS.READ]))).toBeTrue();
    expect(canManageVendixAccount(auth([PLATFORM_CRM_PERMISSIONS.READ]))).toBeFalse();
    expect(canManageVendixAccount(auth([PLATFORM_CRM_PERMISSIONS.MANAGE]))).toBeTrue();
  });

  it('super admin con todos los permisos en una tienda ajena no ve ni gestiona el bloque', () => {
    expect(canSeeVendixAccount(auth(ALL, TENANT_STORE))).toBeFalse();
    expect(canManageVendixAccount(auth(ALL, TENANT_STORE))).toBeFalse();
  });

  it('sin el dato de la organización de la tienda no se muestra (falla cerrado)', () => {
    const stores = [null, undefined, { id: 1 }, { id: 1, organizations: {} }, { id: 1, organizations: { is_platform: 'true' } }];
    for (const store of stores) {
      // Sesión armada aquí: `auth(ALL, undefined)` caería en la tienda por defecto.
      const session = { hasPermission: () => true, userStore: () => store };
      expect(canSeeVendixAccount(session)).withContext(String(JSON.stringify(store))).toBeFalse();
      expect(canManageVendixAccount(session)).withContext(String(JSON.stringify(store))).toBeFalse();
    }
  });
});
