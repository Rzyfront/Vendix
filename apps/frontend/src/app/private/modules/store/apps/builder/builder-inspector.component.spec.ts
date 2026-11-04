import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LANDING_BUILDER_CATALOG } from '../landing-builder/landing-builder.catalog';
import { BuilderInspectorComponent, BuilderPropChange } from './builder-inspector.component';
import type { BuilderBlock } from './builder.types';

/** F6-A — the field inspector: the catalog decides the fields; lists are edited item by item. */
describe('BuilderInspectorComponent (F6-A)', () => {
  let fixture: ComponentFixture<BuilderInspectorComponent>;
  let changes: BuilderPropChange[];

  async function render(block: BuilderBlock | null) {
    TestBed.configureTestingModule({
      imports: [BuilderInspectorComponent],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(BuilderInspectorComponent);
    fixture.componentRef.setInput('catalog', LANDING_BUILDER_CATALOG);
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
});
