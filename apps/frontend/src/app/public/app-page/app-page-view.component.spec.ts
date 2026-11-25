import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { AppPageDocument, PageAppKind } from '../../private/modules/store/apps/templates/app-page.types';
import { APP_PAGE_VARIANTS } from '../../private/modules/store/apps/templates';
import { AppPageViewComponent } from './app-page-view.component';
import { cssBgUrl } from './app-page-view.util';

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

  describe('F6-B: builder preview and WhatsApp', () => {
    it('marks the hero and each section with data-block-id only when asked (public page untouched)', () => {
      let el = render(page());
      expect(el.querySelector('[data-block-id]')).toBeNull();
      fixture = TestBed.createComponent(AppPageViewComponent);
      fixture.componentRef.setInput('kind', 'product_page');
      fixture.componentRef.setInput('page', page());
      fixture.componentRef.setInput('blockIds', true);
      fixture.detectChanges();
      el = fixture.nativeElement as HTMLElement;
      expect(Array.from(el.querySelectorAll('[data-block-id]')).map((n) => n.getAttribute('data-block-id'))).toEqual([
        'hero',
        'benefits',
        'testimonials',
        'cta',
      ]);
    });

    it('shows the floating WhatsApp button only when turned on with a valid number', () => {
      expect(render(page({ brand: { whatsapp_number: '+57 300 123 4567' } })).querySelector('[data-testid="app-page-whatsapp"]')).toBeNull();
      const el = render(page({ brand: { whatsapp_number: '+57 300 123 4567', whatsapp_message: 'Hola, quiero info', whatsapp_floating: true } }));
      const link = el.querySelector('[data-testid="app-page-whatsapp"]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('https://wa.me/573001234567?text=Hola%2C%20quiero%20info');
      expect(render(page({ brand: { whatsapp_number: '12', whatsapp_floating: true } })).querySelector('[data-testid="app-page-whatsapp"]')).toBeNull();
      expect(render(page({ brand: { whatsapp_number: '573001234567', whatsapp_floating: true } }), { part: 'hero' }).querySelector('[data-testid="app-page-whatsapp"]')).toBeNull();
    });
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

    describe('extended tokens (apps-f7)', () => {
      const md = () => window.matchMedia('(min-width: 768px)').matches;
      const withGallery = (theme: AppPageDocument['theme']) =>
        page({
          theme,
          brand: { cover_url: 'https://cdn.test/cover.jpg' },
          blocks: [
            ...page().blocks,
            { id: 'gallery', type: 'gallery', enabled: true, props: { image_urls: ['https://cdn.test/a.jpg'] } },
          ],
        });

      it('an F3-only theme binds no F7 marker and keeps today\'s computed look', () => {
        const el = render(withGallery({ density: 'spacious' }));
        const host = fixture.nativeElement as HTMLElement;
        for (const name of ['data-ap-type', 'data-ap-card', 'data-ap-shadow', 'data-ap-overlay', 'data-ap-hero']) {
          expect(host.hasAttribute(name)).withContext(name).toBeFalse();
        }
        expect(getComputedStyle(el.querySelector('section[data-block="benefits"]')!).paddingTop).toBe('48px');
        const card = el.querySelector<HTMLElement>('.ap-card')!;
        expect(getComputedStyle(card).boxShadow).toBe('none');
        expect(getComputedStyle(card.querySelector('p')!).fontSize).toBe('14px');
        const img = el.querySelector<HTMLElement>('.ap-img')!;
        expect(getComputedStyle(img).aspectRatio).toBe('1 / 1');
        expect(getComputedStyle(img).filter).toBe('none');
        const veil = el.querySelector<HTMLElement>('.ap-cover-veil')!;
        expect(getComputedStyle(veil).backgroundColor).toBe('rgba(0, 0, 0, 0.4)');
        const inner = el.querySelector<HTMLElement>('.ap-hero-inner')!;
        expect(getComputedStyle(inner).paddingTop).toBe(md() ? '64px' : '48px');
      });

      it('applies border, type scale, section gap, cards, shadow, image ratio, veil and hero height', () => {
        const el = render(
          withGallery({
            density: 'spacious',
            border_color: '#123456',
            base_font_size: 'lg',
            heading_scale: 'display',
            section_gap: 'airy',
            card_style: 'flat',
            shadow: 'strong',
            image_ratio: '16:9',
            image_overlay: 40,
            hero_height: 'full',
          }),
        );
        const host = fixture.nativeElement as HTMLElement;
        expect(host.style.getPropertyValue('--color-border')).toBe('#123456');
        // spacious 3rem (md 4.5rem) × airy 1.5
        expect(getComputedStyle(el.querySelector('section[data-block="benefits"]')!).paddingTop).toBe(md() ? '108px' : '72px');
        const card = el.querySelector<HTMLElement>('.ap-card')!;
        expect(getComputedStyle(card).borderTopColor).toBe('rgba(0, 0, 0, 0)');
        expect(getComputedStyle(card).boxShadow).not.toBe('none');
        expect(getComputedStyle(card.querySelector('p')!).fontSize).toBe('14.875px');
        const title = el.querySelector<HTMLElement>('[data-testid="hero-title"]')!;
        // text-3xl (md:text-5xl) × lg 1.0625 × display 1.25
        expect(parseFloat(getComputedStyle(title).fontSize)).toBeCloseTo(md() ? 63.75 : 39.84, 1);
        const img = el.querySelector<HTMLElement>('.ap-img')!;
        expect(getComputedStyle(img).aspectRatio).toBe('16 / 9');
        expect(getComputedStyle(img).filter).toBe('brightness(0.6)');
        expect(getComputedStyle(el.querySelector('.ap-cover-veil')!).backgroundColor).toBe('rgba(0, 0, 0, 0.4)');
        const hero = el.querySelector<HTMLElement>('[data-testid="app-page-hero"]')!;
        expect(getComputedStyle(hero).display).toBe('flex');
        expect(parseFloat(getComputedStyle(hero).minHeight)).toBeGreaterThan(0);
      });

      it('card styles: outline drops the fill, soft drops the border', () => {
        let el = render(page({ theme: { card_style: 'outline' } }));
        expect(getComputedStyle(el.querySelector('.ap-card')!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
        el = render(page({ theme: { card_style: 'soft' } }));
        expect(getComputedStyle(el.querySelector('.ap-card')!).borderTopColor).toBe('rgba(0, 0, 0, 0)');
      });
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

  describe('section variants and block appearance (apps-sections)', () => {
    it('hero renders each layout variant, background image with overlay, height and alignment', () => {
      const centered = render({
        schema_version: 1,
        hero: {
          title: 'Centrado',
          variant: 'centered',
          height: 'compact',
          align: 'center',
          image_url: 'https://cdn.x.co/hero.jpg',
        },
        blocks: [],
      });
      const centeredHero = centered.querySelector('[data-testid="app-page-hero"]') as HTMLElement;
      expect(centeredHero.classList.contains('ap-hero--centered')).toBeTrue();
      expect(centeredHero.classList.contains('ap-hero--compact')).toBeTrue();
      expect(centeredHero.getAttribute('data-hero-align')).toBe('center');
      expect(centered.querySelector('[data-testid="hero-image"]')).not.toBeNull();

      const imageRight = render({
        schema_version: 1,
        hero: {
          title: 'Derecha',
          variant: 'image_right',
          image_url: 'https://cdn.x.co/side.jpg',
        },
        blocks: [],
      });
      const rightHero = imageRight.querySelector('[data-testid="app-page-hero"]') as HTMLElement;
      expect(rightHero.classList.contains('ap-hero--image-right')).toBeTrue();
      expect(imageRight.querySelector('[data-testid="hero-image"]')).not.toBeNull();

      const background = render({
        schema_version: 1,
        hero: {
          title: 'Fondo con velo',
          variant: 'background',
          background_image_url: 'https://cdn.x.co/bg.jpg',
          overlay_opacity: 60,
          height: 'full',
          align: 'right',
        },
        blocks: [],
      });
      const bgHero = background.querySelector('[data-testid="app-page-hero"]') as HTMLElement;
      expect(bgHero.classList.contains('ap-hero--background')).toBeTrue();
      expect(bgHero.classList.contains('ap-hero--full')).toBeTrue();
      expect(bgHero.style.backgroundImage).toContain('https://cdn.x.co/bg.jpg');
      expect(background.querySelector('[data-testid="hero-image"]')).toBeNull();
      const overlay = background.querySelector('[data-testid="hero-overlay"]') as HTMLElement;
      expect(overlay).not.toBeNull();
      expect(overlay.style.backgroundColor).toBe('rgba(0, 0, 0, 0.6)');
    });

    it('gallery renders grid (columns + aspect), carousel (multiple images + controls) and mosaic', () => {
      const photos = ['https://cdn.x.co/1.jpg', 'https://cdn.x.co/2.jpg', 'https://cdn.x.co/3.jpg'];

      const grid = render({
        schema_version: 1,
        blocks: [
          {
            id: 'g1',
            type: 'gallery',
            enabled: true,
            props: { title: 'Grid', variant: 'grid', columns: 4, aspect_ratio: '16:9', image_urls: photos },
          },
        ],
      });
      const gridWrap = grid.querySelector('[data-testid="gallery-grid"]') as HTMLElement;
      expect(gridWrap.classList.contains('ap-gallery--grid')).toBeTrue();
      expect(gridWrap.classList.contains('md:grid-cols-4')).toBeTrue();
      const gridImgs = Array.from(gridWrap.querySelectorAll('img'));
      expect(gridImgs.length).toBe(3);
      expect(gridImgs[0].classList.contains('aspect-video')).toBeTrue();

      const carousel = render({
        schema_version: 1,
        blocks: [
          {
            id: 'g2',
            type: 'gallery',
            enabled: true,
            props: { title: 'Carrusel', variant: 'carousel', columns: 2, aspect_ratio: '4:3', image_urls: photos },
          },
        ],
      });
      const carouselWrap = carousel.querySelector('[data-testid="gallery-carousel"]') as HTMLElement;
      expect(carouselWrap.classList.contains('ap-gallery--carousel')).toBeTrue();
      expect(carousel.querySelectorAll('[data-testid="gallery-carousel-track"] img').length).toBe(3);
      expect(carousel.querySelector('[data-testid="gallery-carousel-prev"]')).not.toBeNull();
      expect(carousel.querySelector('[data-testid="gallery-carousel-next"]')).not.toBeNull();

      const mosaic = render({
        schema_version: 1,
        blocks: [
          {
            id: 'g3',
            type: 'gallery',
            enabled: true,
            props: { title: 'Mosaico', variant: 'mosaic', image_urls: photos },
          },
        ],
      });
      const mosaicWrap = mosaic.querySelector('[data-testid="gallery-mosaic"]') as HTMLElement;
      expect(mosaicWrap.classList.contains('ap-gallery--mosaic')).toBeTrue();
      const mosaicImgs = Array.from(mosaicWrap.querySelectorAll('img'));
      expect(mosaicImgs[0].classList.contains('md:row-span-2')).toBeTrue();
    });

    it('highlights renders cards, list and band variants with item image, icon and accent color', () => {
      const items = [
        { title: 'Envío', text: 'Rápido', image_url: 'https://cdn.x.co/h1.jpg', icon: 'truck' },
        { title: 'Garantía', text: '1 año', icon: 'shield-check' },
      ];

      for (const variant of ['cards', 'list', 'band'] as const) {
        const el = render(
          {
            schema_version: 1,
            blocks: [
              {
                id: `hl_${variant}`,
                type: 'highlights',
                enabled: true,
                props: { title: 'Destacados', variant, accent_color: '#10B981', items },
              },
            ],
          },
          { kind: 'service_page' },
        );
        const container = el.querySelector(`[data-highlights-variant="${variant}"]`) as HTMLElement;
        expect(container).withContext(variant).not.toBeNull();
        expect(container.classList.contains(`ap-highlights--${variant}`)).toBeTrue();
        expect(el.querySelector('[data-testid="highlight-image"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="highlight-icon"]')).not.toBeNull();
      }
    });

    it('applies common block appearance (background color/image+overlay, spacing, align) and cta image', () => {
      const el = render({
        schema_version: 1,
        blocks: [
          {
            id: 'faq1',
            type: 'faq',
            enabled: true,
            props: {
              title: 'Dudas',
              background_color: '#F1F5F9',
              background_image_url: 'https://cdn.x.co/section-bg.jpg',
              overlay_opacity: 50,
              spacing: 'spacious',
              align: 'center',
              items: [{ question: '¿Cómo funciona?', answer: 'Muy fácil.' }],
            },
          },
          {
            id: 'cta1',
            type: 'cta',
            enabled: true,
            props: { title: 'Actúa', button_label: 'Ir', image_url: 'https://cdn.x.co/cta.jpg' },
          },
        ],
      });

      const section = el.querySelector('section[data-block="faq"]') as HTMLElement;
      expect(section.classList.contains('ap-section--bg')).toBeTrue();
      expect(section.classList.contains('ap-spacing--spacious')).toBeTrue();
      expect(section.classList.contains('text-center')).toBeTrue();
      expect(section.style.backgroundColor).toBe('rgb(241, 245, 249)');
      expect(section.style.backgroundImage).toContain('https://cdn.x.co/section-bg.jpg');
      const overlay = section.querySelector('[data-testid="block-overlay"]') as HTMLElement;
      expect(overlay.style.backgroundColor).toBe('rgba(0, 0, 0, 0.5)');

      const ctaImg = el.querySelector('[data-testid="cta-image"]') as HTMLImageElement;
      expect(ctaImg).not.toBeNull();
      expect(ctaImg.src).toBe('https://cdn.x.co/cta.jpg');
    });

    it('leaves legacy documents without new tokens unchanged in structure and attributes', () => {
      const el = render(page());
      const hero = el.querySelector('[data-testid="app-page-hero"]') as HTMLElement;
      expect(hero.hasAttribute('data-hero-variant')).toBeFalse();
      expect(hero.hasAttribute('data-hero-height')).toBeFalse();
      expect(hero.hasAttribute('data-hero-align')).toBeFalse();
      expect(el.querySelector('[data-testid="hero-overlay"]')).toBeNull();
      expect(el.querySelector('[data-testid="block-overlay"]')).toBeNull();
      const firstSection = el.querySelector('section[data-block]') as HTMLElement;
      expect(firstSection.classList.contains('ap-section--bg')).toBeFalse();
      expect(firstSection.hasAttribute('data-spacing')).toBeFalse();
      expect(firstSection.hasAttribute('data-align')).toBeFalse();
    });

    it('inherits F7 image_overlay on legacy cover (.ap-cover-veil), background hero and blocks, with block overriding theme', () => {
      // Legacy cover without image_url: .ap-cover-veil reads color from --ap-image-overlay token (not hardcoded 0.4)
      const legacy = render(
        page({
          brand: { cover_url: 'https://cdn.test/cover.jpg' },
          theme: { image_overlay: 65 },
        }),
      );
      const coverVeil = legacy.querySelector<HTMLElement>('.ap-cover-veil')!;
      expect(coverVeil).not.toBeNull();
      expect(legacy.querySelector('[data-testid="hero-overlay"]')).toBeNull();
      expect(getComputedStyle(coverVeil).backgroundColor).toBe('rgba(0, 0, 0, 0.65)');

      // Background variant hero inherits theme.image_overlay when hero.overlay_opacity is absent
      const bgInherited = render({
        schema_version: 1,
        theme: { image_overlay: 65 },
        hero: {
          title: 'Hereda velo',
          variant: 'background',
          background_image_url: 'https://cdn.x.co/bg.jpg',
        },
        blocks: [
          {
            id: 'f1',
            type: 'faq',
            enabled: true,
            props: {
              title: 'FAQ',
              background_image_url: 'https://cdn.x.co/sec.jpg',
              items: [{ question: 'Q', answer: 'A' }],
            },
          },
        ],
      });
      expect(bgInherited.querySelector('.ap-cover-veil')).toBeNull();
      const heroOverlay = bgInherited.querySelector<HTMLElement>('[data-testid="hero-overlay"]')!;
      expect(heroOverlay.style.backgroundColor).toBe('rgba(0, 0, 0, 0.65)');
      const blockOverlay = bgInherited.querySelector<HTMLElement>('[data-testid="block-overlay"]')!;
      expect(blockOverlay.style.backgroundColor).toBe('rgba(0, 0, 0, 0.65)');

      // Explicit block overlay_opacity wins over theme.image_overlay
      const overridden = render({
        schema_version: 1,
        theme: { image_overlay: 65 },
        hero: {
          title: 'Gana bloque',
          variant: 'background',
          background_image_url: 'https://cdn.x.co/bg.jpg',
          overlay_opacity: 20,
        },
        blocks: [
          {
            id: 'f1',
            type: 'faq',
            enabled: true,
            props: {
              title: 'FAQ',
              background_image_url: 'https://cdn.x.co/sec.jpg',
              overlay_opacity: 25,
              items: [{ question: 'Q', answer: 'A' }],
            },
          },
        ],
      });
      expect(overridden.querySelector<HTMLElement>('[data-testid="hero-overlay"]')!.style.backgroundColor).toBe(
        'rgba(0, 0, 0, 0.2)',
      );
      expect(overridden.querySelector<HTMLElement>('[data-testid="block-overlay"]')!.style.backgroundColor).toBe(
        'rgba(0, 0, 0, 0.25)',
      );
    });

    it('unifies full hero height on var(--ap-hero-min-h, 100svh) with block height winning over theme.hero_height', () => {
      const md = () => window.matchMedia('(min-width: 768px)').matches;

      // .ap-hero--full reads --ap-hero-min-h (unified with theme.hero_height='full')
      const blockFull = render({
        schema_version: 1,
        hero: { title: 'Full bloque', height: 'full' },
        blocks: [],
      });
      blockFull.style.setProperty('--ap-hero-min-h', '620px');
      const blockFullHero = blockFull.querySelector<HTMLElement>('[data-testid="app-page-hero"]')!;
      expect(getComputedStyle(blockFullHero).display).toBe('flex');
      expect(getComputedStyle(blockFullHero).minHeight).toBe('620px');

      // theme.hero_height='full' inherited when hero.height is absent
      const themeFull = render({
        schema_version: 1,
        theme: { hero_height: 'full' },
        hero: { title: 'Full tema' },
        blocks: [],
      });
      themeFull.style.setProperty('--ap-hero-min-h', '620px');
      const themeFullHero = themeFull.querySelector<HTMLElement>('[data-testid="app-page-hero"]')!;
      expect(getComputedStyle(themeFullHero).display).toBe('flex');
      expect(getComputedStyle(themeFullHero).minHeight).toBe('620px');

      // theme.hero_height='compact' inherited when hero.height is absent
      const themeCompact = render({
        schema_version: 1,
        theme: { hero_height: 'compact' },
        hero: { title: 'Compact tema' },
        blocks: [],
      });
      const themeCompactInner = themeCompact.querySelector<HTMLElement>('.ap-hero-inner')!;
      expect(getComputedStyle(themeCompactInner).paddingTop).toBe(md() ? '40px' : '32px');

      // Precedence: block hero.height='compact' overrides theme.hero_height='full'
      const blockCompactWins = render({
        schema_version: 1,
        theme: { hero_height: 'full' },
        hero: { title: 'Compact gana', height: 'compact' },
        blocks: [],
      });
      blockCompactWins.style.setProperty('--ap-hero-min-h', '620px');
      const compactWinsHero = blockCompactWins.querySelector<HTMLElement>('[data-testid="app-page-hero"]')!;
      expect(getComputedStyle(compactWinsHero).minHeight).toBe('0px');
      expect(getComputedStyle(blockCompactWins.querySelector<HTMLElement>('.ap-hero-inner')!).paddingTop).toBe(
        md() ? '40px' : '32px',
      );

      // Precedence: block hero.height='full' overrides theme.hero_height='compact'
      const blockFullWins = render({
        schema_version: 1,
        theme: { hero_height: 'compact' },
        hero: { title: 'Full gana', height: 'full' },
        blocks: [],
      });
      blockFullWins.style.setProperty('--ap-hero-min-h', '620px');
      const fullWinsHero = blockFullWins.querySelector<HTMLElement>('[data-testid="app-page-hero"]')!;
      expect(getComputedStyle(fullWinsHero).display).toBe('flex');
      expect(getComputedStyle(fullWinsHero).minHeight).toBe('620px');
    });

    it('applies readable light text on dark/image section backgrounds and dark text on light section backgrounds', () => {
      // Dark background_color & background_image_url -> ap-section--on-dark + white text across p, dl, faq, testimonials
      const darkDoc = render({
        schema_version: 1,
        blocks: [
          {
            id: 'specs_dark',
            type: 'specifications',
            enabled: true,
            props: {
              title: 'Ficha',
              background_color: '#0F172A',
              items: [{ label: 'Peso', value: '200 g' }],
            },
          },
          {
            id: 'faq_img',
            type: 'faq',
            enabled: true,
            props: {
              title: 'Preguntas',
              background_image_url: 'https://cdn.x.co/bg.jpg',
              items: [{ question: '¿Envían?', answer: 'Sí, a todo el país.' }],
            },
          },
          {
            id: 'test_dark',
            type: 'testimonials',
            enabled: true,
            props: {
              title: 'Opiniones',
              background_color: '#1E293B',
              items: [{ name: 'Ana', city: 'Cali', quote: 'Excelente', rating: 5 }],
            },
          },
        ],
      });

      const specsDark = darkDoc.querySelector<HTMLElement>('section[data-block="specifications"]')!;
      expect(specsDark.classList.contains('ap-section--on-dark')).toBeTrue();
      expect(specsDark.classList.contains('ap-section--on-light')).toBeFalse();
      expect(getComputedStyle(specsDark.querySelector('h2')!).color).toBe('rgb(255, 255, 255)');
      expect(getComputedStyle(specsDark.querySelector('dt')!).color).toBe('rgb(255, 255, 255)');
      expect(getComputedStyle(specsDark.querySelector('dd')!).color).toBe('rgb(255, 255, 255)');

      const faqImg = darkDoc.querySelector<HTMLElement>('section[data-block="faq"]')!;
      expect(faqImg.classList.contains('ap-section--on-dark')).toBeTrue();
      expect(getComputedStyle(faqImg.querySelector('summary')!).color).toBe('rgb(255, 255, 255)');
      expect(getComputedStyle(faqImg.querySelector('p')!).color).toBe('rgb(255, 255, 255)');

      const testDark = darkDoc.querySelector<HTMLElement>('section[data-block="testimonials"]')!;
      expect(testDark.classList.contains('ap-section--on-dark')).toBeTrue();
      expect(getComputedStyle(testDark.querySelector('blockquote')!).color).toBe('rgb(255, 255, 255)');
      expect(getComputedStyle(testDark.querySelector('figcaption')!).color).toBe('rgb(255, 255, 255)');

      // Light background_color (even inside a dark theme) -> ap-section--on-light + dark text
      const lightOnDarkTheme = render({
        schema_version: 1,
        theme: { surface_color: '#0F172A', text_color: '#F1F5F9' },
        blocks: [
          {
            id: 'specs_light',
            type: 'specifications',
            enabled: true,
            props: {
              title: 'Ficha clara',
              background_color: '#F8FAFC',
              items: [{ label: 'Material', value: 'Algodón' }],
            },
          },
          {
            id: 'faq_light',
            type: 'faq',
            enabled: true,
            props: {
              title: 'FAQ claro',
              background_color: '#FFFFFF',
              items: [{ question: '¿Garantía?', answer: '1 año.' }],
            },
          },
          {
            id: 'test_light',
            type: 'testimonials',
            enabled: true,
            props: {
              title: 'Testimonios claros',
              background_color: '#FEF9C3',
              items: [{ name: 'Luis', city: 'Bogotá', quote: 'Muy bueno', rating: 5 }],
            },
          },
        ],
      });

      const specsLight = lightOnDarkTheme.querySelector<HTMLElement>('section[data-block="specifications"]')!;
      expect(specsLight.classList.contains('ap-section--on-light')).toBeTrue();
      expect(specsLight.classList.contains('ap-section--on-dark')).toBeFalse();
      expect(getComputedStyle(specsLight.querySelector('h2')!).color).toBe('rgb(17, 24, 39)');
      expect(getComputedStyle(specsLight.querySelector('dt')!).color).toBe('rgb(17, 24, 39)');
      expect(getComputedStyle(specsLight.querySelector('dd')!).color).toBe('rgb(17, 24, 39)');

      const faqLight = lightOnDarkTheme.querySelector<HTMLElement>('section[data-block="faq"]')!;
      expect(faqLight.classList.contains('ap-section--on-light')).toBeTrue();
      expect(getComputedStyle(faqLight.querySelector('summary')!).color).toBe('rgb(17, 24, 39)');
      expect(getComputedStyle(faqLight.querySelector('p')!).color).toBe('rgb(17, 24, 39)');

      const testLight = lightOnDarkTheme.querySelector<HTMLElement>('section[data-block="testimonials"]')!;
      expect(testLight.classList.contains('ap-section--on-light')).toBeTrue();
      expect(getComputedStyle(testLight.querySelector('blockquote')!).color).toBe('rgb(17, 24, 39)');
      expect(getComputedStyle(testLight.querySelector('figcaption')!).color).toBe('rgb(17, 24, 39)');
    });

    it('escapes quotes, parentheses and newlines in cssBgUrl and rejects javascript:/data: in background_image_url', () => {
      const escaped = cssBgUrl('https://cdn.x.co/a"b\'c(d)\ne\rf.jpg');
      expect(escaped).toBe('url("https://cdn.x.co/a%22b%27c%28d%29%0ae%0df.jpg")');
      expect(cssBgUrl('javascript:alert(1)')).toBeNull();
      expect(cssBgUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull();

      for (const badUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA']) {
        const el = render({
          schema_version: 1,
          hero: { title: 'Seguro', variant: 'background', background_image_url: badUrl },
          blocks: [
            {
              id: 'faq_bad',
              type: 'faq',
              enabled: true,
              props: { title: 'FAQ', background_image_url: badUrl, items: [{ question: 'Q', answer: 'A' }] },
            },
          ],
        });
        const hero = el.querySelector<HTMLElement>('[data-testid="app-page-hero"]')!;
        expect(hero.style.backgroundImage).toBe('');
        expect(el.querySelector('[data-testid="hero-overlay"]')).toBeNull();
        const section = el.querySelector<HTMLElement>('section[data-block="faq"]')!;
        expect(section.style.backgroundImage).toBe('');
        expect(section.querySelector('[data-testid="block-overlay"]')).toBeNull();
      }
    });
  });
});
