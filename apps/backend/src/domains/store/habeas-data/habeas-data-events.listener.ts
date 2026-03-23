import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { EmailService } from '../../../email/email.service';

@Injectable()
export class HabeasDataEventsListener {
  private readonly logger = new Logger(HabeasDataEventsListener.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly s3_service: S3Service,
    private readonly email_service: EmailService,
  ) {}

  @OnEvent('habeas-data.export-requested')
  async handleExportRequested(payload: {
    request_id: number;
    user_id: number;
    organization_id?: number;
  }) {
    const { request_id, user_id, organization_id } = payload;

    this.logger.log(`Processing data export for user ${user_id}, request #${request_id}`);

    try {
      // Update status to processing
      await this.prisma.data_export_requests.update({
        where: { id: request_id },
        data: { status: 'processing' },
      });

      // Gather user data
      const user = await this.prisma.users.findUnique({
        where: { id: user_id },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
          document_type: true,
          document_number: true,
          state: true,
          created_at: true,
          updated_at: true,
        },
      });

      const consents = await this.prisma.user_consents.findMany({
        where: { user_id },
      });

      const orders = await this.prisma.orders.findMany({
        where: { customer_id: user_id },
        select: {
          id: true,
          order_number: true,
          state: true,
          grand_total: true,
          created_at: true,
        },
        take: 1000,
      });

      const payments = await this.prisma.payments.findMany({
        where: { orders: { customer_id: user_id } },
        select: {
          id: true,
          amount: true,
          state: true,
          created_at: true,
        },
        take: 1000,
      });

      const document_acceptances = await this.prisma.document_acceptances.findMany({
        where: { user_id },
        select: {
          id: true,
          accepted_at: true,
          ip_address: true,
          acceptance_version: true,
          document: {
            select: {
              title: true,
              document_type: true,
              version: true,
            },
          },
        },
      });

      const sessions = await this.prisma.user_sessions.findMany({
        where: { user_id },
        select: {
          id: true,
          ip_address: true,
          user_agent: true,
          created_at: true,
          expires_at: true,
        },
        take: 100,
        orderBy: { created_at: 'desc' },
      });

      // Build export data
      const export_data = {
        export_metadata: {
          generated_at: new Date().toISOString(),
          request_id,
          user_id,
          format: 'JSON',
          regulation: 'Ley 1581 de 2012 - Habeas Data (Colombia)',
        },
        personal_data: user,
        consents,
        orders: {
          total_count: orders.length,
          records: orders,
        },
        payments: {
          total_count: payments.length,
          records: payments,
        },
        document_acceptances,
        sessions: {
          total_count: sessions.length,
          records: sessions,
        },
      };

      // Upload to S3
      const json_buffer = Buffer.from(JSON.stringify(export_data, null, 2), 'utf-8');
      const date_str = new Date().toISOString().split('T')[0];
      const org_id = organization_id || 0;
      const s3_key = `organizations/${org_id}/data-exports/${request_id}/export-${date_str}.json`;

      await this.s3_service.uploadFile(json_buffer, s3_key, 'application/json');

      const expires_at = new Date();
      expires_at.setHours(expires_at.getHours() + 48);

      await this.prisma.data_export_requests.update({
        where: { id: request_id },
        data: {
          status: 'completed',
          file_key: s3_key,
          file_expires_at: expires_at,
          completed_at: new Date(),
        },
      });

      this.logger.log(`Data export completed for user ${user_id}, request #${request_id}, key: ${s3_key}`);

      // Send email notification
      if (user?.email) {
        const user_name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
        await this.email_service.sendEmail(
          user.email,
          'Tu exportacion de datos esta lista',
          `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Exportacion de datos completada</h2>
              <p>Hola ${user_name || 'usuario'},</p>
              <p>Tu solicitud de exportacion de datos personales (solicitud #${request_id}) ha sido procesada exitosamente.</p>
              <p>Puedes descargar tu archivo desde la seccion de <strong>Habeas Data</strong> en tu panel de administracion.</p>
              <p style="color: #666; font-size: 13px;">El enlace de descarga estara disponible por 48 horas.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px;">
                Este correo fue enviado en cumplimiento de la Ley 1581 de 2012 (Habeas Data).
              </p>
            </div>
          `,
        );
      }
    } catch (error) {
      this.logger.error(
        `Data export failed for user ${user_id}, request #${request_id}`,
        error,
      );

      await this.prisma.data_export_requests.update({
        where: { id: request_id },
        data: {
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }
}
