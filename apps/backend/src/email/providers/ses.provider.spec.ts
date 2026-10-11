import { SesProvider } from './ses.provider';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'm1' }),
  })),
}));

describe('SesProvider.sendEmailWithAttachments — remitente del emisor', () => {
  const config: any = {
    provider: 'ses',
    fromEmail: 'noreply@vendix.online',
    fromName: 'Vendix',
    smtp: { host: 'h', port: 587, secure: false, auth: { user: 'u', pass: 'p' } },
  };
  const att = [
    { filename: 'z.zip', content: Buffer.from('x'), contentType: 'application/zip' },
  ];

  it('con from: From = emisor sobre la dirección de plataforma, Reply-To = emisor', async () => {
    const provider = new SesProvider(config);
    const sendMail = (provider as any).transporter.sendMail as jest.Mock;
    await provider.sendEmailWithAttachments('to@x.co', 's', '<p/>', att, 't', {
      name: 'PRINT "SOLUTIONS" SAS',
      email: 'facturas@print.co',
    });
    const arg = sendMail.mock.calls[0][0];
    expect(arg.from).toBe('"PRINT SOLUTIONS SAS" <noreply@vendix.online>');
    expect(arg.replyTo).toBe('facturas@print.co');
  });

  it('sin from: remitente por defecto y sin Reply-To', async () => {
    const provider = new SesProvider(config);
    const sendMail = (provider as any).transporter.sendMail as jest.Mock;
    await provider.sendEmailWithAttachments('to@x.co', 's', '<p/>', att, 't');
    const arg = sendMail.mock.calls[0][0];
    expect(arg.from).toBe('"Vendix" <noreply@vendix.online>');
    expect(arg.replyTo).toBeUndefined();
  });
});
