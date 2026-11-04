import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { AppPageDocument, PageAppKind } from '../../private/modules/store/apps/templates/app-page.types';
import { AppPageViewComponent } from './app-page-view.component';

const page = (over: Partial<AppPageDocument> = {}): AppPageDocument => ({
  schema_version: 1,
  hero: { eyebrow: 'Nuevo', title: 'Tu mejor compra', subtitle: 'Sin vueltas', button_label: 'Comprar' },
  blocks: [
    { id: 'benefits', type: 'benefits', enabled: true, props: { title: 'Beneficios', items: [{ title: 'Rápido', text: 'Llega hoy' }] } },
    { id: 'complements', type: 'complements', enabled: true, props: { title: 'Complementos' } },
    { id: 'faq', type: 'faq', enabled: false, props: { title: 'Preguntas', items: [{ question: 'Q', answer: 'A' }] } },
    { id: 'ghost', type: 'ghost_block', enabled: true, props: { title: 'Fantasma' } },
    {
      id: 'testimonials',
      type: 'testimonials',
      enabled: true,
      props: { title: 'Clientes', rating_summary: '4.9/5', items: [{ name: 'Ana', city: 'Cali', quote: 'Genial', rating: 4 }] },
    },
    { id: 'cta', type: 'cta', enabled: true, props: { title: 'Compra hoy', button_label: 'Ir' } },
  ],
  ...over,
});

describe('AppPageViewComponent (apps-f2 T3)', () => {
  let fixture: ComponentFixture<AppPageViewComponent>;

  const render = (
    doc: AppPageDocument | null,
    opts: { part?: 'hero' | 'blocks' | 'all'; preview?: boolean; kind?: PageAppKind } = {},
  ) => {
    fixture = TestBed.createComponent(AppPageViewComponent);
    fixture.componentRef.setInput('kind', opts.kind ?? 'product_page');
    fixture.componentRef.setInput('page', doc);
    if (opts.part) fixture.componentRef.setInput('part', opts.part);
    if (opts.preview) fixture.componentRef.setInput('preview', true);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [AppPageViewComponent],
      providers: [provideZonelessChangeDetection()],
    }),
  );

  it('renders the hero and the enabled blocks in page order, skipping disabled, existing and unknown ones', () => {
    const el = render(page());

    expect(el.querySelector('[data-testid="hero-title"]')?.textContent).toContain('Tu mejor compra');
    expect(el.querySelector('[data-testid="hero-eyebrow"]')?.textContent).toContain('Nuevo');
    const order = Array.from(el.querySelectorAll('[data-block]')).map((n) => n.getAttribute('data-block'));
    expect(order).toEqual(['benefits', 'testimonials', 'cta']);
    expect(el.textContent).not.toContain('Fantasma');
    expect(el.textContent).not.toContain('Preguntas');
    expect(el.querySelector('[data-testid="app-page-placeholder"]')).toBeNull();
  });

  it('part="hero" and part="blocks" render only their half', () => {
    expect(render(page(), { part: 'hero' }).querySelector('[data-block]')).toBeNull();
    const blocksOnly = render(page(), { part: 'blocks' });
    expect(blocksOnly.querySelector('[data-testid="app-page-hero"]')).toBeNull();
    expect(blocksOnly.querySelector('[data-block="benefits"]')).not.toBeNull();
  });

  it('preview shows a dashed placeholder where an existing section goes', () => {
    const el = render(page(), { preview: true });
    const ph = el.querySelector('[data-testid="app-page-placeholder"]');
    expect(ph?.textContent).toContain('Aquí va:');
    expect(ph?.textContent).toContain('Complementos');
  });

  it('testimonials show stars from rating, name and city, and the rating summary', () => {
    const el = render(page());
    const stars = el.querySelector('[data-testid="stars"]');
    expect(stars?.getAttribute('aria-label')).toBe('4 de 5 estrellas');
    expect(stars?.textContent?.replace(/\s/g, '')).toBe('★★★★☆');
    expect(el.querySelector('[data-testid="rating-summary"]')?.textContent).toContain('4.9/5');
    expect(el.querySelector('figcaption')?.textContent).toContain('Ana');
    expect(el.querySelector('figcaption')?.textContent).toContain('Cali');
  });

  it('applies the brand colors as host custom properties and the font stack', () => {
    const el = render(
      page({ brand: { primary_color: '#112233', secondary_color: '#445566', font_family: 'lora' } }),
    );
    const host = el as HTMLElement;
    expect(host.style.getPropertyValue('--ap-primary')).toBe('#112233');
    expect(host.style.getPropertyValue('--ap-secondary')).toBe('#445566');
    expect(host.style.fontFamily).toContain('Georgia');
  });

  it('ignores invalid colors and non-http urls', () => {
    const el = render(page({ brand: { primary_color: 'red' }, hero: { title: 'T', image_url: 'javascript:alert(1)' } }));
    expect((el as HTMLElement).style.getPropertyValue('--ap-primary')).toBe('');
    expect(el.querySelector('img')).toBeNull();
  });

  it('faq renders accessible details and location links open safely', () => {
    const el = render(
      {
        schema_version: 1,
        blocks: [
          { id: 'faq', type: 'faq', enabled: true, props: { items: [{ question: 'Q1', answer: 'A1' }] } },
          { id: 'location', type: 'location', enabled: true, props: { address: 'Calle 1', map_url: 'https://maps.example/x' } },
        ],
      },
      { kind: 'booking' },
    );
    expect(el.querySelector('details summary')?.textContent).toContain('Q1');
    const map = el.querySelector<HTMLAnchorElement>('[data-block="location"] a');
    expect(map?.getAttribute('rel')).toBe('noopener noreferrer');
    const home = render(
      {
        schema_version: 1,
        blocks: [{ id: 'contact', type: 'contact', enabled: true, props: { phone: '3001112233', email: 'a@b.co' } }],
      },
      { kind: 'store_home' },
    );
    expect(home.querySelector('a[href="tel:3001112233"]')).not.toBeNull();
    expect(home.querySelector('a[href="mailto:a@b.co"]')).not.toBeNull();
  });

  it('renders nothing without a page', () => {
    expect(render(null).textContent?.trim()).toBe('');
  });
});
