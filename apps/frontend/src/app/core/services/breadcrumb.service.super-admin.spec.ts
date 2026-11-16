import { TestBed } from '@angular/core/testing';
import { Router, NavigationEnd, Event } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { BreadcrumbService } from './breadcrumb.service';

/**
 * Super Admin "Sistema" pages: the header and the browser tab read the
 * breadcrumb from this service, so a page missing from its table shows the
 * "Panel Principal" fallback. Kept apart from `breadcrumb.service.spec.ts`,
 * which is not in the CI Karma list.
 */
describe('BreadcrumbService · Super Admin system pages', () => {
  let service: BreadcrumbService;
  let titleSetSpy: jasmine.Spy;
  let routerEvents$: Subject<Event>;

  beforeEach(() => {
    routerEvents$ = new Subject<Event>();
    const routerStub: Partial<Router> = {
      url: '/dashboard',
      events: routerEvents$.asObservable(),
    };
    titleSetSpy = spyOn(Title.prototype, 'setTitle');

    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: routerStub }, BreadcrumbService],
    });

    service = TestBed.inject(BreadcrumbService);
  });

  for (const [url, label] of [
    ['/super-admin/system/ai-engine', 'AI Engine'],
    ['/super-admin/system/integrations/meta-whatsapp', 'Meta / WhatsApp'],
    ['/super-admin/system/integrations/messaging-prices', 'Precios de mensajería'],
    ['/super-admin/system/templates', 'Plantillas del sistema'],
    ['/super-admin/system/backups', 'Copias de Seguridad'],
    ['/super-admin/system/payroll-defaults', 'Parámetros de Nómina'],
    ['/super-admin/system/settings-sync', 'Sincronización de Settings'],
    ['/super-admin/system/notification-sounds', 'Sonidos de notificación'],
    ['/super-admin/legal-documents', 'Documentos Legales'],
    ['/super-admin/settings/shipping', 'Envíos del Sistema'],
  ]) {
    it(`names ${url} "Super Admin > ${label}" instead of "Panel Principal"`, () => {
      titleSetSpy.calls.reset();
      routerEvents$.next(new NavigationEnd(1, url, url));
      TestBed.tick();

      const crumb = service.breadcrumb();
      expect(crumb.title).toBe(label);
      expect(crumb.current.label).toBe(label);
      expect(crumb.parent?.label).toBe('Super Admin');
      expect(titleSetSpy).toHaveBeenCalledWith(`Super Admin > ${label} | Vendix`);
    });
  }

  it('keeps /admin/documents/templates/new under "Documentos > Plantillas", not Super Admin', () => {
    const url = '/admin/documents/templates/new';
    routerEvents$.next(new NavigationEnd(1, url, url));

    const crumb = service.breadcrumb();
    const labels = (crumb.parents ?? []).map((p) => p.label);
    expect(crumb.current.label).toBe('Nueva plantilla');
    expect(crumb.parent?.label).toBe('Plantillas');
    expect(labels).toContain('Documentos');
    expect(labels).not.toContain('Super Admin');
  });

  it('keeps the existing /super-admin/domains entry', () => {
    const url = '/super-admin/domains';
    routerEvents$.next(new NavigationEnd(1, url, url));

    const crumb = service.breadcrumb();
    expect(crumb.current.label).toBe('Dominios');
    expect(crumb.parent?.label).toBe('Super Admin');
  });
});
