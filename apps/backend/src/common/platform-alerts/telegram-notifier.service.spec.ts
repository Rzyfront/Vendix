import { Logger } from '@nestjs/common';
import { TelegramNotifierService } from './telegram-notifier.service';

describe('TelegramNotifierService', () => {
  let env: Record<string, string>;
  let store: Map<string, string>;
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  const redis = () => ({
    incr: jest.fn(async (k: string) => {
      const v = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(v));
      return v;
    }),
    expire: jest.fn(),
    getdel: jest.fn(async (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    }),
  });
  const build = () =>
    new TelegramNotifierService({ get: (k: string) => env[k] } as never, redis() as never);

  beforeEach(() => {
    env = { MONITOR_TELEGRAM_BOT_TOKEN: '123:SECRET', MONITOR_TELEGRAM_CHAT_ID: '-100' };
    store = new Map();
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 77 } }),
    });
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('sin token o sin chat el canal está apagado y no llama a Telegram', async () => {
    env.MONITOR_TELEGRAM_BOT_TOKEN = '';
    const service = build();
    expect(service.isEnabled()).toBe(false);
    expect(await service.send('hola')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envía al chat configurado en HTML y devuelve el message_id', async () => {
    expect(await build().send('<b>hola</b>', { replyToMessageId: '5' })).toBe('77');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bot123:SECRET/sendMessage');
    expect(JSON.parse(init.body)).toMatchObject({
      chat_id: '-100',
      text: '<b>hola</b>',
      parse_mode: 'HTML',
      reply_to_message_id: 5,
    });
  });

  it('respeta el tope por minuto y el siguiente aviso informa cuántos se omitieron', async () => {
    env.MONITOR_TELEGRAM_MAX_PER_MINUTE = '1';
    const service = build();
    expect(await service.send('uno')).toBe('77');
    expect(await service.send('dos')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    store.clear();
    store.set('monitor:telegram:suppressed', '1');
    await service.send('tres');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).text).toContain('+1 avisos omitidos');
  });

  it('nunca lanza ni escribe el token en los logs si Telegram falla', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    fetchMock.mockRejectedValue(new Error('fetch failed https://api.telegram.org/bot123:SECRET/sendMessage'));
    await expect(build().send('x')).resolves.toBeNull();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('SECRET');
    warn.mockRestore();
  });

  it('edit tolera «message is not modified»', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, description: 'Bad Request: message is not modified' }),
    });
    expect(await build().edit('77', 'igual')).toBe(true);
  });
});
