import { BadRequestException } from '@nestjs/common';
import { RequestContext, RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ServiceRemindersService } from './service-reminders.service';

describe('ServiceRemindersService — envío (punto 7 review)', () => {
  const context: RequestContext = { store_id: 1, is_super_admin: false, is_owner: false };
  let service: ServiceRemindersService;
  let prisma: Record<string, any>;
  let email: { sendEmail: jest.Mock };

  const ctx: any = {
    row: {
      customer: { name: 'Ana', email: 'ana@test.com', phone: '3001234567' },
      service: { name: 'Corte', recurrence_interval_days: 30 },
      service_date: new Date('2026-09-01T00:00:00.000Z'),
      days_since: 30,
    },
    subjectPhrase: null,
    storeName: 'Tienda',
    tz: 'America/Bogota',
  };

  beforeEach(() => {
    prisma = {
      service_reminder_logs: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    email = { sendEmail: jest.fn() };
    service = new ServiceRemindersService(
      prisma as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      email as any,
    );
    jest.spyOn(service as any, 'contextForLog').mockResolvedValue(ctx);
  });

  it('generar el enlace de WhatsApp no marca el recordatorio como enviado', async () => {
    const result = await RequestContextService.runIsolated(context, () => service.whatsappLink(9));
    expect(result.url).toContain('https://wa.me/573001234567?text=');
    expect(prisma.service_reminder_logs.updateMany).not.toHaveBeenCalled();
  });

  it('marca enviado cuando el correo se entrega (success)', async () => {
    email.sendEmail.mockResolvedValue({ success: true });
    const result = await RequestContextService.runIsolated(context, () => service.sendEmail(9));
    expect(result.success).toBe(true);
    expect(prisma.service_reminder_logs.updateMany).toHaveBeenCalledWith({
      where: { id: 9, store_id: 1 },
      data: { status: 'sent', channel: 'email', sent_at: expect.any(Date) },
    });
  });

  it('no marca enviado y lanza cuando el proveedor rechaza el correo', async () => {
    email.sendEmail.mockResolvedValue({ success: false, error: 'quota' });
    await expect(RequestContextService.runIsolated(context, () => service.sendEmail(9))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.service_reminder_logs.updateMany).not.toHaveBeenCalled();
  });
});
