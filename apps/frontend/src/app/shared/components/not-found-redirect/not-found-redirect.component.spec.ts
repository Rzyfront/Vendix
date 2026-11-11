import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { Navigation, Router, provideRouter } from '@angular/router';
import { NotFoundRedirectComponent, isPrivatePanelPath } from './not-found-redirect.component';
import { ToastService } from '../toast/toast.service';
import { SessionService } from '../../../core/services/session.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { AppEnvironment } from '../../../core/models/domain-config.interface';

describe('NotFoundRedirectComponent (SEO-TECH-03)', () => {
  let toast: jasmine.SpyObj<ToastService>;
  let session: jasmine.SpyObj<SessionService>;
  let authenticated: boolean;
  let router: Router;
  let canonical: HTMLLinkElement;

  beforeEach(() => {
    authenticated = false;
    toast = jasmine.createSpyObj('ToastService', ['warning']);
    session = jasmine.createSpyObj('SessionService', ['isTerminating', 'shouldSuppressNotifications']);
    session.isTerminating.and.returnValue(false);
    session.shouldSuppressNotifications.and.returnValue(false);

    TestBed.configureTestingModule({
      imports: [NotFoundRedirectComponent],
      providers: [
        provideRouter([]),
        { provide: ToastService, useValue: toast },
        { provide: SessionService, useValue: session },
        {
          provide: AuthFacade,
          useValue: {
            isAuthenticated: () => authenticated,
            selectedAppType: () => AppEnvironment.STORE_ADMIN,
          },
        },
      ],
    });

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);

    const doc = TestBed.inject(DOCUMENT);
    canonical = doc.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = 'https://vendix.online/';
    doc.head.appendChild(canonical);
    TestBed.inject(Meta).updateTag({ name: 'robots', content: 'index, follow' });
    TestBed.inject(Title).setTitle('Vendix');
  });

  afterEach(() => canonical.remove());

  it('al visitante le muestra la página 404 con noindex, sin canonical y sin redirigir', () => {
    const fixture = TestBed.createComponent(NotFoundRedirectComponent);
    fixture.detectChanges();

    const h1 = fixture.nativeElement.querySelector('h1') as HTMLElement;
    expect(h1.textContent).toContain('Página no encontrada');
    expect(TestBed.inject(Meta).getTag('name="robots"')?.content).toBe('noindex, follow');
    expect(canonical.hasAttribute('href')).toBeFalse();
    expect(TestBed.inject(Title).getTitle()).toBe('Página no encontrada');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('restaura robots, canonical y título al salir de la vista 404', () => {
    const fixture = TestBed.createComponent(NotFoundRedirectComponent);
    fixture.detectChanges();
    fixture.destroy();

    expect(TestBed.inject(Meta).getTag('name="robots"')?.content).toBe('index, follow');
    expect(canonical.getAttribute('href')).toBe('https://vendix.online/');
    expect(TestBed.inject(Title).getTitle()).toBe('Vendix');
  });

  it('al usuario autenticado lo sigue redirigiendo al inicio de su app con aviso', () => {
    authenticated = true;
    const fixture = TestBed.createComponent(NotFoundRedirectComponent);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/admin/dashboard']);
    expect(toast.warning).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
  });

  function openingPath(path: string): void {
    spyOn(router, 'getCurrentNavigation').and.returnValue({
      finalUrl: router.parseUrl(path),
    } as unknown as Navigation);
  }

  it('con la sesión vencida en una URL del panel lleva al login, sin pantalla 404 ni aviso', () => {
    openingPath('/admin/settings/general/venta?tab=1');
    const fixture = TestBed.createComponent(NotFoundRedirectComponent);
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/login', { replaceUrl: true });
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(TestBed.inject(Title).getTitle()).toBe('Vendix');
  });

  it('una ruta pública desconocida sigue mostrando la 404 para el visitante', () => {
    openingPath('/ruta-que-no-existe');
    const fixture = TestBed.createComponent(NotFoundRedirectComponent);
    fixture.detectChanges();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect((fixture.nativeElement.querySelector('h1') as HTMLElement).textContent).toContain('Página no encontrada');
  });

  it('reconoce los paneles privados por segmento completo', () => {
    expect(isPrivatePanelPath('/admin')).toBeTrue();
    expect(isPrivatePanelPath('/admin/dashboard')).toBeTrue();
    expect(isPrivatePanelPath('/super-admin/tiendas')).toBeTrue();
    expect(isPrivatePanelPath('/repartos/pool')).toBeTrue();
    expect(isPrivatePanelPath('/onboarding')).toBeTrue();
    expect(isPrivatePanelPath('/administrador')).toBeFalse();
    expect(isPrivatePanelPath('/catalog')).toBeFalse();
    expect(isPrivatePanelPath('/')).toBeFalse();
  });
});
