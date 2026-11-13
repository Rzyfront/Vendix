import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { of } from 'rxjs';

import { EnvironmentSwitchService } from './environment-switch.service';
import { AuthFacade } from '../store/auth/auth.facade';
import { AuthService } from './auth.service';
import { AppConfigService } from './app-config.service';
import { RouteManagerService } from './route-manager.service';

/**
 * QUI-981: el cambio de entorno no debe volver a montar el <router-outlet>
 * mientras el árbol de rutas activo sigue siendo el del entorno anterior. Si lo
 * hace, el layout/página de organización se re-crea con el token de tienda y
 * llama /organization/* (403), y viceversa.
 */
describe('EnvironmentSwitchService (QUI-981)', () => {
  let service: EnvironmentSwitchService;
  let log: string[];
  let restoreAuthState: jasmine.Spy;
  let navigateResult: boolean;

  const storeConfig = { routes: [{ path: 'admin' }] } as any;

  beforeEach(() => {
    log = [];
    navigateResult = true;
    restoreAuthState = jasmine
      .createSpy('restoreAuthState')
      .and.callFake(() => log.push('restoreAuthState'));
    spyOn(localStorage, 'setItem');

    TestBed.configureTestingModule({
      providers: [
        EnvironmentSwitchService,
        { provide: HttpClient, useValue: {} },
        { provide: Location, useValue: {} },
        {
          provide: AuthFacade,
          useValue: { restoreAuthState, isAuthenticated: () => true },
        },
        { provide: AuthService, useValue: { getToken: () => 'org-token' } },
        {
          provide: AppConfigService,
          useValue: {
            setupConfig: async () => ({}),
            updateEnvironmentForUser: (_: unknown, env: string) => {
              log.push(`config:${env}`);
              return storeConfig;
            },
          },
        },
        {
          provide: RouteManagerService,
          useValue: {
            suspendOutlet: () => log.push('suspendOutlet'),
            replaceRoutes: (config: unknown) =>
              log.push(config === storeConfig ? 'replaceRoutes' : 'replaceRoutes:?'),
            resumeOutlet: () => log.push('resumeOutlet'),
            configureDynamicRoutes: () => log.push('configureDynamicRoutes'),
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: async (commands: string[]) => {
              log.push(`navigate:${commands.join('/')}`);
              return navigateResult;
            },
          },
        },
      ],
    });
    service = TestBed.inject(EnvironmentSwitchService);
  });

  function switchResponds(response: unknown): void {
    spyOn(service, 'switchToStore').and.returnValue(of(response as any));
  }

  const okResponse = {
    success: true,
    data: {
      user: { id: 1 },
      access_token: 'store-token',
      refresh_token: 'refresh',
      permissions: [],
      roles: [],
      updated_environment: 'STORE_ADMIN',
    },
  };

  it('keeps the outlet unmounted until the router is on the new environment routes', async () => {
    switchResponds(okResponse);

    await expectAsync(
      service.performEnvironmentSwitch('STORE_ADMIN', 'tienda-demo'),
    ).toBeResolvedTo(true);

    expect(log).toEqual([
      'suspendOutlet',
      'restoreAuthState',
      'config:STORE_ADMIN',
      'replaceRoutes',
      'navigate:/admin/dashboard',
      'resumeOutlet',
    ]);
  });

  it('remounts the outlet when the switch fails after it was suspended', async () => {
    switchResponds(okResponse);
    restoreAuthState.and.throwError('boom');

    await expectAsync(
      service.performEnvironmentSwitch('STORE_ADMIN', 'tienda-demo'),
    ).toBeRejected();

    expect(log).toEqual(['suspendOutlet', 'resumeOutlet']);
  });

  it('does not touch the outlet or the session when the backend rejects the switch', async () => {
    switchResponds({ success: false, message: 'Forbidden' });

    await expectAsync(
      service.performEnvironmentSwitch('STORE_ADMIN', 'tienda-demo'),
    ).toBeRejected();

    expect(log).toEqual([]);
    expect(restoreAuthState).not.toHaveBeenCalled();
  });
});
