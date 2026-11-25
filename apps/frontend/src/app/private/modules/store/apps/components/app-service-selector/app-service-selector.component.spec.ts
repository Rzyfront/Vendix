import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { StoreAppsService } from '../../services/store-apps.service';
import { AppServiceSelectorComponent, SelectableService } from './app-service-selector.component';

const makeService = (id: number, name: string, over: Partial<SelectableService> = {}): SelectableService => ({
  id,
  slug: `svc-${id}`,
  name,
  description: null,
  price: id * 1000,
  final_price: id * 1000,
  image_url: `https://cdn.vendix.test/s${id}.jpg`,
  service_duration_minutes: 60,
  service_duration_unit: null,
  service_modality: 'in_person',
  requires_booking: true,
  categories: [],
  ...over,
});

describe('AppServiceSelectorComponent', () => {
  let fixture: ComponentFixture<AppServiceSelectorComponent>;
  let emittedIds: number[][];
  let appsSpy: jasmine.SpyObj<StoreAppsService>;

  const services = [
    makeService(5, 'Depilación láser', { final_price: 119000, service_duration_minutes: 45 }),
    makeService(7, 'Corte de cabello', { final_price: 35700, image_url: null }),
    makeService(9, 'Manicure', { final_price: 25000 }),
  ];

  beforeEach(() => {
    appsSpy = jasmine.createSpyObj<StoreAppsService>('StoreAppsService', ['servicePagePreviewContext']);
    appsSpy.servicePagePreviewContext.and.returnValue(
      of({ data: { services, featured_service_ids: [], products: [] } }),
    );
    TestBed.configureTestingModule({
      imports: [AppServiceSelectorComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreAppsService, useValue: appsSpy },
        {
          provide: CurrencyFormatService,
          useValue: { currencyCode: signal('COP'), format: (v: number) => `$${v}`, loadCurrency: () => {} },
        },
      ],
    });
    emittedIds = [];
    fixture = TestBed.createComponent(AppServiceSelectorComponent);
    fixture.componentInstance.selectedIdsChange.subscribe((ids) => emittedIds.push(ids));
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const open = async () => {
    (el().querySelector('[data-testid="service-selector-open"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();
  };

  it('busca por nombre sin tildes, muestra miniatura, duración y precio final, y respeta el orden elegido', async () => {
    const openBtn = el().querySelector('[data-testid="service-selector-open"]') as HTMLButtonElement;
    expect(openBtn.getAttribute('aria-haspopup')).toBe('dialog');
    await open();

    expect(el().querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    const search = el().querySelector('[data-testid="service-selector-search"]') as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    expect(el().querySelector('[data-testid="service-selector-results"]')?.getAttribute('role')).toBe('group');

    const option5 = el().querySelector('[data-testid="service-selector-option-5"]') as HTMLButtonElement;
    expect(option5.getAttribute('role')).toBe('checkbox');
    expect(option5.getAttribute('aria-checked')).toBe('false');
    expect(option5.querySelector('img')?.getAttribute('src')).toBe('https://cdn.vendix.test/s5.jpg');
    expect(option5.textContent).toContain('45 min');
    expect(option5.textContent).toContain('$119000');

    search.value = 'depilacion';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const visible = Array.from(el().querySelectorAll('[role="checkbox"]')).map((b) => b.getAttribute('data-testid'));
    expect(visible).toEqual(['service-selector-option-5']);

    search.value = '';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el().querySelector('[data-testid="service-selector-option-9"]') as HTMLButtonElement).click();
    (el().querySelector('[data-testid="service-selector-option-5"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="service-selector-option-9"]')?.getAttribute('aria-checked')).toBe('true');

    (el().querySelector('[data-testid="service-selector-apply"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emittedIds).toEqual([[9, 5]]);
    expect(fixture.componentInstance.modalOpen()).toBeFalse();
    expect(document.activeElement).toBe(openBtn);
  });

  it('cierra con Escape sin aplicar cambios y devuelve el foco al disparador', async () => {
    const openBtn = el().querySelector('[data-testid="service-selector-open"]') as HTMLButtonElement;
    openBtn.focus();
    await open();
    (el().querySelector('[data-testid="service-selector-option-7"]') as HTMLButtonElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.modalOpen()).toBeFalse();
    expect(emittedIds).toEqual([]);
    expect(document.activeElement).toBe(openBtn);
  });

  it('respeta el tope y deshabilita las opciones restantes', async () => {
    fixture.componentRef.setInput('max', 1);
    fixture.detectChanges();
    await open();
    (el().querySelector('[data-testid="service-selector-option-5"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el().querySelector('[data-testid="service-selector-option-7"]') as HTMLButtonElement).disabled).toBeTrue();
    expect(el().querySelector('[data-testid="service-selector-limit-notice"]')).not.toBeNull();
  });

  it('pinta chips removibles y reordenables; un id que ya no está en línea se puede quitar', () => {
    fixture.componentRef.setInput('selectedIds', [7, 404]);
    fixture.detectChanges();
    const remove7 = el().querySelector('[data-testid="service-selector-remove-7"]') as HTMLButtonElement;
    expect(remove7.getAttribute('aria-label')).toBe('Quitar Corte de cabello');
    expect(el().querySelector('[data-testid="service-selector-chip-404"]')?.textContent).toContain('Servicio #404');

    (el().querySelector('[data-testid="service-selector-up-404"]') as HTMLButtonElement).click();
    expect(emittedIds[emittedIds.length - 1]).toEqual([404, 7]);
    (el().querySelector('[data-testid="service-selector-remove-404"]') as HTMLButtonElement).click();
    expect(emittedIds[emittedIds.length - 1]).toEqual([7]);
  });
});
