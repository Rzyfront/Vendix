import {
  buildFromHeader,
  sanitizeReplyTo,
  sanitizeSenderName,
} from './sender.util';

describe('sender.util', () => {
  it('quita comillas dobles, <>, saltos de línea y colapsa espacios', () => {
    expect(sanitizeSenderName('  ACME "SAS"\r\nBcc: x@y.z <a>  ', 'X')).toBe(
      'ACME SAS Bcc: x@y.z a',
    );
  });

  it('nombre vacío tras sanear cae al default', () => {
    expect(sanitizeSenderName('"<>"', 'Vendix')).toBe('Vendix');
  });

  it('Reply-To sólo si parece una dirección simple', () => {
    expect(sanitizeReplyTo('a@b.co')).toBe('a@b.co');
    expect(sanitizeReplyTo('a@b.co\r\nBcc: z@z.zz')).toBeUndefined();
    expect(sanitizeReplyTo('')).toBeUndefined();
  });

  it('From = nombre del emisor sobre la dirección verificada de plataforma', () => {
    expect(
      buildFromHeader(
        { name: 'PRINT "SOLUTIONS" SAS', email: 'x@y.co' },
        'Vendix',
        'noreply@vendix.online',
      ),
    ).toBe('"PRINT SOLUTIONS SAS" <noreply@vendix.online>');
    expect(buildFromHeader(undefined, 'Vendix', 'noreply@vendix.online')).toBe(
      '"Vendix" <noreply@vendix.online>',
    );
  });
});
