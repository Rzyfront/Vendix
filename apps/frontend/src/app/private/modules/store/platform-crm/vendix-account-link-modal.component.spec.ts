import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { VendixAccountLinkModalComponent } from './vendix-account-link-modal.component';
import { PlatformCrmService } from './platform-crm.service';
import { PlatformCrmLinkView, PlatformOrganizationSearchItem } from './platform-crm.interface';
import { ToastService } from '../../../../shared/components';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

/**
 * Modal "Enlazar con cuenta Vendix": el comercial busca la organización por
 * nombre, slug o NIT, la elige y confirma; el enlace llega a la ficha.
 */
describe('VendixAccountLinkModalComponent', () => {
  const ORG: PlatformOrganizationSearchItem = {
    id: 42,
    name: 'Panadería La Espiga',
    slug: 'la-espiga',
    created_at: '2026-10-01T12:00:00.000Z',
  };
  const VIEW: PlatformCrmLinkView = {
    link: {
      id: 9,
      status: 'linked',
      note: null,
      linked_at: '2026-11-17T12:00:00.000Z',
      linked_by: { id: 3, first_name: 'Ana', last_name: null },
    },
    organization: { id: 42, name: ORG.name, state: 'active', subscriptions: [] },
  };

  let service: { searchOrganizations: jasmine.Spy; link: jasmine.Spy };
  let toast: { success: jasmine.Spy; error: jasmine.Spy };
  let fixture: ComponentFixture<VendixAccountLinkModalComponent>;
  let modal: VendixAccountLinkModalComponent;
  let linked: PlatformCrmLinkView[];

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  beforeEach(async () => {
    service = {
      searchOrganizations: jasmine.createSpy('searchOrganizations').and.returnValue(of([ORG])),
      link: jasmine.createSpy('link').and.returnValue(of(VIEW)),
    };
    toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };
    TestBed.configureTestingModule({
      imports: [VendixAccountLinkModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PlatformCrmService, useValue: service },
        { provide: ToastService, useValue: toast },
        // app-input usa el formateador de moneda (HttpClient): fuera del alcance.
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
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('no busca con menos de 2 caracteres y, al escribir, consulta una sola vez con el término final', async () => {
    modal['onQuery']('p');
    await wait(350);
    expect(service.searchOrganizations).not.toHaveBeenCalled();

    modal['onQuery']('pa');
    modal['onQuery']('  pan ');
    await wait(350);

    expect(service.searchOrganizations).toHaveBeenCalledOnceWith('pan');
    expect(modal['results']()).toEqual([ORG]);
    expect(modal['searching']()).toBeFalse();
  });

  it('escribir en el campo real del DOM consulta el servicio tras el debounce', async () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector('input');
    expect(input).withContext('campo de búsqueda del modal').not.toBeNull();

    input!.value = 'pan';
    input!.dispatchEvent(new Event('input'));
    await wait(350);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(service.searchOrganizations).toHaveBeenCalledOnceWith('pan');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(ORG.name);
  });

  it('enlazar exige elegir una organización', () => {
    expect(modal['canSubmit']()).toBeFalse();
    modal['selected'].set(ORG);
    expect(modal['canSubmit']()).toBeTrue();
  });

  it('enlaza la organización elegida con la nota recortada, avisa y cierra', async () => {
    modal['selected'].set(ORG);
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

  it('sin nota no envía el campo `note`', async () => {
    modal['selected'].set(ORG);
    modal['note'].set('   ');

    await modal['submit']();

    expect(service.link).toHaveBeenCalledOnceWith(55, { organization_id: 42 });
  });

  it('si el backend rechaza (organización ya enlazada) avisa y el modal sigue abierto', async () => {
    service.link.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error_code: 'PLATFORM_CRM_004', message: 'x' },
          }),
      ),
    );
    modal['selected'].set(ORG);

    await modal['submit']();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(linked).toEqual([]);
    expect(modal.isOpen()).toBeTrue();
    expect(modal['saving']()).toBeFalse();
  });
});
