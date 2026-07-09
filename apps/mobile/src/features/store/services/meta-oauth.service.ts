/**
 * MetaOAuthService — flujo OAuth de WhatsApp Business para Social Sales.
 *
 * Web usa `window.FB.login()` con Facebook SDK (popup OAuth).
 * Mobile no tiene acceso a FB SDK ni popup browsers, así que usamos el
 * OAuth Authorization Code Flow con custom URL scheme `vendix://`.
 *
 * Flujo móvil:
 *  1. buildMetaOAuthUrl(readiness) → construye URL de autorización Meta
 *  2. openMetaLogin(readiness) → abre navegador del sistema con URL de Meta
 *  3. El usuario autoriza en el navegador
 *  4. Meta redirige a `vendix://social-sales/oauth?code=XXX&waba_id=YYY&phone_number_id=ZZZ`
 *  5. Linking.getInitialURL() captura el redirect y completa el flujo
 *
 * El `code` + `waba_id` + `phone_number_id` se envían al backend que intercambia
 * el code por access_token y persiste el canal.
 *
 * Backend: POST /store/social-sales/channels/whatsapp/embedded-signup/complete
 *
 * NOTA: el custom URL scheme `vendix://` debe estar registrado en app.json y
 * en la Meta App Console como redirect_uri autorizado.
 */

import * as Linking from 'expo-linking';

import type { MetaReadiness } from '@/features/store/types/social-sales.types';

// El custom URL scheme de la app (definido en app.json "scheme": "vendix")
const APP_SCHEME = 'vendix';
const OAUTH_PATH = 'social-sales/oauth';
const OAUTH_TIMEOUT_MS = 45_000;

// Estado global del OAuth activo — para el timeout de 45s
let _oauthStartedAt: number | null = null;
let _oauthTimeoutId: ReturnType<typeof setTimeout> | null = null;

export interface MetaOAuthResult {
  code: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number?: string;
}

/**
 * Construye la URL de autorización OAuth de Meta para WhatsApp Embedded Signup.
 * Equivalente móvil del `FB.login({ config_id })` en web.
 *
 * El redirect_uri recibe los params: code, waba_id, phone_number_id, etc.
 */
export function buildMetaOAuthUrl(readiness: MetaReadiness): string {
  const graphVersion = readiness.graph_version ?? 'v22.0';
  const appId = readiness.app_id ?? '';
  const configId = readiness.whatsapp_config_id ?? '';
  const redirectUri = encodeURIComponent(`${APP_SCHEME}://${OAUTH_PATH}`);
  const state = generateState();
  const extras = encodeURIComponent(
    JSON.stringify({ setup: {}, featureType: 'whatsapp_embedded_signup' }),
  );
  const scope = encodeURIComponent(
    'whatsapp_business_management,whatsapp_business_messaging',
  );

  return (
    `https://www.facebook.com/${graphVersion}/dialog/oauth` +
    `?client_id=${appId}` +
    `&redirect_uri=${redirectUri}` +
    `&config_id=${configId}` +
    `&state=${state}` +
    `&response_type=code%20token` +
    `&scope=${scope}` +
    `&extras=${extras}`
  );
}

/**
 * Genera un state aleatorio para CSRF protection en OAuth.
 */
function generateState(length = 24): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const result: string[] = [];
  for (let i = 0; i < length; i++) {
    result.push(chars[Math.floor(Math.random() * chars.length)]);
  }
  return result.join('');
}

/**
 * Abre la URL de OAuth en el navegador del sistema y retorna true si fue exitoso.
 * El redirect se captura vía Linking.getInitialURL/getWebUrl después de que el usuario
 * regresa a la app.
 *
 * Si el navegador se abre pero el usuario no completa el flujo en 45s,
 * el estado OAuth se limpia y el listener不会有任何反应.
 *
 * Uso:
 * ```
 * const url = buildMetaOAuthUrl(readiness);
 * const ok = await openMetaLogin(url);
 * if (ok) { /* el redirect se maneja en el Linking listener *\/ }
 * ```
 */
export async function openMetaLogin(url: string): Promise<boolean> {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      console.warn('[MetaOAuth] Cannot open URL:', url);
      return false;
    }
    await Linking.openURL(url);
    // Iniciar timeout de 45s — si no hay callback, se limpia el estado
    _oauthStartedAt = Date.now();
    _oauthTimeoutId = setTimeout(() => {
      _oauthStartedAt = null;
      _oauthTimeoutId = null;
    }, OAUTH_TIMEOUT_MS);
    return true;
  } catch (err) {
    console.error('[MetaOAuth] openURL failed:', err);
    return false;
  }
}

/**
 * Intenta capturar el callback de OAuth inmediatamente al regresar a la app.
 * Se llama DESPUÉS de openMetaLogin() para procesar el deep link de Meta.
 *
 * Retorna null si no hay URL de callback o no tiene los parámetros esperados.
 */
export async function captureOAuthCallback(): Promise<MetaOAuthResult | null> {
  try {
    const url = await Linking.getInitialURL();
    if (!url) return null;
    return parseOAuthResult(url);
  } catch {
    return null;
  }
}

/**
 * Registra un listener para procesar callbacks OAuth asíncronos (para cuando la app
 * ya está en background y recibe el redirect).
 * Retorna unsubscribe function.
 *
 * Limpia el timeout de 45s cuando se recibe un callback válido.
 */
export function addOAuthListener(
  handler: (result: MetaOAuthResult) => void,
): () => void {
  const listener = ({ url }: { url: string }) => {
    const parsed = parseOAuthResult(url);
    if (parsed) {
      // Limpiar timeout al recibir callback válido
      if (_oauthTimeoutId !== null) {
        clearTimeout(_oauthTimeoutId);
        _oauthTimeoutId = null;
        _oauthStartedAt = null;
      }
      handler(parsed);
    }
  };
  const subscription = Linking.addEventListener('url', listener);
  return () => subscription.remove();
}

/**
 * Valida que el URL de callback proviene del flujo OAuth de Meta.
 * Verifica:
 * 1. Scheme es `vendix://`
 * 2. Host contiene `social-sales` y path `oauth`
 * 3. Params requeridos: code, waba_id, phone_number_id
 *
 * URL esperado: `vendix://social-sales/oauth?code=XXX&waba_id=YYY&phone_number_id=ZZZ&...`
 *
 * Retorna null si no pasa la validación.
 */
export function parseOAuthResult(url: string): MetaOAuthResult | null {
  try {
    const u = new URL(url);
    if (!u.protocol.startsWith(APP_SCHEME)) return null;

    // Validar que el path es exactamente social-sales/oauth
    // Previene inyección de callbacks desde otros deep links
    const path = u.hostname + u.pathname; // "social-sales/oauth"
    if (!path.startsWith('social-sales') || !path.includes('/oauth')) return null;

    const code = u.searchParams.get('code');
    const wabaId = u.searchParams.get('waba_id');
    const phoneNumberId = u.searchParams.get('phone_number_id');
    if (!code || !wabaId || !phoneNumberId) return null;
    return {
      code,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      display_phone_number: u.searchParams.get('display_phone_number') ?? undefined,
    };
  } catch {
    return null;
  }
}
