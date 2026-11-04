import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { AppPageDocument, PageAppKind } from '../../private/modules/store/apps/templates/app-page.types';
import { APP_PAGE_VARIANTS } from '../../private/modules/store/apps/templates';
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

  describe('theme (apps-f3)', () => {
    const THEME_VARS = [
      '--ap-surface',
      '--ap-text',
      '--ap-on-primary',
      '--ap-accent',
      '--ap-heading-font',
      '--ap-radius-card',
      '--ap-radius-button',
      '--ap-radius-image',
      '--ap-section-py',
      '--ap-max-width',
      '--color-surface-rgb',
      '--color-text-primary-rgb',
      '--color-text-secondary-rgb',
      '--color-border',
    ];

    it('without theme binds no style token: the page renders exactly as before', () => {
      const el = render(page({ brand: { primary_color: '#112233', font_family: 'lora' } }));
      const host = fixture.nativeElement as HTMLElement;
      expect(host.classList.contains('ap-themed')).toBeFalse();
      expect(host.classList.contains('ap-outline')).toBeFalse();
      for (const name of THEME_VARS) {
        expect(host.style.getPropertyValue(name)).withContext(name).toBe('');
      }
      // The F2 brand still applies, with white text on the primary.
      expect(host.style.getPropertyValue('--ap-primary')).toBe('#112233');
      expect(host.style.fontFamily).toContain('Lora');
      const cta = el.querySelector<HTMLElement>('[data-testid="cta"]')!;
      expect(getComputedStyle(cta).color).toBe('rgb(255, 255, 255)');
      expect(getComputedStyle(el.querySelector('section[data-block]')!).paddingTop).toBe('32px');
    });

    it('applies the theme tokens as custom properties on the page container', () => {
      const el = render(
        page({
          brand: { primary_color: '#112233', font_family: 'lora' },
          theme: {
            primary_color: '#F5C542',
            surface_color: '#FBF7F2',
            text_color: '#2B211C',
            accent_color: '#8C5A2B',
            heading_font: 'playfair',
            body_font: 'inter',
            radius: 'none',
            density: 'compact',
            button_style: 'outline',
            image_style: 'square',
            content_width: 'narrow',
          },
        }),
      );
      const host = fixture.nativeElement as HTMLElement;
      expect(host.classList.contains('ap-themed')).toBeTrue();
      expect(host.classList.contains('ap-outline')).toBeTrue();
      // The theme's primary wins over the brand's; a light primary gets dark text.
      expect(host.style.getPropertyValue('--ap-primary')).toBe('#F5C542');
      expect(host.style.getPropertyValue('--ap-on-primary')).toBe('#111827');
      expect(host.style.getPropertyValue('--ap-surface')).toBe('#FBF7F2');
      expect(host.style.getPropertyValue('--color-text-primary-rgb')).toBe('43, 33, 28');
      expect(host.style.getPropertyValue('--ap-max-width')).toBe('56rem');
      expect(host.style.fontFamily).toContain('Inter');

      expect(getComputedStyle(host).backgroundColor).toBe('rgb(251, 247, 242)');
      const section = el.querySelector<HTMLElement>('section[data-block="benefits"]')!;
      expect(getComputedStyle(section).maxWidth).toBe('896px');
      expect(getComputedStyle(section).paddingTop).toBe('20px');
      expect(getComputedStyle(el.querySelector('.ap-card')!).borderTopLeftRadius).toBe('0px');
      expect(getComputedStyle(el.querySelector('[data-testid="hero-title"]')!).fontFamily).toContain('Playfair Display');
      const cta = el.querySelector<HTMLElement>('[data-testid="cta"]')!;
      expect(getComputedStyle(cta).color).toBe('rgb(17, 24, 39)');
      // Outline buttons: transparent background, border in the text color.
      const button = el.querySelector<HTMLElement>('[data-testid="cta-button"]')!;
      expect(getComputedStyle(button).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(button).borderTopLeftRadius).toBe('0px');
    });

    it('a partial theme only changes its own tokens', () => {
      const el = render(page({ theme: { density: 'spacious' } }));
      const host = fixture.nativeElement as HTMLElement;
      expect(host.classList.contains('ap-themed')).toBeTrue();
      expect(host.style.getPropertyValue('--ap-surface')).toBe('');
      expect(host.style.getPropertyValue('--color-surface-rgb')).toBe('');
      expect(getComputedStyle(el.querySelector('section[data-block="benefits"]')!).paddingTop).toBe('48px');
      expect(getComputedStyle(el.querySelector('.ap-card')!).borderTopLeftRadius).toBe('16px');
    });

    it('renders a template variant in its own block order', () => {
      const clinical = APP_PAGE_VARIANTS.product_page[2];
      const el = render(clinical.page);
      const rendered = Array.from(el.querySelectorAll('section[data-block]')).map((s) => s.getAttribute('data-block'));
      const expected = clinical.page.blocks
        .filter((b) => b.enabled && b.type !== 'complements')
        .map((b) => b.type);
      expect(rendered).toEqual(expected);
      expect(rendered[0]).toBe('specifications');
    });
  });
});
