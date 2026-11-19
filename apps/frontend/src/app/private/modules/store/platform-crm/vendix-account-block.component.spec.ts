import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { VendixAccountBlockComponent } from './vendix-account-block.component';
import { PlatformCrmService } from './platform-crm.service';
import {
  PLATFORM_CRM_PERMISSIONS,
  PlatformCrmLinkView,
  canManageVendixAccount,
  canSeeVendixAccount,
} from './platform-crm.interface';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { DialogService, ToastService } from '../../../../shared/components';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

/**
 * Vendix Platform · bloque "Cuenta Vendix" de la ficha CRM.
 * Como comercial de Vendix, veo la organización que mi cliente creó y paga,
 * la enlazo o la desenlazo (con confirmación); fuera de la tienda plataforma
 * el bloque no existe.
 */
/** `user.store` de la sesión en la tienda de Vendix Platform y en una ajena. */
const PLATFORM_STORE = { id: 1, organizations: { id: 1, is_platform: true } };
const TENANT_STORE = { id: 70, organizations: { id: 7, is_platform: false } };

describe('VendixAccountBlockComponent', () => {
  const linkedView = (): PlatformCrmLinkView => ({
    link: {
      id: 7,
      status: 'linked',
      note: 'Cerró con el plan anual',
      linked_at: '2026-11-10T15:00:00.000Z',
      linked_by: { id: 3, first_name: 'Ana', last_name: 'Comercial' },
      linked_store: null,
    },
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
  const unlinkedView = (): PlatformCrmLinkView => ({ link: null, organization: null });

  let service: { getLink: jasmine.Spy; unlink: jasmine.Spy; searchAccounts: jasmine.Spy; link: jasmine.Spy };
  let dialog: { confirm: jasmine.Spy };
  let toast: { success: jasmine.Spy; error: jasmine.Spy };

  const setup = async (
    getLink: jasmine.Spy,
    permissions: string[],
  ): Promise<ComponentFixture<VendixAccountBlockComponent>> => {
    service = {
      getLink,
      unlink: jasmine.createSpy('unlink').and.returnValue(of(unlinkedView())),
      searchAccounts: jasmine
        .createSpy('searchAccounts')
        .and.returnValue(of({ organizations: [], stores: [] })),
      link: jasmine.createSpy('link'),
    };
    dialog = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };
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

  // Los handlers async (confirm → backend) no cuentan como tarea pendiente en
  // zoneless: se drena un macrotask antes de esperar estabilidad.
  const settle = async (fixture: ComponentFixture<unknown>): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const text = (fixture: ComponentFixture<unknown>): string =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

  const buttonWith = (fixture: ComponentFixture<unknown>, label: string): HTMLButtonElement | null =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes(label),
    ) ?? null;

  const ALL = [PLATFORM_CRM_PERMISSIONS.READ, PLATFORM_CRM_PERMISSIONS.MANAGE];

  it('carga el enlace del cliente y muestra la organización, su plan y la renovación', async () => {
    const fixture = await setup(jasmine.createSpy('getLink').and.returnValue(of(linkedView())), ALL);

    expect(service.getLink).toHaveBeenCalledOnceWith(55);
    const content = text(fixture);
    expect(content).toContain('Cuenta Vendix');
    expect(content).toContain('Cliente consolidado');
    expect(content).toContain('Panadería La Espiga');
    expect(content).toContain('Plan Pro');
    expect(content).toContain('Sede Centro');
    expect(content).toContain('Renueva');
    expect(content).toContain('Cerró con el plan anual');
    expect(content).toContain('Enlazado a la organización completa.');
    expect(buttonWith(fixture, 'Desenlazar')).not.toBeNull();
  });

  it('enlace a una tienda: dice qué tienda es y muestra solo su plan', async () => {
    const view = linkedView();
    view.link!.linked_store = { id: 70, name: 'Sede Norte' };
    view.organization!.subscriptions = [
      {
        store_name: 'Sede Norte',
        plan_name: 'Plan Básico',
        state: 'trial',
        current_period_end: null,
        trial_ends_at: '2026-12-31T17:00:00.000Z',
      },
    ];
    const fixture = await setup(jasmine.createSpy('getLink').and.returnValue(of(view)), ALL);

    const scope = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="vendix-account-scope"]',
    );
    expect((scope?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      'Enlazado a la tienda Sede Norte de esta organización.',
    );
    const content = text(fixture);
    expect(content).toContain('Panadería La Espiga');
    expect(content).toContain('Plan Básico');
    expect(content).toContain('En prueba');
    expect(content).toContain('Trial hasta');
    expect(content).not.toContain('organización completa');
    expect(content).not.toContain('Sede Centro');
  });

  it('sin enlace y con permiso de gestión ofrece «Enlazar con cuenta Vendix»', async () => {
    const fixture = await setup(jasmine.createSpy('getLink').and.returnValue(of(unlinkedView())), ALL);

    expect(text(fixture)).toContain('Sin cuenta Vendix enlazada.');
    expect(buttonWith(fixture, 'Enlazar con cuenta Vendix')).not.toBeNull();
  });

  it('solo lectura: muestra el enlace pero no ofrece enlazar ni desenlazar', async () => {
    const linked = await setup(
      jasmine.createSpy('getLink').and.returnValue(of(linkedView())),
      [PLATFORM_CRM_PERMISSIONS.READ],
    );
    expect(text(linked)).toContain('Panadería La Espiga');
    expect(buttonWith(linked, 'Desenlazar')).toBeNull();

    TestBed.resetTestingModule();
    const unlinked = await setup(
      jasmine.createSpy('getLink').and.returnValue(of(unlinkedView())),
      [PLATFORM_CRM_PERMISSIONS.READ],
    );
    expect(text(unlinked)).toContain('Sin cuenta Vendix enlazada.');
    expect(buttonWith(unlinked, 'Enlazar con cuenta Vendix')).toBeNull();
  });

  it('un 404 del backend borra el bloque sin delatar la función', async () => {
    const fixture = await setup(
      jasmine
        .createSpy('getLink')
        .and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 }))),
      ALL,
    );

    expect(text(fixture).trim()).toBe('');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('otro error deja el bloque con «Reintentar», que vuelve a consultar', async () => {
    const getLink = jasmine
      .createSpy('getLink')
      .and.returnValues(
        throwError(() => new HttpErrorResponse({ status: 500 })),
        of(linkedView()),
      );
    const fixture = await setup(getLink, ALL);

    expect(text(fixture)).toContain('No pudimos cargar la cuenta Vendix.');
    buttonWith(fixture, 'Reintentar')!.click();
    await settle(fixture);

    expect(getLink).toHaveBeenCalledTimes(2);
    expect(text(fixture)).toContain('Panadería La Espiga');
  });

  it('desenlazar pide confirmación; si se cancela no llama al backend', async () => {
    const fixture = await setup(jasmine.createSpy('getLink').and.returnValue(of(linkedView())), ALL);
    dialog.confirm.and.resolveTo(false);

    buttonWith(fixture, 'Desenlazar')!.click();
    await settle(fixture);

    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(dialog.confirm.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ confirmVariant: 'danger', confirmText: 'Desenlazar' }),
    );
    expect(service.unlink).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Panadería La Espiga');
  });

  it('desenlazar confirmado llama al backend y deja el cliente sin enlace', async () => {
    const fixture = await setup(jasmine.createSpy('getLink').and.returnValue(of(linkedView())), ALL);

    buttonWith(fixture, 'Desenlazar')!.click();
    await settle(fixture);

    expect(service.unlink).toHaveBeenCalledOnceWith(55);
    expect(toast.success).toHaveBeenCalledWith('Enlace deshecho');
    expect(text(fixture)).toContain('Sin cuenta Vendix enlazada.');
  });

  it('desenlazar que falla avisa con el mensaje del backend y conserva el enlace', async () => {
    const fixture = await setup(jasmine.createSpy('getLink').and.returnValue(of(linkedView())), ALL);
    service.unlink.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 404,
            error: { error_code: 'PLATFORM_CRM_005', message: 'x' },
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
