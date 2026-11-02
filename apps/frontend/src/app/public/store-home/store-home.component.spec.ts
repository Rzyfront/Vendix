import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { TenantFacade } from '../../core/store';
import type { DomainConfig } from '../../core/models/domain-config.interface';
import { StoreHomeComponent } from './store-home.component';
import { StoreHomePublic, StoreHomeService } from './store-home.service';

const home = (over: Partial<StoreHomePublic> = {}): StoreHomePublic => ({
  store_name: 'Roku',
  branding: {
    name: 'Roku',
    logo_url: 'https://cdn/roku.png',
    primary_color: '#112233',
    secondary_color: null,
    accent_color: null,
  },
  footer: { text: 'Hecho con Vendix', site_url: 'https://vendix.online' },
  ...over,
});

describe('StoreHomeComponent (apps-module Fase 5)', () => {
  let fixture: ComponentFixture<StoreHomeComponent>;

  const render = async (page: StoreHomePublic | null, domain: Partial<DomainConfig> = {}) => {
    TestBed.configureTestingModule({
      imports: [StoreHomeComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: StoreHomeService, useValue: { load: () => of(page) } },
        {
          provide: TenantFacade,
          useValue: { domainConfig: signal(domain as DomainConfig) },
        },
      ],
    });
    fixture = TestBed.createComponent(StoreHomeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('muestra la marca de la tienda, el botón de ingreso y el pie de Vendix', async () => {
    const el = await render(home());

    expect(el.querySelector('[data-testid="store-home-name"]')?.textContent?.trim()).toBe('Roku');
    expect(el.querySelector<HTMLImageElement>('[data-testid="store-home-logo"]')?.src).toBe(
      'https://cdn/roku.png',
    );
    const login = el.querySelector<HTMLAnchorElement>('[data-testid="store-home-login"]');
    expect(login?.textContent?.trim()).toBe('Ingresar a la plataforma');
    expect(login?.getAttribute('href')).toBe('/auth/login');
    const footer = el.querySelector('[data-testid="store-home-footer"]');
    expect(footer?.textContent).toContain('Vendix');
    expect(footer?.textContent).toContain('Hecho con Vendix');
    expect(footer?.querySelector('a')?.getAttribute('href')).toBe('https://vendix.online');
  });

  it('no muestra catálogo, carrito, productos ni precios', async () => {
    const el = await render(home());

    expect(el.querySelector('a[href="/cart"]')).toBeNull();
    expect(el.querySelector('a[href^="/products"]')).toBeNull();
    expect(el.textContent).not.toContain('$');
    expect(el.querySelectorAll('a').length).toBe(2);
  });

  it('sin branding de tienda ni de organización aplica el de Vendix', async () => {
    const el = await render(
      home({
        store_name: null,
        branding: { name: null, logo_url: null, primary_color: null, secondary_color: null, accent_color: null },
      }),
      { store_slug: 'roku' },
    );

    expect(el.querySelector('[data-testid="store-home-name"]')?.textContent?.trim()).toBe('roku');
    expect(el.querySelector<HTMLImageElement>('[data-testid="store-home-logo"]')?.getAttribute('src')).toBe(
      'vlogomono.png',
    );
    expect(fixture.componentInstance.heroBackground()).toBe('var(--color-primary)');
  });

  it('si la portada no se puede leer usa la marca que trae el dominio', async () => {
    const el = await render(null, {
      store_name: 'Roku Centro',
      store_logo_url: 'https://cdn/centro.png',
    });

    expect(el.querySelector('[data-testid="store-home-name"]')?.textContent?.trim()).toBe('Roku Centro');
    expect(el.querySelector<HTMLImageElement>('[data-testid="store-home-logo"]')?.src).toBe(
      'https://cdn/centro.png',
    );
    expect(el.querySelector('[data-testid="store-home-footer"]')?.textContent).toContain('Latinoamérica');
  });

  it('con color secundario el hero usa el degradado de la marca', async () => {
    await render(
      home({
        branding: { name: 'Roku', logo_url: null, primary_color: '#112233', secondary_color: '#445566', accent_color: null },
      }),
    );

    expect(fixture.componentInstance.heroBackground()).toBe('linear-gradient(135deg, #112233, #445566)');
  });
});
