import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { S3Service } from '@common/services/s3.service';
import { ConsentUpdate } from './interfaces/habeas-data.interface';
import * as crypto from 'crypto';

@Injectable()
export class HabeasDataService {
  private readonly logger = new Logger(HabeasDataService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly event_emitter: EventEmitter2,
    private readonly s3_service: S3Service,
  ) {}

  async getUserConsents(user_id: number) {
    return this.prisma.user_consents.findMany({
      where: { user_id },
      orderBy: { consent_type: 'asc' },
    });
  }

  async updateConsents(
    user_id: number,
    consents: ConsentUpdate[],
    ip: string,
    user_agent: string,
  ) {
    const VALID_CONSENT_TYPES = ['marketing', 'analytics', 'third_party', 'profiling'];

    for (const consent of consents) {
      if (!VALID_CONSENT_TYPES.includes(consent.consent_type)) {
        throw new VendixHttpException(ErrorCodes.HABEAS_CONSENT_INVALID);
      }
    }

    const results: any[] = [];

    for (const consent of consents) {
      const now = new Date();

      const data: any = {
        granted: consent.granted,
        ip_address: ip || null,
        user_agent: user_agent || null,
        updated_at: now,
      };

      if (consent.granted) {
        data.granted_at = now;
        data.revoked_at = null;
      } else {
        data.revoked_at = now;
      }

      const result = await this.prisma.user_consents.upsert({
        where: {
          user_id_consent_type: {
            user_id,
            consent_type: consent.consent_type as any,
          },
        },
        update: data,
        create: {
          user_id,
          consent_type: consent.consent_type as any,
          granted: consent.granted,
          granted_at: consent.granted ? now : null,
          revoked_at: consent.granted ? null : now,
          ip_address: ip || null,
          user_agent: user_agent || null,
        },
      });

      results.push(result);
    }

    // Create audit log entry
    await this.prisma.audit_logs.create({
      data: {
        user_id,
        action: 'consent_updated',
        resource: 'user_consents',
        new_values: {
          consents: consents.map((c) => ({
            consent_type: c.consent_type,
            granted: c.granted,
          })),
          ip_address: ip,
        } as any,
      },
    });

    return results;
  }

  async requestDataExport(user_id: number) {
    // Check rate limit: 1 per 24h
    const twenty_four_hours_ago = new Date();
    twenty_four_hours_ago.setHours(twenty_four_hours_ago.getHours() - 24);

    const recent_request = await this.prisma.data_export_requests.findFirst({
      where: {
        user_id,
        requested_at: { gte: twenty_four_hours_ago },
      },
      orderBy: { requested_at: 'desc' },
    });

    if (recent_request) {
      throw new VendixHttpException(ErrorCodes.HABEAS_EXPORT_RATE_LIMIT);
    }

    // Check if there's already a pending/processing export
    const in_progress = await this.prisma.data_export_requests.findFirst({
      where: {
        user_id,
        status: { in: ['pending', 'processing'] },
      },
    });

    if (in_progress) {
      throw new VendixHttpException(ErrorCodes.HABEAS_EXPORT_PROCESSING);
    }

    // Create export request
    const request = await this.prisma.data_export_requests.create({
      data: {
        user_id,
        status: 'pending',
        requested_at: new Date(),
      },
    });

    // Emit event for async processing (include organization_id)
    const context = RequestContextService.getContext();
    this.event_emitter.emit('habeas-data.export-requested', {
      request_id: request.id,
      user_id,
      organization_id: context?.organization_id,
    });

    this.logger.log(`Data export requested for user ${user_id}, request #${request.id}`);

    return { request_id: request.id, status: request.status };
  }

  async getExportStatus(request_id: number, user_id: number) {
    const request = await this.prisma.data_export_requests.findFirst({
      where: { id: request_id, user_id },
    });

    if (!request) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return {
      request_id: request.id,
      status: request.status,
      file_key: request.file_key || null,
      file_expires_at: request.file_expires_at,
      requested_at: request.requested_at,
      completed_at: request.completed_at,
    };
  }

  async getUserExportRequests(user_id: number) {
    const requests = await this.prisma.data_export_requests.findMany({
      where: { user_id },
      orderBy: { requested_at: 'desc' },
      take: 20,
    });

    return requests.map((r) => ({
      request_id: r.id,
      status: r.status,
      has_file: !!r.file_key,
      file_expires_at: r.file_expires_at,
      requested_at: r.requested_at,
      completed_at: r.completed_at,
      error_message: r.error_message,
    }));
  }

  async getExportDownloadUrl(request_id: number, user_id: number) {
    const request = await this.prisma.data_export_requests.findFirst({
      where: { id: request_id, user_id },
    });

    if (!request) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (request.status !== 'completed' || !request.file_key) {
      throw new VendixHttpException(ErrorCodes.HABEAS_EXPORT_PROCESSING);
    }

    // Check expiration
    if (request.file_expires_at && new Date() > request.file_expires_at) {
      throw new VendixHttpException(ErrorCodes.HABEAS_EXPORT_RATE_LIMIT);
    }

    // Generate presigned URL valid for 24 hours
    const presigned_url = await this.s3_service.getPresignedUrl(
      request.file_key,
      24 * 60 * 60,
    );

    return { download_url: presigned_url };
  }

  async getStats() {
    const [
      total_consents,
      active_marketing,
      total_exports,
      total_anonymizations,
    ] = await Promise.all([
      this.prisma.user_consents.count({
        where: { granted: true },
      }),
      this.prisma.user_consents.count({
        where: { consent_type: 'marketing', granted: true },
      }),
      this.prisma.data_export_requests.count(),
      this.prisma.anonymization_requests.count({
        where: { status: 'executed' },
      }),
    ]);

    return {
      total_consents,
      active_marketing,
      total_exports,
      total_anonymizations,
    };
  }

  async searchUsers(query: string) {
    if (!query || query.length < 2) {
      return [];
    }

    const users = await this.prisma.users.findMany({
      where: {
        OR: [
          { first_name: { contains: query, mode: 'insensitive' } },
          { last_name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { document_number: { contains: query, mode: 'insensitive' } },
        ],
        state: 'active',
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        document_number: true,
        document_type: true,
      },
      take: 20,
      orderBy: { first_name: 'asc' },
    });

    return users;
  }

  async requestAnonymization(
    target_user_id: number,
    admin_user_id: number,
    reason: string,
  ) {
    // Verify admin != target
    if (target_user_id === admin_user_id) {
      throw new VendixHttpException(ErrorCodes.HABEAS_ANON_SELF);
    }

    // Verify target user exists
    const target_user = await this.prisma.users.findUnique({
      where: { id: target_user_id },
    });

    if (!target_user) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    // Verify target not already anonymized
    if (
      target_user.first_name === 'ANONIMIZADO' ||
      target_user.state === 'inactive'
    ) {
      const existing_anon = await this.prisma.anonymization_requests.findFirst({
        where: {
          user_id: target_user_id,
          status: 'executed',
        },
      });

      if (existing_anon) {
        throw new VendixHttpException(ErrorCodes.HABEAS_ANON_ALREADY);
      }
    }

    // Create anonymization request
    const request = await this.prisma.anonymization_requests.create({
      data: {
        user_id: target_user_id,
        requested_by_user_id: admin_user_id,
        reason,
        status: 'pending',
      },
    });

    this.logger.log(
      `Anonymization requested for user ${target_user_id} by admin ${admin_user_id}, request #${request.id}`,
    );

    return { request_id: request.id, status: request.status };
  }

  async executeAnonymization(request_id: number, admin_user_id: number) {
    // Verify request exists and is pending
    const request = await this.prisma.anonymization_requests.findFirst({
      where: { id: request_id },
    });

    if (!request) {
      throw new VendixHttpException(ErrorCodes.HABEAS_ANON_REQUEST_NOT_FOUND);
    }

    if (request.status !== 'pending') {
      throw new VendixHttpException(ErrorCodes.HABEAS_ANON_ALREADY);
    }

    const hash = crypto.randomBytes(8).toString('hex');

    await this.prisma.$transaction(async (tx: any) => {
      // 1. Anonymize user data
      await tx.users.update({
        where: { id: request.user_id },
        data: {
          first_name: 'ANONIMIZADO',
          last_name: hash,
          email: `anon-${hash}@deleted.local`,
          phone: null,
          document_number: `ANON-${hash}`,
          state: 'inactive',
        },
      });

      // 2. Revoke all consents
      await tx.user_consents.updateMany({
        where: { user_id: request.user_id },
        data: {
          granted: false,
          revoked_at: new Date(),
        },
      });

      // 3. Create audit log
      await tx.audit_logs.create({
        data: {
          user_id: admin_user_id,
          action: 'anonymization_executed',
          resource: 'users',
          resource_id: request.user_id,
          new_values: {
            target_user_id: request.user_id,
            request_id: request_id,
            hash,
          } as any,
        },
      });

      // 4. Update request status
      await tx.anonymization_requests.update({
        where: { id: request_id },
        data: {
          status: 'executed',
          anonymized_at: new Date(),
          original_data_hash: hash,
        },
      });
    });

    this.logger.warn(
      `Anonymization executed for user ${request.user_id}, request #${request_id} by admin ${admin_user_id}`,
    );

    return { request_id, status: 'executed' };
  }
}
