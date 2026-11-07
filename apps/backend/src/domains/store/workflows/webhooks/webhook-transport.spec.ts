import { PassThrough, Readable } from 'stream';
import {
  WEBHOOK_MAX_RESPONSE_BYTES,
  httpsWebhookTransport,
  readCapped,
} from './webhook-transport';
import { WebhookUrlError } from './webhook-url-policy';

describe('readCapped · tope de 4 KB en la respuesta', () => {
  it('devuelve el cuerpo completo si cabe', async () => {
    expect(await readCapped(Readable.from(['hola ', 'mundo']), 4096)).toBe(
      'hola mundo',
    );
  });

  it('corta en el tope y destruye el stream, sin leer el resto', async () => {
    const stream = new PassThrough();
    const pending = readCapped(stream, WEBHOOK_MAX_RESPONSE_BYTES);
    stream.write('a'.repeat(3000));
    stream.write('b'.repeat(3000));
    const body = await pending;
    expect(body.length).toBe(WEBHOOK_MAX_RESPONSE_BYTES);
    expect(body.endsWith('b')).toBe(true);
    expect(stream.destroyed).toBe(true);
  });

  it('un cuerpo enorme de un solo chunk también se corta', async () => {
    const body = await readCapped(
      Readable.from([Buffer.alloc(1_000_000, 'x')]),
      4096,
    );
    expect(body.length).toBe(4096);
  });

  it('un error del stream no rompe la lectura', async () => {
    const stream = new PassThrough();
    const pending = readCapped(stream, 4096);
    stream.write('parcial');
    stream.destroy(new Error('reset'));
    expect(await pending).toBe('parcial');
  });
});

describe('httpsWebhookTransport · política antes de abrir el socket', () => {
  const req = (url: string) => ({ url, headers: {}, body: '{}' });

  it('rechaza URLs no permitidas sin conectarse', async () => {
    for (const url of [
      'http://hooks.example.com/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://[::ffff:7f00:1]/x',
    ]) {
      await expect(httpsWebhookTransport(req(url))).rejects.toBeInstanceOf(
        WebhookUrlError,
      );
    }
  });
});
