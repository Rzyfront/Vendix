import {
  EMBEDDED_SIGNUP_CANCEL_MESSAGE,
  EMBEDDED_SIGNUP_INCOMPLETE_MESSAGE,
  EMBEDDED_SIGNUP_MAX_WAIT_MS,
  EMBEDDED_SIGNUP_SESSION_GRACE_MS,
  EmbeddedSignupFacebookApi,
  EmbeddedSignupFlowResult,
  startEmbeddedSignupFlow,
} from './embedded-signup-flow';

function postSession(event: string, data: Record<string, unknown> = {}) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://www.facebook.com',
      data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data }),
    }),
  );
}

function setup() {
  let callback: (response: any) => void = () => undefined;
  let options: Record<string, any> = {};
  const fb: EmbeddedSignupFacebookApi = {
    login: (cb, opts) => {
      callback = cb;
      options = opts;
    },
  };
  let result: EmbeddedSignupFlowResult | undefined;
  let error: Error | undefined;
  startEmbeddedSignupFlow(fb, { whatsapp_config_id: 'cfg' }).then(
    (r) => (result = r),
    (e) => (error = e),
  );
  return {
    login: (response: any) => callback(response),
    options: () => options,
    result: () => result,
    error: () => error,
  };
}

// Zoneless test runner: no fakeAsync. Timers use jasmine.clock() and
// promise callbacks are drained explicitly after each tick.
async function tick(ms = 0) {
  jasmine.clock().tick(ms);
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('startEmbeddedSignupFlow', () => {
  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  it('sends only setup extras (no undocumented featureType)', () => {
    const flow = setup();
    expect(flow.options()['extras']).toEqual({ setup: {} });
    expect(flow.options()['config_id']).toBe('cfg');
    // leave the flow settled so no timers leak
    postSession('CANCEL');
    flow.login({});
  });

  it('shows "Cancelaste la conexión" when CANCEL was seen and no code arrives', async () => {
    const flow = setup();
    postSession('CANCEL', { current_step: 'PHONE_NUMBER_SETUP' });
    flow.login({ authResponse: null });
    await tick();
    expect(flow.error()?.message).toBe('Cancelaste la conexión');
    expect(flow.error()?.message).toBe(EMBEDDED_SIGNUP_CANCEL_MESSAGE);
  });

  it('shows a "no completó" message when the popup closes without code or CANCEL', async () => {
    const flow = setup();
    flow.login({});
    await tick();
    expect(flow.error()?.message).toBe(EMBEDDED_SIGNUP_INCOMPLETE_MESSAGE);
  });

  for (const event of [
    'FINISH',
    'FINISH_ONLY_WABA',
    'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    'FINISH_GRANT_ONLY_API_ACCESS',
  ]) {
    it(`treats ${event} as completion`, async () => {
      const flow = setup();
      postSession(event, { waba_id: 'w1', phone_number_id: 'p1' });
      flow.login({ authResponse: { code: 'abc' } });
      await tick();
      expect(flow.result()).toEqual(
        jasmine.objectContaining({
          code: 'abc',
          waba_id: 'w1',
          phone_number_id: 'p1',
        }),
      );
    });
  }

  it('resolves when the session event arrives after the code', async () => {
    const flow = setup();
    flow.login({ authResponse: { code: 'abc' } });
    await tick(1000);
    expect(flow.result()).toBeUndefined();
    postSession('FINISH', { waba_id: 'w1', phone_number_id: 'p1' });
    await tick();
    expect(flow.result()?.waba_id).toBe('w1');
  });

  it('sends the code without ids after the 3 s session grace', async () => {
    const flow = setup();
    flow.login({ authResponse: { code: 'abc' } });
    await tick(EMBEDDED_SIGNUP_SESSION_GRACE_MS - 1);
    expect(flow.result()).toBeUndefined();
    await tick(1);
    expect(flow.result()).toEqual(
      jasmine.objectContaining({
        code: 'abc',
        waba_id: undefined,
        phone_number_id: undefined,
      }),
    );
  });

  it('ignores messages from other origins', async () => {
    const flow = setup();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR' }),
      }),
    );
    expect(flow.error()).toBeUndefined();
    postSession('CANCEL');
    flow.login({});
    await tick();
  });

  it('keeps waiting for 10 minutes and then gives up', async () => {
    const flow = setup();
    await tick(EMBEDDED_SIGNUP_MAX_WAIT_MS - 1);
    expect(flow.error()).toBeUndefined();
    await tick(1);
    expect(flow.error()?.message).toContain('tardó demasiado');
  });
});
