/**
 * Pure logic of the WhatsApp Embedded Signup popup flow, kept out of the
 * component so the message/timeout rules can be unit tested.
 *
 * Meta contract (see the Embedded Signup docs):
 * - The session events (FINISH*, CANCEL, ERROR) arrive through `postMessage`.
 * - The exchangeable `code` arrives only in the FB.login callback, when the
 *   user clicks Finish, and it expires 30 seconds after that.
 */

export const EMBEDDED_SIGNUP_ORIGINS = [
  'https://www.facebook.com',
  'https://web.facebook.com',
];
/** Wait while the popup stays open, up to this ceiling. */
export const EMBEDDED_SIGNUP_MAX_WAIT_MS = 10 * 60 * 1000;
/** Once the code arrived, wait this long for the session event before going on. */
export const EMBEDDED_SIGNUP_SESSION_GRACE_MS = 3000;

export const EMBEDDED_SIGNUP_CANCEL_MESSAGE = 'Cancelaste la conexión';
export const EMBEDDED_SIGNUP_INCOMPLETE_MESSAGE =
  'No completaste la conexión de WhatsApp. Inténtalo de nuevo.';
export const EMBEDDED_SIGNUP_TIMEOUT_MESSAGE =
  'La conexión de WhatsApp tardó demasiado. Inténtalo de nuevo.';
export const EMBEDDED_SIGNUP_ERROR_MESSAGE =
  'WhatsApp no pudo completar la conexión';

const FINISH_EVENTS = new Set([
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'FINISH_GRANT_ONLY_API_ACCESS',
]);

export interface EmbeddedSignupFlowResult {
  code: string;
  /** Missing when the session event did not arrive in time. */
  waba_id?: string;
  phone_number_id?: string;
  display_phone_number?: string;
  business_account_id?: string;
}

/** An error whose message is already user-facing Spanish. */
export class EmbeddedSignupFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddedSignupFlowError';
  }
}

export interface EmbeddedSignupFacebookApi {
  login(
    callback: (response: any) => void,
    options: Record<string, unknown>,
  ): void;
}

export function parseEmbeddedSignupMessage(data: unknown): any {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data;
}

export function startEmbeddedSignupFlow(
  fb: EmbeddedSignupFacebookApi,
  config: { whatsapp_config_id: string | null },
): Promise<EmbeddedSignupFlowResult> {
  return new Promise((resolve, reject) => {
    let loginCode: string | null = null;
    let signupData: any = null;
    let cancelSeen = false;
    let settled = false;
    let graceTimer: number | undefined;

    const cleanup = () => {
      window.clearTimeout(ceilingTimer);
      window.clearTimeout(graceTimer);
      window.removeEventListener('message', handleMessage);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new EmbeddedSignupFlowError(message));
    };

    const finish = () => {
      if (settled || !loginCode) return;
      settled = true;
      cleanup();
      resolve({
        code: loginCode,
        waba_id: signupData?.waba_id || undefined,
        phone_number_id: signupData?.phone_number_id || undefined,
        display_phone_number: signupData?.display_phone_number || undefined,
        business_account_id: signupData?.business_id || undefined,
      });
    };

    const handleMessage = (event: MessageEvent) => {
      if (!EMBEDDED_SIGNUP_ORIGINS.includes(event.origin)) return;

      const data = parseEmbeddedSignupMessage(event.data);
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (FINISH_EVENTS.has(data.event)) {
        signupData = { ...(signupData ?? {}), ...(data.data ?? {}) };
        if (loginCode) finish();
      } else if (data.event === 'CANCEL') {
        cancelSeen = true;
      } else if (data.event === 'ERROR') {
        fail(data.data?.error_message || EMBEDDED_SIGNUP_ERROR_MESSAGE);
      }
    };

    const ceilingTimer = window.setTimeout(
      () => fail(EMBEDDED_SIGNUP_TIMEOUT_MESSAGE),
      EMBEDDED_SIGNUP_MAX_WAIT_MS,
    );

    window.addEventListener('message', handleMessage);

    fb.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        if (!code) {
          fail(
            cancelSeen
              ? EMBEDDED_SIGNUP_CANCEL_MESSAGE
              : EMBEDDED_SIGNUP_INCOMPLETE_MESSAGE,
          );
          return;
        }

        loginCode = code;
        if (signupData) {
          finish();
          return;
        }
        // The code lives 30 s: do not wait for the session event past the grace.
        graceTimer = window.setTimeout(
          finish,
          EMBEDDED_SIGNUP_SESSION_GRACE_MS,
        );
      },
      {
        config_id: config.whatsapp_config_id,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  });
}
