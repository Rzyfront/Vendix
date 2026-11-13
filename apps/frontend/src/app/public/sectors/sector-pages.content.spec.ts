import { SECTOR_PAGE_PATHS } from './sector-pages.config';
import { SECTOR_PAGES, sectorPageByPath, sectorWhatsappUrl } from './sector-pages.content';

/** Reglas del registro editorial (SEO-TECH-08) y del claims-register para la plantilla de sector. */
describe('SECTOR_PAGES (SEO-TECH-08 / SEO-OPS-17)', () => {
  const allTexts = (): string[] =>
    SECTOR_PAGES.flatMap((p) => [
      p.h1,
      p.intro,
      p.metadata.title,
      p.metadata.description,
      ...p.steps.map((s) => s.text),
      ...p.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.bullets ?? [])].map((t) => t.text)),
      ...p.limits.map((l) => l.text),
      ...p.faqs.map((f) => f.text),
    ]);

  it('mantiene cada página en noindex y sin canonical hasta la firma (G4)', () => {
    for (const page of SECTOR_PAGES) {
      expect(page.metadata.robots).withContext(page.path).toBe('noindex, follow');
      expect(page.metadata.canonicalPath).withContext(page.path).toBeNull();
    }
  });

  it('mantiene la config de rutas alineada con el contenido', () => {
    expect([...SECTOR_PAGE_PATHS].sort()).toEqual(SECTOR_PAGES.map((p) => p.path).sort());
  });

  it('no repite rutas y usa minúsculas y guiones', () => {
    const paths = SECTOR_PAGES.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/);
  });

  it('respalda cada afirmación con evidencia', () => {
    for (const page of SECTOR_PAGES) {
      const evidenced = [
        ...page.steps,
        ...page.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.bullets ?? [])]),
        ...page.limits,
        ...page.faqs,
      ];
      for (const item of evidenced) expect(item.evidence.trim().length).withContext(item.text).toBeGreaterThan(0);
    }
  });

  it('no usa claims retirados ni sin respaldo', () => {
    const banned = [/offline|sin conexi[oó]n funciona/i, /tiempo real/i, /\bFIFO\b/, /habilitad[oa] (por la )?DIAN/i, /ilimitad/i, /migraci[oó]n gratis/i];
    for (const text of allTexts()) {
      for (const rule of banned) expect(rule.test(text)).withContext(text).toBeFalse();
    }
  });

  it('arma el enlace de WhatsApp sin datos personales', () => {
    const page = sectorPageByPath('sectores/restaurantes');
    expect(page).not.toBeNull();
    const url = sectorWhatsappUrl(page!);
    expect(url.startsWith('https://wa.me/573234668500?text=')).toBeTrue();
    expect(decodeURIComponent(url.split('text=')[1])).not.toMatch(/@|\d{7,}/);
    expect(sectorPageByPath('sectores/no-existe')).toBeNull();
  });

  it('SEO-OPS-15: la página de POS solo afirma lo comprobado y no promete días de prueba', () => {
    const pos = sectorPageByPath('soluciones/software-pos');
    expect(pos).not.toBeNull();
    expect(pos!.stepsHeading).toBeTruthy();
    const text = [pos!.intro, ...pos!.steps.map((s) => s.text), ...pos!.faqs.map((f) => f.text)].join(' ');
    // Fuera hasta tener demo: cobro repartido en varios medios, devoluciones, lector de código de barras.
    expect(/varios medios|cinco medios|devoluci|lector/i.test(text)).toBeFalse();
    expect(/\d+ d[ií]as/i.test(text)).toBeFalse();
  });
});

