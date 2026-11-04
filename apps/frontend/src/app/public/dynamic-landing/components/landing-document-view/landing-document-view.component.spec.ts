import { Component, input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CatalogService } from '../../../../private/modules/ecommerce/services/catalog.service';
import { LandingPreviewFrameComponent } from '../../../../private/modules/store/apps/landing-builder/landing-preview-frame.component';
import type { LandingPreviewPayload } from '../../../../private/modules/store/apps/landing-builder/landing-preview';
import { BUILDER_PREVIEW_CHANNEL } from '../../../../private/modules/store/apps/builder/builder-preview';
import { LandingOfferComponent } from '../../../landing-page/landing-offer.component';
import type { LandingOffer } from '../../../landing-page/landing-page.service';
import { LandingLayoutComponent } from '../../../../shared/components/layouts/landing-layout/landing-layout.component';
import type { CrmLandingDocument } from '../../blocks/landing-blocks.types';
import { LandingDocumentViewComponent } from './landing-document-view.component';

const DOC: CrmLandingDocument = {
  schema_version: 1,
  theme: { primary_color: '#059669' },
  blocks: [
    { id: 'hero_1', type: 'hero', props: { title: 'Bienvenidos' } },
    { id: 'about_1', type: 'about', props: { title: 'Nuestra historia' }, hidden: true },
    { id: 'footer_1', type: 'footer_cta', props: { title: 'Compra hoy' } },
  ],
};

/** The real layout reads the store config (NgRx); the frame only needs it to wrap the body. */
@Component({ selector: 'app-landing-layout', standalone: true, template: '<ng-content />' })
class StubLandingLayout {
  readonly brandName = input<string>('');
  readonly logoUrl = input<string | undefined>(undefined);
}

/** The real offer adds to the cart (NgRx); here only its place in the page matters. */
@Component({ selector: 'app-landing-offer', standalone: true, template: '<section data-testid="landing-offer"></section>' })
class StubLandingOffer {
  readonly offer = input<LandingOffer | null>(null);
}

const PROVIDERS = [
  provideZonelessChangeDetection(),
  provideRouter([]),
  { provide: CatalogService, useValue: {} },
];

const OFFER: LandingOffer = { mode: 'info', title: 'Déjanos tus datos', description: null, product: null };

/**
 * F6-A — the landing body shared by the public page and the builder preview:
 * one renderer, so what the owner sees is what the customer gets.
 */
describe('LandingDocumentViewComponent (F6-A)', () => {
  let fixture: ComponentFixture<LandingDocumentViewComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LandingDocumentViewComponent],
      providers: PROVIDERS,
    });
    TestBed.overrideComponent(LandingDocumentViewComponent, {
      remove: { imports: [LandingOfferComponent] },
      add: { imports: [StubLandingOffer] },
    });
  });

  async function render(inputs: Partial<{ document: CrmLandingDocument; offer: LandingOffer | null; preview: boolean }>) {
    fixture = TestBed.createComponent(LandingDocumentViewComponent);
    fixture.componentRef.setInput('document', inputs.document ?? DOC);
    fixture.componentRef.setInput('offer', inputs.offer ?? null);
    fixture.componentRef.setInput('preview', inputs.preview ?? false);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const sectionIds = () => Array.from(el().querySelectorAll('[data-block-id]')).map((n) => n.getAttribute('data-block-id'));

  it('no dibuja las secciones ocultas y respeta el orden', async () => {
    await render({});

    expect(sectionIds()).toEqual(['hero_1', 'footer_1']);
    expect(el().textContent).not.toContain('Nuestra historia');
  });

  it('aplica el color de marca del documento', async () => {
    await render({});

    expect((el().querySelector('.crm-landing') as HTMLElement).style.getPropertyValue('--crm-primary')).toBe('#059669');
  });

  it('con oferta: la oferta va tras la portada y el formulario al final si no hay bloque de contacto', async () => {
    await render({ offer: OFFER });

    const offer = el().querySelector('[data-testid="landing-offer"]')!;
    const hero = el().querySelector('[data-block-id="hero_1"]')!;
    expect(hero.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el().querySelectorAll('app-landing-lead-form').length).toBe(1);
  });

  it('sin oferta (tienda): ni oferta ni formulario extra, como hasta ahora', async () => {
    await render({});

    expect(el().querySelector('[data-testid="landing-offer"]')).toBeNull();
    expect(el().querySelector('app-landing-lead-form')).toBeNull();
  });

  it('en vista previa un clic selecciona la sección; en la página pública no', async () => {
    await render({ preview: true });
    const picked: string[] = [];
    fixture.componentInstance.blockSelect.subscribe((id) => picked.push(id));

    (el().querySelector('[data-block-id="footer_1"]') as HTMLElement).click();
    expect(picked).toEqual(['footer_1']);

    fixture.componentRef.setInput('preview', false);
    fixture.detectChanges();
    (el().querySelector('[data-block-id="footer_1"]') as HTMLElement).click();
    expect(picked).toEqual(['footer_1']);
  });

  it('el formulario de la vista previa no envía y lo dice', async () => {
    await render({ offer: OFFER, preview: true });
    const sent: unknown[] = [];
    fixture.componentInstance.leadSubmit.subscribe((p) => sent.push(p));

    const type = (selector: string, value: string) => {
      const field = el().querySelector(`app-landing-lead-form ${selector}`) as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event('input'));
    };
    type('input[type="text"]', 'Ana');
    type('input[type="email"]', 'ana@correo.co');
    type('textarea', 'Quiero información');
    (el().querySelector('app-landing-lead-form button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(sent).toEqual([]);
    expect(el().textContent).toContain('Vista previa: el formulario se envía en la página publicada.');
  });
});

describe('LandingPreviewFrameComponent (F6-A)', () => {
  it('dibuja el borrador que le envía el editor, con los productos reales de la tienda', async () => {
    TestBed.configureTestingModule({
      imports: [LandingPreviewFrameComponent],
      providers: PROVIDERS,
    });
    TestBed.overrideComponent(LandingPreviewFrameComponent, {
      remove: { imports: [LandingLayoutComponent] },
      add: { imports: [StubLandingLayout] },
    });
    const fixture = TestBed.createComponent(LandingPreviewFrameComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.payload()).toBeNull();

    const payload: LandingPreviewPayload = {
      document: {
        schema_version: 1,
        blocks: [{ id: 'products_grid_1', type: 'products_grid', props: { title: 'Lo más vendido' } }],
      },
      context: {
        products: [{ name: 'Café de origen', slug: 'cafe', price: 25000, image_url: null }],
        ecommerce_base_url: 'https://mitienda.vendix.online',
      },
      offer: null,
      storeName: 'Mi Tienda',
      storeLogoUrl: null,
    };
    // The spec runs inside karma's iframe, so the frame's parent is a real window.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: BUILDER_PREVIEW_CHANNEL, type: 'render', payload, selectedBlockId: null },
        origin: window.location.origin,
        source: window.parent,
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Lo más vendido');
    expect(text).toContain('Café de origen');
  });

  it('ignora mensajes de otro origen', () => {
    TestBed.configureTestingModule({
      imports: [LandingPreviewFrameComponent],
      providers: PROVIDERS,
    });
    TestBed.overrideComponent(LandingPreviewFrameComponent, {
      remove: { imports: [LandingLayoutComponent] },
      add: { imports: [StubLandingLayout] },
    });
    const fixture = TestBed.createComponent(LandingPreviewFrameComponent);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: BUILDER_PREVIEW_CHANNEL, type: 'render', payload: {}, selectedBlockId: null },
        origin: 'https://evil.example',
        source: window.parent,
      }),
    );

    expect(fixture.componentInstance.payload()).toBeNull();
  });
});
