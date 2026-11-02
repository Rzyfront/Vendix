import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ConfigFacade } from '../store/config/config.facade';
import { LandingOnlyGuard } from './landing-only.guard';

describe('LandingOnlyGuard', () => {
  let environment: string | undefined;

  const canOpen = async (url = '/auth/login') => {
    const guard = TestBed.inject(LandingOnlyGuard);
    return firstValueFrom(
      guard.canActivate({} as never, { url } as RouterStateSnapshot),
    );
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ConfigFacade,
          useValue: {
            getCurrentConfig: () => ({ domainConfig: { environment } }),
          },
        },
      ],
    });
  });

  it('abre el login en el inicio de tienda (STORE_HOME, apps-module Fase 5)', async () => {
    environment = 'STORE_HOME';
    expect(await canOpen()).toBeTrue();
  });

  it('sigue abriendo el login en los contextos landing de hoy', async () => {
    for (const env of ['VENDIX_LANDING', 'ORG_LANDING', 'STORE_LANDING']) {
      environment = env;
      expect(await canOpen()).withContext(env).toBeTrue();
    }
  });

  it('sigue llevando a / desde el admin y la tienda en línea', async () => {
    const router = TestBed.inject(Router);
    for (const env of ['STORE_ADMIN', 'STORE_ECOMMERCE', 'STORE_PRODUCT_PAGE']) {
      environment = env;
      const result = await canOpen();
      expect(result instanceof UrlTree).withContext(env).toBeTrue();
      expect(router.serializeUrl(result as UrlTree)).withContext(env).toBe('/');
    }
  });
});
