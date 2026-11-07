import {
  WebhookUrlError,
  assertWebhookUrl,
  createVettedLookup,
  isBlockedAddress,
  resolveAndVet,
} from './webhook-url-policy';

const ok = (u: string) => expect(() => assertWebhookUrl(u)).not.toThrow();
const blocked = (u: string) =>
  expect(() => assertWebhookUrl(u)).toThrow(WebhookUrlError);

describe('assertWebhookUrl · tabla de URLs', () => {
  it('acepta https públicos (puerto 443, >=1024 o sin puerto)', () => {
    ok('https://hooks.example.com/vendix');
    ok('https://hooks.example.com:443/x');
    ok('https://hooks.example.com:8443/x?a=1');
    ok('https://hooks.example.com:1024/');
    ok('https://8.8.8.8/hook');
    ok('https://[2606:4700:4700::1111]/hook');
    ok('https://api.sub.example.co.uk/a/b');
  });

  it('rechaza esquemas que no son https', () => {
    for (const u of [
      'http://hooks.example.com/x',
      'ftp://hooks.example.com/x',
      'file:///etc/passwd',
      'gopher://hooks.example.com',
      'javascript:alert(1)',
      'data:text/plain,hola',
      '//hooks.example.com/x',
      'hooks.example.com/x',
    ]) {
      blocked(u);
    }
  });

  it('rechaza credenciales en la URL', () => {
    blocked('https://user:pass@hooks.example.com/x');
    blocked('https://user@hooks.example.com/x');
    blocked('https://:pass@hooks.example.com/x');
  });

  it('rechaza puertos privilegiados distintos de 443', () => {
    for (const p of [22, 25, 80, 110, 443 - 1, 1023, 8, 1]) {
      blocked(`https://hooks.example.com:${p}/x`);
    }
  });

  it('rechaza IPv4 privadas, loopback, link-local, CGNAT, multicast y metadata', () => {
    for (const ip of [
      '127.0.0.1',
      '127.255.255.254',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '169.254.0.1',
      '100.64.0.1',
      '100.127.255.255',
      '0.0.0.0',
      '0.1.2.3',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '255.255.255.255',
      '192.0.0.1',
      '192.0.2.5',
      '198.18.0.1',
      '198.51.100.7',
      '203.0.113.9',
    ]) {
      blocked(`https://${ip}/x`);
    }
    ok('https://172.32.0.1/x');
    ok('https://100.128.0.1/x');
    ok('https://1.1.1.1/x');
  });

  it('rechaza IPv6 privadas, loopback, link-local, únicas locales y multicast', () => {
    for (const ip of [
      '::1',
      '::',
      'fe80::1',
      'fe80::abcd:1%25eth0',
      'fc00::1',
      'fd12:3456:789a::1',
      'fec0::1',
      'ff02::1',
      '2001:db8::1',
      '100::1',
    ]) {
      blocked(`https://[${ip}]/x`);
    }
  });

  it('rechaza IPv6 mapeadas a IPv4 privada (::ffff:) en todas sus grafías', () => {
    for (const ip of [
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.0.0.1',
      '::ffff:a00:1',
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      '::ffff:c0a8:101',
      '0:0:0:0:0:ffff:7f00:1',
      '::127.0.0.1',
      '64:ff9b::7f00:1',
      '64:ff9b::a9fe:a9fe',
      '2002:7f00:1::',
      '2002:a9fe:a9fe::1',
    ]) {
      blocked(`https://[${ip}]/x`);
    }
    ok('https://[::ffff:8.8.8.8]/x');
  });

  it('rechaza IPv4 en formas decimal, octal, hexadecimal y abreviada', () => {
    for (const host of [
      '2130706433', // 127.0.0.1
      '017700000001', // octal
      '0x7f000001', // hex
      '0177.0.0.1',
      '0x7f.0.0.1',
      '127.1',
      '127.0.1',
      '2852039166', // 169.254.169.254
      '0251.0376.0251.0376',
      '0xa9fea9fe',
      '167772161', // 10.0.0.1
      '3232235777', // 192.168.1.1
    ]) {
      blocked(`https://${host}/x`);
    }
  });

  it('rechaza localhost y nombres internos', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      'localhost.',
      'foo.localhost',
      'printer.local',
      'db.internal',
      'router.lan',
      'intranet',
      'server',
      'metadata',
      'host.localdomain',
      'a.corp',
    ]) {
      blocked(`https://${host}/x`);
    }
  });

  it('rechaza vacío, espacios, caracteres de control y URLs larguísimas', () => {
    blocked('');
    blocked('   ');
    blocked('https://hooks.example.com/ x');
    blocked('https://hooks.example.com/\n');
    blocked('https://hooks.example.com/\u0000');
    blocked(`https://hooks.example.com/${'a'.repeat(500)}`);
    expect(() => assertWebhookUrl(undefined)).toThrow(WebhookUrlError);
    expect(() => assertWebhookUrl(42)).toThrow(WebhookUrlError);
    expect(() => assertWebhookUrl(null)).toThrow(WebhookUrlError);
  });
});

describe('isBlockedAddress', () => {
  it('B7: bloquea Teredo (2001::/32) y NAT64 local (64:ff9b:1::/48)', () => {
    expect(isBlockedAddress('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe(true);
    expect(isBlockedAddress('2001::1')).toBe(true);
    expect(isBlockedAddress('64:ff9b:1::1')).toBe(true);
    expect(isBlockedAddress('64:ff9b:1:ffff::1')).toBe(true);
    // Vecinos públicos: no se bloquean de más.
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
    expect(isBlockedAddress('64:ff9b:2::1')).toBe(false);
  });

  it('bloquea lo que no es una IP (falla cerrado) y lo privado', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('resolveAndVet · DNS', () => {
  const resolverTo =
    (...addresses: string[]) =>
    async () =>
      addresses.map((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
      }));

  it('devuelve todas las direcciones cuando todas son públicas', async () => {
    const out = await resolveAndVet(
      'hooks.example.com',
      resolverTo('93.184.216.34', '2606:2800::1'),
    );
    expect(out.map((a) => a.address)).toEqual([
      '93.184.216.34',
      '2606:2800::1',
    ]);
  });

  it('rechaza un nombre que resuelve a una IP privada', async () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '::1',
      '::ffff:10.0.0.1',
      'fd00::1',
    ]) {
      await expect(
        resolveAndVet('evil.example.com', resolverTo(ip)),
      ).rejects.toThrow(WebhookUrlError);
    }
  });

  it('rechaza si CUALQUIERA de los registros es privado (A público + A privado)', async () => {
    await expect(
      resolveAndVet(
        'evil.example.com',
        resolverTo('93.184.216.34', '192.168.0.10'),
      ),
    ).rejects.toThrow(WebhookUrlError);
  });

  it('rechaza un nombre sin registros y propaga el fallo del resolvedor', async () => {
    await expect(
      resolveAndVet('none.example.com', resolverTo()),
    ).rejects.toThrow(WebhookUrlError);
    await expect(
      resolveAndVet('none.example.com', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toThrow('ENOTFOUND');
  });

  it('un literal IP no consulta DNS', async () => {
    const resolver = jest.fn();
    await expect(resolveAndVet('127.0.0.1', resolver)).rejects.toThrow(
      WebhookUrlError,
    );
    await expect(resolveAndVet('[::1]', resolver)).rejects.toThrow(
      WebhookUrlError,
    );
    expect((await resolveAndVet('8.8.8.8', resolver))[0].address).toBe(
      '8.8.8.8',
    );
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('createVettedLookup · el socket solo conecta a lo vetado', () => {
  const call = (
    lookup: ReturnType<typeof createVettedLookup>,
    host: string,
    all = false,
  ) =>
    new Promise<{ err: Error | null; address?: unknown; family?: number }>(
      (resolve) =>
        lookup(host, { all }, (err, address, family) =>
          resolve({ err, address, family }),
        ),
    );

  it('entrega la dirección pública (forma simple y forma all)', async () => {
    const lookup = createVettedLookup(async () => [
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(await call(lookup, 'hooks.example.com')).toEqual({
      err: null,
      address: '93.184.216.34',
      family: 4,
    });
    const all = await call(lookup, 'hooks.example.com', true);
    expect(all.address).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('DNS rebinding: el nombre que ahora resuelve a privado falla en el connect', async () => {
    let answer = '93.184.216.34';
    const lookup = createVettedLookup(async () => [
      { address: answer, family: 4 },
    ]);
    expect((await call(lookup, 'rebind.example.com')).err).toBeNull();
    answer = '169.254.169.254';
    const second = await call(lookup, 'rebind.example.com');
    expect(second.err).toBeInstanceOf(WebhookUrlError);
    expect(second.address).toBeUndefined();
  });
});
