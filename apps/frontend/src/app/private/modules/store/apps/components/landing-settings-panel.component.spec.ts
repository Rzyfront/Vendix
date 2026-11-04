import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LandingSettingsPanelComponent } from './landing-settings-panel.component';
import { StoreAppsService } from '../services/store-apps.service';
import { ProductsService } from '../../products/services/products.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import type { Product } from '../../products/interfaces/product.interface';
import type { StoreAppDetail } from '../interfaces/store-app.interface';

const item = (id: number, name: string) =>
  ({ id, name, slug: `p-${id}`, product_type: 'physical', available_for_ecommerce: true }) as unknown as Product;

const detail = (over: Partial<StoreAppDetail> = {}): StoreAppDetail => ({
  key: 'landing',
  name: 'Landing page',
  description: '',
  applies_to_store_industries: true,
  status: 'not_installed',
  enabled: false,
  domain: null,
  public_url: null,
  published_at: null,
  config: {},
  ...over,
});

describe('LandingSettingsPanelComponent (apps-module Fase 6)', () => {
  let fixture: ComponentFixture<LandingSettingsPanelComponent>;
  let component: LandingSettingsPanelComponent;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let products: jasmine.SpyObj<ProductsService>;

  const open = async (d: StoreAppDetail) => {
    apps.get.and.returnValue(of({ success: true, data: d }));
    fixture = TestBed.createComponent(LandingSettingsPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(() => {
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'saveLandingConfig',
      'publishLanding',
      'unpublishLanding',
      'landingCustomDomains',
    ]);
    apps.landingCustomDomains.and.returnValue(
      of({ data: [{ id: 77, hostname: 'promo.mitienda.com', status: 'active', app_type: 'STORE_LANDING' }] }),
    );
    apps.saveLandingConfig.and.returnValue(of({}));
    apps.publishLanding.and.returnValue(of({}));
    apps.unpublishLanding.and.returnValue(of({}));
    products = jasmine.createSpyObj('ProductsService', ['getProducts', 'getProductById']);
    products.getProductById.and.callFake((id: number) => of(item(id, `Item ${id}`)));

    TestBed.configureTestingModule({
      imports: [LandingSettingsPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: StoreAppsService, useValue: apps },
        { provide: ProductsService, useValue: products },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    });
  });

  it('al abrir carga la oferta con producto y los dominios propios', async () => {
    await open(
      detail({
        status: 'draft',
        config: { offer_mode: 'product', offer_title: 'Combo', offer_description: null, offer_product_id: 9 },
      }),
    );

    expect(component.mode()).toBe('product');
    expect(component.title()).toBe('Combo');
    expect(component.product()).toEqual({ id: 9, name: 'Item 9' });
    expect(component.customDomains().map((d) => d.hostname)).toEqual(['promo.mitienda.com']);
    expect(component.statusLabel()).toBe('Borrador');
  });

  it('publicar una oferta informativa guarda sin producto y publica en la dirección de Vendix', async () => {
    await open(detail());
    component.title.set('  Asesoría gratis ');

    component.save(true);

    expect(apps.saveLandingConfig).toHaveBeenCalledWith({
      offer_mode: 'info',
      offer_title: 'Asesoría gratis',
      offer_description: null,
      offer_product_id: null,
    });
    expect(apps.publishLanding).toHaveBeenCalledWith(null);
  });

  it('una oferta con producto sin producto no se envía', async () => {
    await open(detail());
    component.mode.set('product');

    component.save(true);

    expect(component.error()).toBe('Elige el producto de la oferta.');
    expect(apps.saveLandingConfig).not.toHaveBeenCalled();
  });

  it('publicar en un dominio propio envía su id con el producto elegido', async () => {
    await open(detail());
    component.mode.set('product');
    component.pick(item(4, 'Kit'));
    component.customDomainId.set(77);

    component.save(true);

    expect(apps.saveLandingConfig).toHaveBeenCalledWith(
      jasmine.objectContaining({ offer_mode: 'product', offer_product_id: 4 }),
    );
    expect(apps.publishLanding).toHaveBeenCalledWith(77);
  });

  it('la landing marcada publicada sin dominio propio no ofrece despublicar', async () => {
    await open(detail({ status: 'published' }));

    expect(component.hasOwnDomain()).toBeFalse();
    expect(component.statusLabel()).toBe('Publicada en el dominio de la tienda, sin dominio propio');
    expect(component.canUnpublish()).toBeFalse();
  });

  it('publicada en su dominio muestra la URL y despublica', async () => {
    await open(
      detail({
        status: 'published',
        domain: { id: 5, hostname: 'roku-landing.vendix.online', status: 'active' },
        public_url: 'https://roku-landing.vendix.online',
      }),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="landing-url"]').textContent).toContain(
      'https://roku-landing.vendix.online',
    );
    component.unpublish();
    expect(apps.unpublishLanding).toHaveBeenCalled();
  });

  it('muestra el error del servidor al publicar', async () => {
    await open(detail());
    apps.publishLanding.and.returnValue(
      throwError(() => ({ error: { message: 'Publica primero la landing en Landing de captación para ponerla en su propio dominio.' } })),
    );

    component.save(true);

    expect(component.error()).toBeTruthy();
    expect(component.busy()).toBeFalse();
  });
});
