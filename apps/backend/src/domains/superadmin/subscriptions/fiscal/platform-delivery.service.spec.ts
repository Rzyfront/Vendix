import { PlatformDeliveryService } from './platform-delivery.service';

describe('PlatformDeliveryService', () => {
  const base = {
    id: 7,
    organization_id: 1,
    source_type: 'platform_invoice',
    document_number: 'FV100',
    dian_status: 'accepted',
    xml_document: '<xml/>',
    cufe: 'abc',
    provider_response: { foo: 'bar' },
    created_at: new Date('2026-10-01T00:00:00Z'),
  };

  function build(transmission: any, email_ok = true, with_org = false) {
    const prisma: any = {
      ...(with_org
        ? {
            organizations: {
              findFirst: jest.fn().mockResolvedValue({
                name: 'Vendix',
                legal_name: 'VENDIX CORP SAS',
                tax_id: '901234567-1',
                email: 'facturacion@vendix.online',
                fiscal_scope: 'STORE',
                organization_settings: null,
              }),
            },
            dian_configurations: {
              findFirst: jest
                .fn()
                .mockResolvedValue({ operation_mode: 'own_software' }),
            },
          }
        : {}),
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue(transmission),
        update: jest.fn().mockResolvedValue({}),
      },
      fiscal_evidences: {
        findMany: jest.fn().mockResolvedValue([
          { metadata: { kind: 'platform_invoice_snapshot', items: [], totals: { total: 10 } } },
          { metadata: { kind: 'platform_acquirer_snapshot', email: 'cli@x.co', legal_name: 'Cli' } },
        ]),
      },
    };
    const email: any = {
      sendEmailWithAttachments: jest
        .fn()
        .mockResolvedValue(email_ok ? { success: true, messageId: 'm1' } : { success: false, error: 'boom' }),
      sendEmail: jest.fn(),
    };
    const pdf: any = { previewPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    const svc = new PlatformDeliveryService(
      { withoutScope: () => prisma } as any,
      { requirePlatformContext: jest.fn().mockResolvedValue({ organization_id: 1 }) } as any,
      email,
      pdf,
    );
    return { svc, prisma, email, pdf };
  }

  it('finds the platform transmission and sends to the snapshot email', async () => {
    const { svc, prisma, email } = build(base);
    const res = await svc.deliverInvoice(7, '', 1);
    expect(prisma.fiscal_transmissions.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 7,
      organization_id: 1,
      source_type: 'platform_invoice',
    });
    expect(email.sendEmailWithAttachments).toHaveBeenCalledTimes(1);
    expect(email.sendEmailWithAttachments.mock.calls[0][0]).toBe('cli@x.co');
    expect(res).toMatchObject({ status: 'sent', recipient: 'cli@x.co', zip_name: 'Factura-FV100.zip' });
    const data = prisma.fiscal_transmissions.update.mock.calls[0][0].data.provider_response;
    expect(data).toMatchObject({ foo: 'bar', delivered_to: 'cli@x.co' });
  });

  it('rejects when the transmission is not accepted by DIAN', async () => {
    const { svc, email } = build({ ...base, dian_status: 'pending' });
    await expect(svc.deliverInvoice(7, 'a@b.co', 1)).rejects.toThrow(/no está aceptada/);
    expect(email.sendEmailWithAttachments).not.toHaveBeenCalled();
  });

  it('rejects when the transmission is not found', async () => {
    const { svc } = build(null);
    await expect(svc.deliverInvoice(7, 'a@b.co', 1)).rejects.toThrow(/no pertenece/);
  });

  it('throws when the provider fails', async () => {
    const { svc, prisma } = build(base, false);
    await expect(svc.deliverInvoice(7, 'a@b.co', 1)).rejects.toThrow(/no pudo enviar/);
    expect(prisma.fiscal_transmissions.update).not.toHaveBeenCalled();
  });

  describe('formato DIAN (2026-10-08)', () => {
    it('asunto DIAN, remitente = emisor plataforma y zip con nombre DIAN', async () => {
      const { svc, email } = build(base, true, true);
      const res = await svc.deliverInvoice(7, '', 1);
      const call = email.sendEmailWithAttachments.mock.calls[0];
      expect(call[1]).toBe('901234567;VENDIX CORP SAS;FV100;01;Vendix');
      expect(call[5]).toEqual({
        name: 'VENDIX CORP SAS',
        email: 'facturacion@vendix.online',
      });
      expect(call[3][0].filename).toBe('z09012345670002600000064.zip');
      expect(res.zip_name).toBe('z09012345670002600000064.zip');
      expect(call[2]).toContain('VENDIX CORP SAS');
    });

    it('sin identidad de plataforma cae a asunto, remitente y zip anteriores', async () => {
      const { svc, email } = build(base);
      const res = await svc.deliverInvoice(7, '', 1);
      const call = email.sendEmailWithAttachments.mock.calls[0];
      expect(call[1]).toBe('Factura FV100 - Vendix');
      expect(call[5]).toBeUndefined();
      expect(res.zip_name).toBe('Factura-FV100.zip');
    });
  });
});
