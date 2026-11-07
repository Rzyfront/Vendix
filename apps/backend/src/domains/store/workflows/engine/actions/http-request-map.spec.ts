import { resolveHttpRequestMap } from './http-request-map';

const ctx = {
  fields: { nombre: 'Ana & "Luis"', monto: 1500 },
  instance: { reference: 'FLU-000001', title: 'Pago "urgente"' },
};

describe('resolveHttpRequestMap (M1: values encoded for where they land)', () => {
  it('URL tokens are URL components; numbers stay as they are', () => {
    const m = resolveHttpRequestMap(
      { method: 'GET', url: 'https://a.test/c?q={{fields.nombre}}&n={{fields.monto}}' },
      ctx,
    ) as Record<string, string>;
    expect(m.url).toBe(`https://a.test/c?q=${encodeURIComponent('Ana & "Luis"')}&n=1500`);
  });

  it('a JSON body (declared or by shape) gets JSON string content, instance tokens too', () => {
    const declared = resolveHttpRequestMap(
      {
        method: 'POST',
        url: 'https://a.test',
        headers: 'Content-Type: application/json; charset=utf-8',
        body: ' {"t":"{{instance.title}}","n":{{fields.monto}}}',
      },
      ctx,
    ) as Record<string, string>;
    expect(JSON.parse(declared.body)).toEqual({ t: 'Pago "urgente"', n: 1500 });
  });

  it('a form body is form-encoded; a plain-text body is pasted as it is', () => {
    const form = resolveHttpRequestMap(
      {
        method: 'POST',
        url: 'https://a.test',
        headers: 'content-type: application/x-www-form-urlencoded',
        body: 'nombre={{fields.nombre}}',
      },
      ctx,
    ) as Record<string, string>;
    expect(new URLSearchParams(form.body).get('nombre')).toBe('Ana & "Luis"');

    const text = resolveHttpRequestMap(
      {
        method: 'POST',
        url: 'https://a.test',
        headers: 'Content-Type: text/plain',
        body: 'Hola {{fields.nombre}}',
      },
      ctx,
    ) as Record<string, string>;
    expect(text.body).toBe('Hola Ana & "Luis"');
  });

  it('{{secrets.*}} stays in place for the call', () => {
    const m = resolveHttpRequestMap(
      {
        method: 'POST',
        url: 'https://a.test/{{secrets.KEY}}',
        body: '{"k":"{{secrets.KEY}}"}',
      },
      ctx,
    ) as Record<string, string>;
    expect(m.url).toBe('https://a.test/{{secrets.KEY}}');
    expect(m.body).toBe('{"k":"{{secrets.KEY}}"}');
  });
});
