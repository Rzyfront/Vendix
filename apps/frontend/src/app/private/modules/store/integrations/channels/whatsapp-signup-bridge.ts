/**
 * Protocol between the store panel and the WhatsApp signup bridge page.
 *
 * Meta only returns Embedded Signup results to pages on domains listed in the
 * app settings, and store panels live on dynamic hosts (subdomains and
 * customer domains). So the flow always runs on one fixed host: the panel
 * opens the bridge there, the bridge runs Meta's flow and posts the result
 * back to the exact panel origin it validated. The authenticated `complete`
 * call stays in the panel tab, where the owner is signed in.
 */
import {
  EMBEDDED_SIGNUP_ERROR_MESSAGE,
  EMBEDDED_SIGNUP_INCOMPLETE_MESSAGE,
  EMBEDDED_SIGNUP_MAX_WAIT_MS,
  EMBEDDED_SIGNUP_TIMEOUT_MESSAGE,
  EmbeddedSignupFlowError,
  EmbeddedSignupFlowResult,
} from './embedded-signup-flow';

export const WHATSAPP_SIGNUP_BRIDGE_MESSAGE_TYPE = 'VENDIX_WA_SIGNUP';
export const WHATSAPP_SIGNUP_BRIDGE_PATH = '/integraciones/whatsapp/conectar';
export const WHATSAPP_SIGNUP_BRIDGE_WINDOW_NAME = 'vendix-whatsapp-signup';
export const WHATSAPP_SIGNUP_POPUP_BLOCKED_MESSAGE =
  'Permite las ventanas emergentes para conectar WhatsApp';
export const WHATSAPP_SIGNUP_UNVERIFIED_ORIGIN_MESSAGE =
  'No podemos verificar desde dónde abriste esta ventana';

const BRIDGE_WINDOW_FEATURES = 'popup,width=640,height=760';
const BRIDGE_POLL_MS = 500;
/** The bridge posts and then closes itself: let its message land first. */
const BRIDGE_CLOSED_GRACE_MS = 1000;
const RESULT_FIELDS = [
  'waba_id',
  'phone_number_id',
  'display_phone_number',
  'business_account_id',
] as const;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

export interface WhatsappSignupBridgeMessage {
  type: typeof WHATSAPP_SIGNUP_BRIDGE_MESSAGE_TYPE;
  nonce: string;
  ok: boolean;
  result?: EmbeddedSignupFlowResult;
  error?: string;
}

/** The fixed host every signup runs on, e.g. `https://vendix.online`. */
export function whatsappSignupBridgeOrigin(vendixDomain: string): string {
  return `https://${vendixDomain}`;
}

/** Inline only where Meta already accepts the domain: the fixed host itself. */
export function shouldUseSignupBridge(
  currentOrigin: string,
  bridgeOrigin: string,
): boolean {
  return currentOrigin !== bridgeOrigin;
}

export function createSignupBridgeNonce(
  random: Pick<Crypto, 'getRandomValues'> = crypto,
): string {
  const bytes = random.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isSignupBridgeNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE_PATTERN.test(value);
}

/**
 * Accepts only a bare `https://host[:port]` origin, exactly as
 * `location.origin` produces it. Anything else (paths, credentials,
 * other schemes, garbage) is rejected.
 */
export function parseSignupBridgeOrigin(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.origin !== raw) return null;
  return url;
}

/** Hostname to resolve against Vendix domains, as the app resolves itself. */
export function signupBridgeLookupHostname(origin: URL): string {
  const hostname = origin.hostname.toLowerCase();
  return hostname.startsWith('www.') ? hostname.substring(4) : hostname;
}

export function buildSignupBridgeUrl(
  bridgeOrigin: string,
  openerOrigin: string,
  nonce: string,
): string {
  const url = new URL(WHATSAPP_SIGNUP_BRIDGE_PATH, bridgeOrigin);
  url.searchParams.set('origin', openerOrigin);
  url.searchParams.set('nonce', nonce);
  return url.toString();
}

/** Must run synchronously inside the click handler, or the browser blocks it. */
export function openSignupBridge(
  open: (url: string, target: string, features: string) => Window | null,
  bridgeOrigin: string,
  openerOrigin: string,
  nonce: string,
): Window {
  const popup = open(
    buildSignupBridgeUrl(bridgeOrigin, openerOrigin, nonce),
    WHATSAPP_SIGNUP_BRIDGE_WINDOW_NAME,
    BRIDGE_WINDOW_FEATURES,
  );
  if (!popup) {
    throw new EmbeddedSignupFlowError(WHATSAPP_SIGNUP_POPUP_BLOCKED_MESSAGE);
  }
  return popup;
}

export function buildSignupBridgeMessage(
  nonce: string,
  outcome: { result: EmbeddedSignupFlowResult } | { error: string },
): WhatsappSignupBridgeMessage {
  return 'result' in outcome
    ? {
        type: WHATSAPP_SIGNUP_BRIDGE_MESSAGE_TYPE,
        nonce,
        ok: true,
        result: outcome.result,
      }
    : {
        type: WHATSAPP_SIGNUP_BRIDGE_MESSAGE_TYPE,
        nonce,
        ok: false,
        error: outcome.error,
      };
}

export interface SignupBridgeWaitOptions {
  /** How often to check whether the owner closed the bridge window. */
  pollMs?: number;
  closedGraceMs?: number;
  maxWaitMs?: number;
}

/** Keeps only the fields `complete` accepts, as strings. */
function pickSignupResult(raw: unknown): EmbeddedSignupFlowResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (typeof source['code'] !== 'string' || !source['code']) return null;
  const result: EmbeddedSignupFlowResult = { code: source['code'] };
  for (const field of RESULT_FIELDS) {
    const value = source[field];
    if (typeof value === 'string' && value) result[field] = value;
  }
  return result;
}

/**
 * Waits for the bridge's answer. Accepts a message only from the fixed host,
 * with the bridge type and this attempt's nonce; everything else is ignored.
 */
export function waitForSignupBridgeResult(
  popup: Pick<Window, 'closed' | 'close'>,
  bridgeOrigin: string,
  nonce: string,
  options: SignupBridgeWaitOptions = {},
): Promise<EmbeddedSignupFlowResult> {
  const pollMs = options.pollMs ?? BRIDGE_POLL_MS;
  const closedGraceMs = options.closedGraceMs ?? BRIDGE_CLOSED_GRACE_MS;
  const maxWaitMs = options.maxWaitMs ?? EMBEDDED_SIGNUP_MAX_WAIT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    let closedTimer: number | undefined;

    const cleanup = () => {
      window.clearTimeout(ceilingTimer);
      window.clearTimeout(closedTimer);
      window.clearInterval(closedPoll);
      window.removeEventListener('message', handleMessage);
    };

    const fail = (message: string, closePopup: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (closePopup && !popup.closed) popup.close();
      reject(new EmbeddedSignupFlowError(message));
    };

    const handleMessage = (event: MessageEvent) => {
      if (settled || event.origin !== bridgeOrigin) return;
      const data = event.data as Partial<WhatsappSignupBridgeMessage> | null;
      if (!data || typeof data !== 'object') return;
      if (data.type !== WHATSAPP_SIGNUP_BRIDGE_MESSAGE_TYPE) return;
      if (data.nonce !== nonce) return;

      const result = data.ok ? pickSignupResult(data.result) : null;
      if (result) {
        settled = true;
        cleanup();
        resolve(result);
        return;
      }
      fail(
        typeof data.error === 'string' && data.error
          ? data.error
          : EMBEDDED_SIGNUP_ERROR_MESSAGE,
        false,
      );
    };

    const ceilingTimer = window.setTimeout(
      () => fail(EMBEDDED_SIGNUP_TIMEOUT_MESSAGE, true),
      maxWaitMs,
    );
    const closedPoll = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(closedPoll);
      closedTimer = window.setTimeout(
        () => fail(EMBEDDED_SIGNUP_INCOMPLETE_MESSAGE, false),
        closedGraceMs,
      );
    }, pollMs);

    window.addEventListener('message', handleMessage);
  });
}
