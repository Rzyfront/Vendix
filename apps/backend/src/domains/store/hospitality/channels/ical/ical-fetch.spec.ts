import { fetchIcalFeed, isPublicAddress, normalizeIcalUrl } from './ical-fetch';

const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
const publicDns = async () => ['93.184.216.34'];

const reply = (status: number, body = '', headers: Record<string, string> = {}) =>
  new Response(status >= 300 && status < 400 ? null : body, { status, headers });

describe('iCal import fetch (H6.2)', () => {
  it('accepts https and webcal, rejects http, credentials and garbage', () => {
    expect(normalizeIcalUrl('webcal://www.airbnb.com/calendar/ical/1.ics?s=x').toString()).toBe(
      'https://www.airbnb.com/calendar/ical/1.ics?s=x',
    );
    expect(() => normalizeIcalUrl('http://www.airbnb.com/1.ics')).toThrow('https://');
    expect(() => normalizeIcalUrl('https://u:p@example.com/1.ics')).toThrow('usuario');
    expect(() => normalizeIcalUrl('no es una url')).toThrow('no es válida');
  });

  it('tells public addresses from internal ones', () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2606:4700::1111')).toBe(true);
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.0.2', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });

  it('never calls a host that resolves to a private network', async () => {
    const fetchImpl = jest.fn();
    await expect(
      fetchIcalFeed('https://intranet.example/1.ics', {
        resolve: async () => ['10.0.0.8'],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('red privada');
    await expect(
      fetchIcalFeed('https://169.254.169.254/latest', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('red privada');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-checks the host of a redirect', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(reply(302, '', { location: 'https://127.0.0.1/x.ics' }));
    await expect(
      fetchIcalFeed('https://www.airbnb.com/1.ics', {
        resolve: publicDns,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('red privada');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns the calendar text and refuses errors, non-calendars and oversized bodies', async () => {
    const run = (response: Response, max_bytes?: number) =>
      fetchIcalFeed('https://www.airbnb.com/1.ics', {
        resolve: publicDns,
        max_bytes,
        fetchImpl: (async () => response) as unknown as typeof fetch,
      });
    await expect(run(reply(200, ICS))).resolves.toBe(ICS);
    await expect(run(reply(404))).rejects.toThrow('respondió 404');
    await expect(run(reply(200, '<html></html>'))).rejects.toThrow('no devuelve un calendario');
    await expect(run(reply(200, ICS + 'x'.repeat(200)), 100)).rejects.toThrow('demasiado grande');
  });
});
