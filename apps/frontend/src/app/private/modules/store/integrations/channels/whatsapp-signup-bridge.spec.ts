import {
  EMBEDDED_SIGNUP_INCOMPLETE_MESSAGE,
  EMBEDDED_SIGNUP_TIMEOUT_MESSAGE,
  EmbeddedSignupFlowError,
  EmbeddedSignupFlowResult,
} from './embedded-signup-flow';
import {
  WHATSAPP_SIGNUP_BRIDGE_MESSAGE_TYPE,
  WHATSAPP_SIGNUP_POPUP_BLOCKED_MESSAGE,
  buildSignupBridgeMessage,
  buildSignupBridgeUrl,
  createSignupBridgeNonce,
  isSignupBridgeNonce,
  openSignupBridge,
  parseSignupBridgeOrigin,
  shouldUseSignupBridge,
  signupBridgeLookupHostname,
  waitForSignupBridgeResult,
  whatsappSignupBridgeOrigin,
} from './whatsapp-signup-bridge';

// Real timers with tiny waits, so the spec runs the same under any runner.
const FAST = { pollMs: 2, closedGraceMs: 5, maxWaitMs: 2000 };
const BRIDGE = 'https://vendix.online';
const NONCE = '0123456789abcdef0123456789abcdef';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function post(origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

function fakePopup() {
  return {
    closed: false,
    closeCalls: 0,
    close() {
      this.closeCalls++;
      this.closed = true;
    },
  };
}

async function settle<T>(promise: Promise<T>) {
  try {
    return { value: await promise, error: undefined as Error | undefined };
  } catch (error) {
    return { value: undefined as T | undefined, error: error as Error };
  }
}

describe('whatsapp signup bridge: panel chooses bridge or inline', () => {
  it('derives the fixed host from the environment domain', () => {
    expect(whatsappSignupBridgeOrigin('vendix.online')).toBe(
      'https://vendix.online',
    );
    expect(whatsappSignupBridgeOrigin('vendix.com')).toBe('https://vendix.com');
  });

  it('keeps the inline flow on the fixed host and uses the bridge elsewhere', () => {
    expect(shouldUseSignupBridge('https://vendix.online', BRIDGE)).toBe(false);
    expect(shouldUseSignupBridge('https://mi-store.vendix.online', BRIDGE)).toBe(
      true,
    );
    expect(shouldUseSignupBridge('https://mitienda.com', BRIDGE)).toBe(true);
  });

  it('opens the bridge with the panel origin and the attempt nonce', () => {
    const calls: string[] = [];
    const popup = fakePopup() as unknown as Window;
    const opened = openSignupBridge(
      (url) => {
        calls.push(url);
        return popup;
      },
      BRIDGE,
      'https://mitienda.com',
      NONCE,
    );

    expect(opened).toBe(popup);
    const url = new URL(calls[0]);
    expect(url.origin).toBe(BRIDGE);
    expect(url.pathname).toBe('/integraciones/whatsapp/conectar');
    expect(url.searchParams.get('origin')).toBe('https://mitienda.com');
    expect(url.searchParams.get('nonce')).toBe(NONCE);
  });

  it('asks to allow popups when the browser blocks the bridge window', () => {
    let error: unknown;
    try {
      openSignupBridge(() => null, BRIDGE, 'https://mitienda.com', NONCE);
    } catch (e) {
      error = e;
    }
    expect(error instanceof EmbeddedSignupFlowError).toBe(true);
    expect((error as Error).message).toBe(
      'Permite las ventanas emergentes para conectar WhatsApp',
    );
    expect((error as Error).message).toBe(WHATSAPP_SIGNUP_POPUP_BLOCKED_MESSAGE);
  });

  it('creates a fresh 128-bit hex nonce per attempt', () => {
    const a = createSignupBridgeNonce();
    const b = createSignupBridgeNonce();
    expect(isSignupBridgeNonce(a)).toBe(true);
    expect(isSignupBridgeNonce(b)).toBe(true);
    expect(a === b).toBe(false);
    expect(isSignupBridgeNonce('abc')).toBe(false);
    expect(isSignupBridgeNonce(NONCE.toUpperCase())).toBe(false);
    expect(isSignupBridgeNonce(null)).toBe(false);
  });
});

describe('whatsapp signup bridge: bridge validates the opener origin', () => {
  it('accepts a bare https origin, with or without port', () => {
    expect(parseSignupBridgeOrigin('https://mitienda.com')?.hostname).toBe(
      'mitienda.com',
    );
    expect(
      parseSignupBridgeOrigin('https://mi-store.vendix.com:8443')?.port,
    ).toBe('8443');
  });

  it('rejects anything that is not exactly an https origin', () => {
    for (const raw of [
      'http://mitienda.com',
      'https://mitienda.com/',
      'https://mitienda.com/admin',
      'https://user:pass@mitienda.com',
      'javascript:alert(1)',
      'mitienda.com',
      '*',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(parseSignupBridgeOrigin(raw)).toBeNull();
    }
  });

  it('resolves the hostname the same way the app resolves itself (no www)', () => {
    const origin = parseSignupBridgeOrigin('https://www.mitienda.com');
    expect(origin).not.toBeNull();
    expect(signupBridgeLookupHostname(origin as URL)).toBe('mitienda.com');
    // location.origin is always lowercase: anything else did not come from it.
    expect(parseSignupBridgeOrigin('https://MiTienda.com')).toBeNull();
  });

  it('builds the success and error messages the panel expects', () => {
    const result: EmbeddedSignupFlowResult = { code: 'c', waba_id: 'w' };
    expect(buildSignupBridgeMessage(NONCE, { result })).toEqual({
      type: 'VENDIX_WA_SIGNUP',
      nonce: NONCE,
      ok: true,
      result,
    });
    expect(
      buildSignupBridgeMessage(NONCE, { error: 'Cancelaste la conexión' }),
    ).toEqual({
      type: 'VENDIX_WA_SIGNUP',
      nonce: NONCE,
      ok: false,
      error: 'Cancelaste la conexión',
    });
  });

  it('builds the bridge URL on the fixed host', () => {
    expect(buildSignupBridgeUrl(BRIDGE, 'https://mitienda.com', NONCE)).toBe(
      `${BRIDGE}/integraciones/whatsapp/conectar?origin=https%3A%2F%2Fmitienda.com&nonce=${NONCE}`,
    );
  });
});

describe('whatsapp signup bridge: panel waits for the answer', () => {
  const valid = (overrides: Record<string, unknown> = {}) => ({
    type: WHATSAPP_SIGNUP_BRIDGE_MESSAGE_TYPE,
    nonce: NONCE,
    ok: true,
    result: {
      code: 'meta-code',
      waba_id: 'waba',
      phone_number_id: 'phone',
      display_phone_number: '+57 300',
      business_account_id: 'biz',
    },
    ...overrides,
  });

  it('resolves with the signup result from the fixed host', async () => {
    const popup = fakePopup();
    const waiting = settle(
      waitForSignupBridgeResult(popup, BRIDGE, NONCE, FAST),
    );
    post(BRIDGE, valid());
    const { value, error } = await waiting;
    expect(error).toBeUndefined();
    expect(value).toEqual({
      code: 'meta-code',
      waba_id: 'waba',
      phone_number_id: 'phone',
      display_phone_number: '+57 300',
      business_account_id: 'biz',
    });
  });

  it('drops fields the complete endpoint does not accept', async () => {
    const popup = fakePopup();
    const waiting = settle(
      waitForSignupBridgeResult(popup, BRIDGE, NONCE, FAST),
    );
    post(
      BRIDGE,
      valid({ result: { code: 'meta-code', admin: true, waba_id: 7 } }),
    );
    const { value } = await waiting;
    expect(value).toEqual({ code: 'meta-code' });
  });

  it('ignores another origin, another type and another nonce', async () => {
    const popup = fakePopup();
    const waiting = settle(
      waitForSignupBridgeResult(popup, BRIDGE, NONCE, FAST),
    );
    post('https://evil.example', valid({ result: { code: 'forged-1' } }));
    post(BRIDGE, valid({ type: 'WA_EMBEDDED_SIGNUP', result: { code: 'x2' } }));
    post(
      BRIDGE,
      valid({
        nonce: 'ffffffffffffffffffffffffffffffff',
        result: { code: 'x3' },
      }),
    );
    post(BRIDGE, 'not-an-object');
    await sleep(10);
    post(BRIDGE, valid());
    const { value } = await waiting;
    expect(value?.code).toBe('meta-code');
  });

  it('shows the bridge error text when the signup did not finish', async () => {
    const popup = fakePopup();
    const waiting = settle(
      waitForSignupBridgeResult(popup, BRIDGE, NONCE, FAST),
    );
    post(BRIDGE, valid({ ok: false, result: undefined, error: 'Cancelaste la conexión' }));
    const { error } = await waiting;
    expect(error instanceof EmbeddedSignupFlowError).toBe(true);
    expect(error?.message).toBe('Cancelaste la conexión');
  });

  it('says the connection was not completed when the bridge closes without answering', async () => {
    const popup = fakePopup();
    const waiting = settle(
      waitForSignupBridgeResult(popup, BRIDGE, NONCE, FAST),
    );
    popup.closed = true;
    const { error } = await waiting;
    expect(error?.message).toBe(
      'No completaste la conexión de WhatsApp. Inténtalo de nuevo.',
    );
    expect(error?.message).toBe(EMBEDDED_SIGNUP_INCOMPLETE_MESSAGE);
  });

  it('still takes the answer posted right before the bridge closed itself', async () => {
    const popup = fakePopup();
    const waiting = settle(
      waitForSignupBridgeResult(popup, BRIDGE, NONCE, {
        ...FAST,
        closedGraceMs: 50,
      }),
    );
    popup.closed = true;
    await sleep(10);
    post(BRIDGE, valid());
    const { value, error } = await waiting;
    expect(error).toBeUndefined();
    expect(value?.code).toBe('meta-code');
  });

  it('gives up at the ceiling and closes the bridge window', async () => {
    const popup = fakePopup();
    const { error } = await settle(
      waitForSignupBridgeResult(popup, BRIDGE, NONCE, {
        ...FAST,
        maxWaitMs: 20,
      }),
    );
    expect(error?.message).toBe(EMBEDDED_SIGNUP_TIMEOUT_MESSAGE);
    expect(popup.closeCalls).toBe(1);
  });
});
