import type { Routes } from '@angular/router';
import { WHATSAPP_SIGNUP_BRIDGE_PATH } from '../../private/modules/store/integrations/channels/whatsapp-signup-bridge';
import { withWhatsappSignupBridge } from './whatsapp-signup-bridge.routes';

describe('withWhatsappSignupBridge', () => {
  const adminRoutes: Routes = [
    { path: 'admin', children: [] },
    { path: '**', redirectTo: '' },
  ];

  it('mounts the bridge first on the main Vendix domain, even when a cached admin session switched the environment', () => {
    const routes = withWhatsappSignupBridge(adminRoutes, {
      isMainVendixDomain: true,
    });

    expect(routes.length).toBe(adminRoutes.length + 1);
    expect('/' + routes[0].path).toBe(WHATSAPP_SIGNUP_BRIDGE_PATH);
    expect(typeof routes[0].loadComponent).toBe('function');
    expect(routes[0].canActivate).toBeUndefined();
    expect(routes.slice(1)).toEqual(adminRoutes);
  });

  it('leaves the routes of store and custom domains unchanged', () => {
    const routes = withWhatsappSignupBridge(adminRoutes, {
      isMainVendixDomain: false,
    });

    expect(routes).toEqual(adminRoutes);
  });

  it('leaves the routes unchanged when there is no domain config', () => {
    expect(withWhatsappSignupBridge(adminRoutes, undefined)).toEqual(
      adminRoutes,
    );
  });
});
