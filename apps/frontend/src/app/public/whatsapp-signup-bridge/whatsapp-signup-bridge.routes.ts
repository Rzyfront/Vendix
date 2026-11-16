import type { Routes } from '@angular/router';
import type { DomainConfig } from '../../core/models/domain-config.interface';
import { WHATSAPP_SIGNUP_BRIDGE_PATH } from '../../private/modules/store/integrations/channels/whatsapp-signup-bridge';

/**
 * Bridge for the WhatsApp Embedded Signup. Meta only answers on the fixed host
 * (vendix.online), so panels on other hosts open this page to connect. No
 * session: it hands the result back to the panel that opened it.
 */
const whatsappSignupBridgeRoute: Routes[number] = {
  path: WHATSAPP_SIGNUP_BRIDGE_PATH.slice(1),
  loadComponent: () =>
    import('./whatsapp-signup-bridge.component').then(
      (c) => c.WhatsappSignupBridgeComponent,
    ),
};

/**
 * Mounts the bridge on the main Vendix domain whatever the app_type. An owner
 * with an admin session cached on vendix.online gets the admin routes instead
 * of the landing ones, and the bridge must still be reachable there.
 */
export function withWhatsappSignupBridge(
  routes: Routes,
  domainConfig: Pick<DomainConfig, 'isMainVendixDomain'> | undefined,
): Routes {
  return domainConfig?.isMainVendixDomain
    ? [whatsappSignupBridgeRoute, ...routes]
    : routes;
}
