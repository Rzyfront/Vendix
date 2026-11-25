import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LANDING_BUILDER_CATALOG } from '../landing-builder/landing-builder.catalog';
import { PRODUCT_PAGE_BUILDER_CATALOG } from '../page-builder/product-page/product-page-builder';
import { BuilderInspectorComponent, BuilderPropChange } from './builder-inspector.component';
import type { BuilderBlock, BuilderCatalog } from './builder.types';

/** F6-A — the field inspector: the catalog decides the fields; lists are edited item by item. */
describe('BuilderInspectorComponent (F6-A)', () => {
  let fixture: ComponentFixture<BuilderInspectorComponent>;
  let changes: BuilderPropChange[];

  async function render(block: BuilderBlock | null, catalog: BuilderCatalog = LANDING_BUILDER_CATALOG) {
    TestBed.configureTestingModule({
      imports: [BuilderInspectorComponent],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(BuilderInspectorComponent);
    fixture.componentRef.setInput('catalog', catalog);
    fixture.componentRef.setInput('block', block);
    changes = [];
    fixture.componentInstance.propChange.subscribe((c) => changes.push(c));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const lastItems = () => changes[changes.length - 1].value as Record<string, string>[];

  it('sin sección elegida invita a elegir una', async () => {
    await render(null);

    expect(el().querySelector('[data-testid="builder-inspector-empty"]')?.textContent).toContain('Elige una sección para editarla');
  });

  it('un texto muestra su contador y emite el cambio de esa prop', async () => {
    await render({ id: 'hero_1', type: 'hero', props: { title: 'Hola' } });

    expect(el().querySelector('[data-field="title"]')?.textContent).toContain('4/120');
    const input = el().querySelector('[data-field="title"] input') as HTMLInputElement;
    input.value = 'Hola mundo';
    input.dispatchEvent(new Event('input'));

    expect(changes).toEqual([{ blockId: 'hero_1', key: 'title', value: 'Hola mundo' }]);
  });

  it('una lista se edita por ítems: agregar, subir y quitar, con las claves canónicas', async () => {
    await render({ id: 'faq_1', type: 'faq', props: { items: [{ title: 'P1', description: 'R1' }, { question: 'P2', answer: 'R2' }] } });
    const click = (selector: string, index = 0) =>
      (el().querySelectorAll(selector)[index] as HTMLButtonElement).click();

    click('[data-testid="builder-list-add"]');
    expect(lastItems()).toEqual([
      { question: 'P1', answer: 'R1' },
      { question: 'P2', answer: 'R2' },
      { question: '', answer: '' },
    ]);

    click('[data-testid="builder-list-item"] button[aria-label="Subir Pregunta"]', 1);
    expect(lastItems().map((i) => i['question'])).toEqual(['P2', 'P1']);

    click('[data-testid="builder-list-remove"]', 0);
    expect(lastItems()).toEqual([{ question: 'P2', answer: 'R2' }]);
  });

  it('una lista vacía explica qué muestra la página', async () => {
    await render({ id: 'testimonials_1', type: 'testimonials', props: {} });

    expect(el().textContent).toContain('Sin testimonios propios la página muestra testimonios de ejemplo.');
  });

  it('un enlace que no es https se marca', async () => {
    await render({ id: 'location_hours_1', type: 'location_hours', props: { maps_url: 'http://maps.example' } });

    expect(el().querySelector('[data-field="maps_url"]')?.textContent).toContain('Usa un enlace que empiece por https://');
  });

  it('una sección con datos vivos lo avisa', async () => {
    await render({ id: 'products_grid_1', type: 'products_grid', props: {} });

    expect(el().querySelector('[data-testid="builder-live-data"]')?.textContent).toContain('salen solos de tu catálogo');
  });

  it('edita variantes con chips, sliders, colores, medios y apariencia en Product Page', async () => {
    await render(
      {
        id: 'gal_1',
        type: 'gallery',
        props: {
          title: 'Fotos',
          image_urls: ['https://cdn.x.co/1.jpg', 'https://cdn.x.co/2.jpg'],
        },
      },
      PRODUCT_PAGE_BUILDER_CATALOG,
    );

    // Chips de variante
    const carouselChip = el().querySelector('[data-field="variant"] [data-testid="builder-chip-carousel"]') as HTMLButtonElement;
    carouselChip.click();
    expect(changes[changes.length - 1]).toEqual({ blockId: 'gal_1', key: 'variant', value: 'carousel' });

    // Slider de columnas
    const rangeInput = el().querySelector('[data-field="columns"] input[type="range"]') as HTMLInputElement;
    rangeInput.value = '4';
    rangeInput.dispatchEvent(new Event('input'));
    expect(changes[changes.length - 1]).toEqual({ blockId: 'gal_1', key: 'columns', value: 4 });

    // Lista de medios: muestra app-media-field por imagen y botón de galería
    expect(el().querySelectorAll('[data-field="image_urls"] app-media-field').length).toBe(2);
    expect(el().querySelector('[data-testid="builder-list-add-media"]')).not.toBeNull();

    // Grupo plegable de apariencia con color, fondo, velo, espaciado y alineación
    const appearance = el().querySelector('[data-testid="builder-appearance-group"]');
    expect(appearance).not.toBeNull();
    expect(appearance?.querySelector('[data-field="background_color"]')).not.toBeNull();
    expect(appearance?.querySelector('[data-field="background_image_url"] app-media-field')).not.toBeNull();
    expect(appearance?.querySelector('[data-field="overlay_opacity"] input[type="range"]')).not.toBeNull();
    expect(appearance?.querySelector('[data-field="spacing"] [data-testid="builder-chip-spacious"]')).not.toBeNull();
    expect(appearance?.querySelector('[data-field="align"] [data-testid="builder-chip-center"]')).not.toBeNull();
  });
});
