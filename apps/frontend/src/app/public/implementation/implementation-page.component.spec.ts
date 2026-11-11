import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ImplementationPageComponent, IMPLEMENTATION_WHATSAPP_URL } from './implementation-page.component';
import { MARKETING_PAGES } from '../marketing-page-metadata';

/** SEO-OPS-19: la página no promete plazos, migración gratuita ni visitas, y no se indexa todavía. */
describe('ImplementationPageComponent (SEO-OPS-19)', () => {
  let fixture: ComponentFixture<ImplementationPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationPageComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([{ path: '**', children: [] }])],
    }).compileComponents();
    fixture = TestBed.createComponent(ImplementationPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('renders the seven stages, the responsibilities table and the FAQ', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Cómo empezamos con Vendix');
    expect(el.querySelectorAll('#implementation-content section').length).toBeGreaterThanOrEqual(6);
    expect(el.querySelectorAll('.implementation-table tbody tr').length).toBe(6);
    expect(el.querySelectorAll('.implementation-faq h3').length).toBe(7);
  });

  it('does not promise a fixed setup time, free migration or on-site visits', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toMatch(/en \d+ (minutos|horas|días) (tienes|tendrás) tu tienda/i);
    expect(text).not.toMatch(/migraci[oó]n gratis|migramos tus datos/i);
    expect(text).toContain('Un tiempo fijo de instalación o de puesta en marcha.');
    expect(text).toContain('Visitas presenciales o capacitación en sitio.');
  });

  it('stays noindex without canonical until it is approved', () => {
    expect(MARKETING_PAGES.implementation.robots).toBe('noindex, follow');
    expect(MARKETING_PAGES.implementation.canonicalPath).toBeNull();
  });

  it('sends the WhatsApp CTA without personal data', () => {
    expect(IMPLEMENTATION_WHATSAPP_URL.startsWith('https://wa.me/573234668500?text=')).toBeTrue();
    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a[href^="https://wa.me/"]'));
    expect(links.length).toBe(2);
    expect(links.every((a) => a.getAttribute('rel') === 'noopener')).toBeTrue();
  });
});
