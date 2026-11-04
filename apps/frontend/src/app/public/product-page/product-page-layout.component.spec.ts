import { Component, input, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { TenantFacade } from '../../core/store';
import { AuthModalComponent } from '../../private/layouts/store-ecommerce/components/auth-modal/auth-modal.component';
import { CartService } from '../../private/modules/ecommerce/services/cart.service';
import { StoreSeoService } from '../../private/modules/ecommerce/services/store-seo';
import { StoreUiService } from '../../private/modules/ecommerce/services/store-ui.service';
import { ProductComplementsComponent } from './components/product-complements.component';
import { ProductPageLayoutComponent } from './product-page-layout.component';
import { ProductPagePublicConfig, ProductPageService } from './product-page.service';

@Component({ selector: 'app-auth-modal', standalone: true, template: '' })
class AuthModalStub {
  readonly isOpen = input(false);
  readonly initialMode = input('login');
  readonly storeLogo = input<string | null>(null);
  readonly storeName = input('');
}

@Component({ selector: 'app-product-complements', standalone: true, template: '{{ title() }}' })
class ComplementsStub {
  readonly productIds = input<number[]>([]);
  readonly title = input('');
}

@Component({ selector: 'app-dummy', standalone: true, template: '<p data-testid="detail"></p>' })
class DummyComponent {}

describe('ProductPageLayoutComponent (apps-f2 T3)', () => {
  const render = async (cfg: ProductPagePublicConfig) => {
    TestBed.configureTestingModule({
      imports: [ProductPageLayoutComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: 'products/:slug', component: DummyComponent }]),
        { provide: ProductPageService, useValue: { config: signal(cfg), load: () => of(cfg) } },
        { provide: CartService, useValue: { cart: signal(null), purgeExpiredLocalCart: () => {} } },
        { provide: StoreUiService, useValue: { openAuthModal$: new Subject() } },
        { provide: StoreSeoService, useValue: { setStore: () => {} } },
        { provide: TenantFacade, useValue: { domainConfig$: of(null) } },
      ],
    });
    TestBed.overrideComponent(ProductPageLayoutComponent, {
      remove: { imports: [AuthModalComponent, ProductComplementsComponent] },
      add: { imports: [AuthModalStub, ComplementsStub] },
    });
    await TestBed.inject(Router).navigateByUrl('/products/crema');
    const fixture = TestBed.createComponent(ProductPageLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const base: ProductPagePublicConfig = {
    product: { id: 1, slug: 'crema', name: 'Crema' },
    complement_product_ids: [5],
  };

  it('with no saved page: cart link, complements and no hero (as before)', async () => {
    const el = await render(base);
    expect(el.querySelector('a[href="/cart"]')).not.toBeNull();
    expect(el.querySelector('app-app-page-view')).toBeNull();
    expect(el.querySelector('app-product-complements')?.textContent).toContain('Complementa tu compra');
    expect(el.querySelector('main')?.hasAttribute('id')).toBeFalse();
    // F6-B: the editor marks sections with data-block-id; the public page never does.
    expect(el.querySelector('[data-block-id]')).toBeNull();
  });

  it('with a page: hero on the featured product, complements title, and blocks below', async () => {
    const el = await render({
      ...base,
      page: {
        schema_version: 1,
        mode: 'sales',
        hero: { title: 'Crema que cuida' },
        blocks: [
          { id: 'complements', type: 'complements', enabled: true, props: { title: 'Lleva también' } },
          { id: 'faq', type: 'faq', enabled: true, props: { items: [{ question: 'Q', answer: 'A' }] } },
        ],
      },
    });
    expect(el.querySelector('[data-testid="hero-title"]')?.textContent).toContain('Crema que cuida');
    expect(el.querySelector('app-product-complements')?.textContent).toContain('Lleva también');
    expect(el.querySelector('[data-block="faq"]')).not.toBeNull();
    expect(el.querySelector('a[href="/cart"]')).not.toBeNull();
    expect(el.querySelector('[data-block-id]')).toBeNull();
  });

  it('info mode hides the header cart; a disabled complements block hides the section', async () => {
    const el = await render({
      ...base,
      page: {
        schema_version: 1,
        mode: 'info',
        blocks: [{ id: 'complements', type: 'complements', enabled: false, props: {} }],
      },
    });
    expect(el.querySelector('a[href="/cart"]')).toBeNull();
    expect(el.querySelector('app-product-complements')).toBeNull();
  });
});
