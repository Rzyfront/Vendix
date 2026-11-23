import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { VendixAccountLinkModalComponent } from './vendix-account-link-modal.component';
import { PlatformCrmService } from './platform-crm.service';
import {
  PlatformCrmLinkItem,
  PlatformCrmLinkView,
  PlatformOrganizationSearchItem,
  PlatformStoreSearchItem,
} from './platform-crm.interface';
import { ToastService } from '../../../../shared/components';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

/**
 * Modal "Enlazar con cuenta Vendix": el comercial escribe en el buscador,
 * ve organizaciones y tiendas etiquetadas, elige una y confirma; el enlace
 * llega a la ficha.
 */
describe('VendixAccountLinkModalComponent', () => {
  const ORG: PlatformOrganizationSearchItem = {
    id: 42,
    name: 'Panadería La Espiga',
    slug: 'la-espiga',
    state: 'active',
    created_at: '2026-10-01T12:00:00.000Z',
  };
  const STORE: PlatformStoreSearchItem = {
    id: 70,
    name: 'Sede Norte',
    slug: 'espiga-norte',
    organization: { id: 42, name: 'Panadería La Espiga' },
    plan_name: 'Plan Pro',
    subscription_state: 'active',
  };
  const VIEW: PlatformCrmLinkView = {
    link: {
      id: 9,
      status: 'linked',
      note: null,
      linked_at: '2026-11-17T12:00:00.000Z',
      linked_by: { id: 3, first_name: 'Ana', last_name: null },
      linked_store: null,
    },
    organization: { id: 42, name: ORG.name, state: 'active', subscriptions: [] },
  };

  let service: { searchAccounts: jasmine.Spy; link: jasmine.Spy };
  let toast: { success: jasmine.Spy; error: jasmine.Spy };
  let fixture: ComponentFixture<VendixAccountLinkModalComponent>;
  let modal: VendixAccountLinkModalComponent;
  let linked: PlatformCrmLinkView[];

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const searchInput = () =>
    root().querySelector<HTMLInputElement>('input[aria-label="Buscar organización o tienda"]');
  const optionWith = (label: string) =>
    Array.from(root().querySelectorAll<HTMLButtonElement>('button[role="option"]')).find((b) =>
      (b.textContent ?? '').includes(label),
    ) ?? null;

  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Teclea en el `<input>` real y espera el debounce del buscador (300 ms). */
  const typeInto = async (...values: string[]) => {
    const input = searchInput();
    expect(input).withContext('campo de búsqueda del modal').not.toBeNull();
    for (const value of values) {
      input!.value = value;
      input!.dispatchEvent(new Event('input'));
    }
    await wait(350);
    await render();
  };

  beforeEach(async () => {
    service = {
      searchAccounts: jasmine
        .createSpy('searchAccounts')
        .and.returnValue(of({ organizations: [ORG], stores: [STORE] })),
      link: jasmine.createSpy('link').and.returnValue(of(VIEW)),
    };
    toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };
    TestBed.configureTestingModule({
      imports: [VendixAccountLinkModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PlatformCrmService, useValue: service },
        { provide: ToastService, useValue: toast },
        // Campos compartidos pueden pedir el formateador de moneda (HttpClient): fuera del alcance.
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            currencyFormatStyle: () => 'dot_comma',
            currencyDecimals: () => 0,
            format: (v: number) => `$${Math.round(v)}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(VendixAccountLinkModalComponent);
    fixture.componentRef.setInput('customerId', 55);
    modal = fixture.componentInstance;
    linked = [];
    modal.linked.subscribe((view) => linked.push(view));
    modal.isOpen.set(true);
    await render();
  });

  it('escribir en el campo real del DOM consulta el servicio tras el debounce', async () => {
    await typeInto('pan');

    expect(service.searchAccounts).toHaveBeenCalledOnceWith('pan');
    expect(text()).toContain(ORG.name);
  });

  it('muestra organizaciones y tiendas etiquetadas, con estado y plan', async () => {
    await typeInto('espiga');

    const org = optionWith('la-espiga')!;
    expect((org.textContent ?? '').replace(/\s+/g, ' ')).toContain('Organización');
    expect((org.textContent ?? '').replace(/\s+/g, ' ')).toContain('la-espiga · Activa');
    const store = optionWith('Sede Norte')!;
    expect((store.textContent ?? '').replace(/\s+/g, ' ')).toContain('Tienda · Panadería La Espiga');
    expect((store.textContent ?? '').replace(/\s+/g, ' ')).toContain('Plan Pro · Activa');
  });

  it('no busca con menos de 2 caracteres y, al teclear rápido, consulta una sola vez con el término final', async () => {
    await typeInto('p');
    expect(service.searchAccounts).not.toHaveBeenCalled();
    expect(text()).toContain('Escribe al menos 2 caracteres.');

    await typeInto('pa', '  pan ');
    expect(service.searchAccounts).toHaveBeenCalledOnceWith('pan');
  });

  it('sin coincidencias lo dice', async () => {
    service.searchAccounts.and.returnValue(of({ organizations: [], stores: [] }));
    await typeInto('zzz');

    expect(text()).toContain('Ninguna organización ni tienda coincide.');
  });

  it('cada apertura empieza con el buscador vacío', async () => {
    await typeInto('pan');
    modal.isOpen.set(false);
    await render();
    modal.isOpen.set(true);
    await render();

    expect(searchInput()!.value).toBe('');
    expect(text()).toContain('Escribe al menos 2 caracteres.');
    expect(modal['canSubmit']()).toBeFalse();
  });

  it('enlazar exige elegir una organización o una tienda', async () => {
    expect(modal['canSubmit']()).toBeFalse();
    await typeInto('pan');

    optionWith('Sede Norte')!.click();
    await render();

    expect(optionWith('Sede Norte')!.getAttribute('aria-selected')).toBe('true');
    expect(optionWith('la-espiga')!.getAttribute('aria-selected')).toBe('false');
    expect(modal['canSubmit']()).toBeTrue();
  });

  it('enlaza la organización elegida con la nota recortada, avisa y cierra', async () => {
    modal['selected'].set({ kind: 'organization', item: ORG });
    modal['note'].set('  Cerró con el plan anual  ');

    await modal['submit']();

    expect(service.link).toHaveBeenCalledOnceWith(55, {
      organization_id: 42,
      note: 'Cerró con el plan anual',
    });
    expect(toast.success).toHaveBeenCalledWith('Enlazado con Panadería La Espiga');
    expect(linked).toEqual([VIEW]);
    expect(modal.isOpen()).toBeFalse();
  });

  it('enlaza la tienda elegida en pantalla: envía `linked_store_id` y no `organization_id`', async () => {
    await typeInto('norte');
    optionWith('Sede Norte')!.click();
    await render();

    await modal['submit']();

    expect(service.link).toHaveBeenCalledOnceWith(55, { linked_store_id: 70 });
    expect(toast.success).toHaveBeenCalledWith(
      'Enlazado con la tienda Sede Norte (Panadería La Espiga)',
    );
    expect(modal.isOpen()).toBeFalse();
  });

  it('sin nota no envía el campo `note`', async () => {
    modal['selected'].set({ kind: 'organization', item: ORG });
    modal['note'].set('   ');

    await modal['submit']();

    expect(service.link).toHaveBeenCalledOnceWith(55, { organization_id: 42 });
  });

  it('si el backend rechaza (tienda ya enlazada) avisa y el modal sigue abierto', async () => {
    service.link.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error_code: 'PLATFORM_CRM_007', message: 'x' },
          }),
      ),
    );
    modal['selected'].set({ kind: 'store', item: STORE });

    await modal['submit']();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(linked).toEqual([]);
    expect(modal.isOpen()).toBeTrue();
    expect(modal['saving']()).toBeFalse();
  });
  it('lo que el cliente ya tiene sale «Ya enlazada» y no se puede elegir (org completa cubre sus tiendas)', async () => {
    const OTHER_STORE: PlatformStoreSearchItem = {
      ...STORE,
      id: 80,
      name: 'Kiosko Sur',
      organization: { id: 50, name: 'Café Arábigo' },
    };
    service.searchAccounts.and.returnValue(of({ organizations: [ORG], stores: [STORE, OTHER_STORE] }));
    const whole: PlatformCrmLinkItem = {
      ...VIEW.link!,
      scope: 'organization',
      organization: VIEW.organization,
    };
    fixture.componentRef.setInput('linkedAccounts', [whole]);
    await typeInto('pan');

    for (const label of ['la-espiga', 'Sede Norte']) {
      const option = optionWith(label)!;
      expect(option.disabled).withContext(label).toBeTrue();
      expect(option.textContent).withContext(label).toContain('Ya enlazada');
    }
    const free = optionWith('Kiosko Sur')!;
    expect(free.disabled).toBeFalse();
    expect(free.textContent).not.toContain('Ya enlazada');

    optionWith('Sede Norte')!.click();
    await render();
    expect(modal['canSubmit']()).toBeFalse();

    // Una tienda suelta enlazada marca solo esa tienda, no su organización.
    const single: PlatformCrmLinkItem = { ...whole, scope: 'store', linked_store: { id: 80, name: 'Kiosko Sur' } };
    fixture.componentRef.setInput('linkedAccounts', [single]);
    await render();
    expect(optionWith('Kiosko Sur')!.disabled).toBeTrue();
    expect(optionWith('la-espiga')!.disabled).toBeFalse();
    expect(optionWith('Sede Norte')!.disabled).toBeFalse();
  });
});
