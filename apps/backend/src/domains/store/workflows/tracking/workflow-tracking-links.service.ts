import { createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { EmailService } from '../../../../email/email.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { publicStoreOrigin } from '../public-link/workflow-public-link.rules';

/** Life of the magic link of an external requester. */
export const TRACKING_LINK_TTL_DAYS = 90;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreateTrackingLinkInput {
  store_id: number;
  organization_id: number;
  instance_id: number;
  reference: string;
  flow_name: string;
  contact_name: string | null;
  contact_email: string | null;
  /** The e-mail is sent only for a fresh submission, never for a replay. */
  send_email: boolean;
}

export type TrackingLinkState = 'active' | 'revoked' | 'expired';

/**
 * Magic link of the external requester (P3.5). Only the sha256 of the token is
 * stored; the raw token travels once in the submit response and the e-mail.
 * Admin side (list / revoke) is store scoped like the rest of Flujos.
 */
@Injectable()
export class WorkflowTrackingLinksService {
  private readonly logger = new Logger(WorkflowTrackingLinksService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly email: EmailService,
  ) {}

  /** Public URL of the tracking page on the store domain, or null without a domain. */
  async urlFor(storeId: number, token: string): Promise<string | null> {
    const origin = await publicStoreOrigin(this.prisma.withoutScope() as never, storeId);
    return origin ? `${origin}/flujos/seguimiento/${token}` : null;
  }

  /**
   * Creates the link and mails it to the contact. Never throws: the request is
   * already created and the submit must not fail because of the follow-up.
   * Returns `tracking_url: null` when the store has no public domain.
   */
  async createForSubmit(input: CreateTrackingLinkInput): Promise<{ tracking_url: string | null }> {
    try {
      const token = randomBytes(32).toString('base64url');
      const url = await this.urlFor(input.store_id, token);
      if (!url) return { tracking_url: null };
      await this.prisma.withoutScope().workflow_tracking_links.create({
        data: {
          organization_id: input.organization_id,
          store_id: input.store_id,
          instance_id: input.instance_id,
          token_hash: hashTrackingToken(token),
          contact_name: input.contact_name?.slice(0, 160) ?? null,
          contact_email: input.contact_email?.slice(0, 200) ?? null,
          expires_at: new Date(Date.now() + TRACKING_LINK_TTL_DAYS * 86_400_000),
        },
      });
      if (input.send_email && input.contact_email) {
        await this.sendEmail(input, url);
      }
      return { tracking_url: url };
    } catch (e) {
      this.logger.warn(`Tracking link of instance ${input.instance_id} failed: ${(e as Error)?.message}`);
      return { tracking_url: null };
    }
  }

  private async sendEmail(input: CreateTrackingLinkInput, url: string): Promise<void> {
    try {
      const greeting = input.contact_name ? `Hola ${escapeHtml(input.contact_name)},` : 'Hola,';
      const message = `Recibimos tu solicitud ${input.reference} (${input.flow_name}). Con este enlace puedes ver en qué va y enviar lo que falte.`;
      const result = await this.email.sendEmail(
        input.contact_email as string,
        `Sigue tu solicitud ${input.reference}`,
        `<p>${greeting}</p><p>${escapeHtml(message)}</p><p><a href="${url}">Ver el seguimiento</a></p>`,
        `${message}\n\n${url}`,
      );
      if (!result.success) {
        this.logger.warn(`Tracking e-mail of instance ${input.instance_id} failed: ${result.error}`);
      }
    } catch (e) {
      this.logger.warn(`Tracking e-mail of instance ${input.instance_id} threw: ${(e as Error)?.message}`);
    }
  }

  // ---- admin -------------------------------------------------------------

  async list(instanceId: number) {
    const storeId = this.storeId();
    await this.assertInstance(storeId, instanceId);
    const rows = await this.prisma.workflow_tracking_links.findMany({
      where: { store_id: storeId, instance_id: instanceId },
      orderBy: { id: 'desc' },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      contact_name: r.contact_name,
      contact_email: r.contact_email,
      created_at: r.created_at,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
      last_used_at: r.last_used_at,
      state: (r.revoked_at
        ? 'revoked'
        : new Date(r.expires_at).getTime() <= now
          ? 'expired'
          : 'active') as TrackingLinkState,
    }));
  }

  async revoke(instanceId: number, linkId: number) {
    const storeId = this.storeId();
    await this.assertInstance(storeId, instanceId);
    const link = await this.prisma.workflow_tracking_links.findFirst({
      where: { id: linkId, store_id: storeId, instance_id: instanceId },
      select: { id: true, revoked_at: true },
    });
    if (!link) throw new VendixHttpException(ErrorCodes.WORKFLOW_TRACKING_LINK_NOT_FOUND);
    if (!link.revoked_at) {
      await this.prisma.workflow_tracking_links.updateMany({
        where: { id: linkId, store_id: storeId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    }
    return { id: linkId, revoked: true };
  }

  private storeId(): number {
    const id = RequestContextService.getStoreId();
    if (!id) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    return id;
  }

  private async assertInstance(storeId: number, instanceId: number) {
    const instance = await this.prisma.workflow_instances.findFirst({
      where: { id: instanceId, store_id: storeId },
      select: { id: true },
    });
    if (!instance) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
  }
}
