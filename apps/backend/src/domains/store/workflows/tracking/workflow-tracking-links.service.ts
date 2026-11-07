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
   * Returns `tracking_url: null` when the store has no public domain. A replay
   * of the same submit replaces the previous link: one active link per request.
   */
  async createForSubmit(input: CreateTrackingLinkInput): Promise<{ tracking_url: string | null }> {
    try {
      const issued = await this.issue(input);
      if (!issued) return { tracking_url: null };
      if (input.send_email && input.contact_email) {
        await this.sendEmail(input, issued.url);
      }
      return { tracking_url: issued.url };
    } catch (e) {
      this.logger.warn(`Tracking link of instance ${input.instance_id} failed: ${(e as Error)?.message}`);
      return { tracking_url: null };
    }
  }

  /** Revokes every active link of the request and stores a fresh one (sha256 only). */
  private async issue(input: CreateTrackingLinkInput) {
    const token = randomBytes(32).toString('base64url');
    const url = await this.urlFor(input.store_id, token);
    if (!url) return null;
    const db = this.prisma.withoutScope();
    await db.workflow_tracking_links.updateMany({
      where: { store_id: input.store_id, instance_id: input.instance_id, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    const link = await db.workflow_tracking_links.create({
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
    return { url, link };
  }

  /**
   * Admin action: revokes the active links of the request, creates a new one and
   * mails it to `email`. Fails loudly (nothing is reported as sent) when the store
   * has no public domain or the e-mail is not delivered.
   */
  async reissue(instanceId: number, email: string) {
    const storeId = this.storeId();
    const instance = await this.prisma.workflow_instances.findFirst({
      where: { id: instanceId, store_id: storeId },
      select: { id: true, organization_id: true, reference: true, version_id: true },
    });
    if (!instance) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    const db = this.prisma.withoutScope();
    const version = await db.workflow_versions.findFirst({
      where: { id: instance.version_id, store_id: storeId },
      select: { definition: true },
    });
    const previous = await db.workflow_tracking_links.findFirst({
      where: { store_id: storeId, instance_id: instanceId },
      orderBy: { id: 'desc' },
      select: { contact_name: true },
    });
    const input: CreateTrackingLinkInput = {
      store_id: storeId,
      organization_id: instance.organization_id,
      instance_id: instanceId,
      reference: instance.reference,
      flow_name: (version?.definition as { name?: string } | null)?.name ?? '',
      contact_name: previous?.contact_name ?? null,
      contact_email: email,
      send_email: true,
    };
    const issued = await this.issue(input);
    if (!issued) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La tienda no tiene un dominio público para generar el enlace.',
      );
    }
    if (!(await this.sendEmail(input, issued.url))) {
      throw new VendixHttpException(
        ErrorCodes.EMAIL_RECEPTION_UNAVAILABLE,
        'No se pudo enviar el correo. El enlace nuevo quedó creado; vuelve a intentarlo.',
      );
    }
    return this.toRow(issued.link);
  }

  private async sendEmail(input: CreateTrackingLinkInput, url: string): Promise<boolean> {
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
      return result.success;
    } catch (e) {
      this.logger.warn(`Tracking e-mail of instance ${input.instance_id} threw: ${(e as Error)?.message}`);
      return false;
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
    return rows.map((r) => this.toRow(r));
  }

  private toRow(r: {
    id: number;
    contact_name: string | null;
    contact_email: string | null;
    created_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
    last_used_at: Date | null;
  }) {
    return {
      id: r.id,
      contact_name: r.contact_name,
      contact_email: r.contact_email,
      created_at: r.created_at,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
      last_used_at: r.last_used_at,
      state: (r.revoked_at
        ? 'revoked'
        : new Date(r.expires_at).getTime() <= Date.now()
          ? 'expired'
          : 'active') as TrackingLinkState,
    };
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
