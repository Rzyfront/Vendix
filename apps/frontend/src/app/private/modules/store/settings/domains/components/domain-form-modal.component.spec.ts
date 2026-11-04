import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { DomainFormModalComponent } from './domain-form-modal.component';
import { StoreDomain } from '../domain.interface';

/**
 * Apps F5: the "Aplicación destino" selector of a store domain offers the app
 * types of the apps, with their Spanish names, except on the domains that
 * serve the online store or the admin.
 */
describe('DomainFormModalComponent · Aplicación destino (Apps F5)', () => {
  const create = (domain: Partial<StoreDomain> | null) => {
    const fixture = TestBed.createComponent(DomainFormModalComponent);
    fixture.componentRef.setInput('domain', domain as StoreDomain | null);
    return fixture.componentInstance;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DomainFormModalComponent],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
        provideMockStore({ initialState: {} }),
      ],
    });
  });

  it('un dominio nuevo ofrece las apps con su nombre en español', () => {
    const labels = create(null).appTypeOptions().map((o) => o.label);
    expect(labels).toEqual([
      'E-commerce',
      'Landing de tienda',
      'Admin de tienda',
      'Inicio de tienda',
      'Página de producto',
      'Página de servicios',
      'Reservas',
    ]);
  });

  it('un dominio de landing también puede pasar a una app', () => {
    const values = create({ id: 7, app_type: 'STORE_LANDING' } as Partial<StoreDomain>)
      .appTypeOptions()
      .map((o) => o.value);
    expect(values).toContain('STORE_BOOKING');
    expect(values).toContain('STORE_HOME');
  });

  it('el dominio de la tienda en línea o del admin no ofrece las apps', () => {
    for (const app_type of ['STORE_ECOMMERCE', 'STORE_ADMIN']) {
      const values = create({ id: 8, app_type } as Partial<StoreDomain>)
        .appTypeOptions()
        .map((o) => o.value);
      expect(values).toEqual(['STORE_ECOMMERCE', 'STORE_LANDING', 'STORE_ADMIN']);
    }
  });
});
