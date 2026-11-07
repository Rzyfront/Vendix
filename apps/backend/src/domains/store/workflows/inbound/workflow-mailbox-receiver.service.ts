import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DocumentEmailMimeService } from '../../../received-documents/services/document-email-mime.service';
import { DossiersService } from '../../documents/dossiers.service';
import { StoredFilesService } from '../../documents/stored-files.service';
import { WorkflowEngineService } from '../engine/workflow-engine.service';
import { WorkflowInstanceRow } from '../engine/workflow-engine.types';
import { WorkflowEventsService } from '../engine/workflow-events.service';
import { storeAllowsFlows } from '../engine/workflow-industry';
import {
  MAILBOX_ALIAS,
  MAILBOX_ATTACHMENT_MAX_BYTES,
  MAILBOX_TEXT_MAX,
  displayNameOf,
} from './workflow-inbound.rules';
import type {
  WorkflowMailboxDelivery,
  WorkflowMailboxOutcome,
  WorkflowMailboxReceiver,
} from './workflow-mailbox.types';

const SYSTEM = { type: 'system' as const, id: null };

/**
 * Turns a mail delivered to `flujos-<hex>@…` into a request of the mailbox's
 * flow (actor `system`) and files its attachments in the request dossier.
 * Dedupes by SES message id; a bad mail is recorded as `rejected`, never thrown.
 */
@Injectable()
export class WorkflowMailboxReceiverService implements WorkflowMailboxReceiver {
  private readonly logger = new Logger(WorkflowMailboxReceiverService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly engine: WorkflowEngineService,
    private readonly files: StoredFilesService,
    private readonly dossiers: DossiersService,
    private readonly events: WorkflowEventsService,
    private readonly mime: DocumentEmailMimeService,
  ) {}

  async receive(delivery: WorkflowMailboxDelivery): Promise<WorkflowMailboxOutcome> {
    const alias = MAILBOX_ALIAS.exec(delivery.recipient);
    if (!alias) return { status: 'ignored' };
    const db = this.prisma.withoutScope();
    const box = await db.workflow_mailboxes.findFirst({
      where: { local_part: alias[1], domain: alias[2] },
    });
    // An unknown address owns no tenant: nothing to record.
    if (!box) return { status: 'ignored' };

    try {
      return await RequestContextService.runIsolated(
        {
          store_id: box.store_id,
          organization_id: box.organization_id,
          is_super_admin: false,
          is_owner: false,
        },
        () => this.receiveInStore(box, delivery),
      );
    } catch (e) {
      this.logger.warn(`Mailbox ${box.id}: mail could not be processed.`);
      await this.record(box, delivery, { status: 'rejected', error: this.describe(e) });
      return { status: 'rejected' };
    }
  }

  private async receiveInStore(
    box: { id: number; store_id: number; definition_id: number; is_active: boolean },
    delivery: WorkflowMailboxDelivery,
  ): Promise<WorkflowMailboxOutcome> {
    const seen = await this.prisma.workflow_mailbox_messages.findFirst({
      where: { store_id: box.store_id, mailbox_id: box.id, message_id: delivery.ses_message_id },
      select: { id: true },
    });
    if (seen) return { status: 'duplicate' };

    const reject = async (error: string): Promise<WorkflowMailboxOutcome> => {
      await this.record(box, delivery, { status: 'rejected', error });
      return { status: 'rejected' };
    };
    if (!box.is_active) return reject('MAILBOX_INACTIVE');
    if (delivery.facts.virus_status !== 'PASS') return reject('VIRUS_SCAN_NOT_PASSED');
    if (delivery.facts.spam_status === 'FAIL') return reject('SPAM_BLOCKED');
    if (!(await storeAllowsFlows(this.prisma.withoutScope() as never, box.store_id))) {
      return reject('FLOWS_NOT_AVAILABLE');
    }

    const raw = await delivery.openRaw();
    const mail = await this.mime.parse(raw, delivery.signal);
    const result = await this.engine.startExternal({
      definitionId: box.definition_id,
      kind: 'email',
      context: {
        subject: mail.subject,
        from: mail.sender,
        from_name: displayNameOf(delivery.from_header),
        text: mail.text.slice(0, MAILBOX_TEXT_MAX),
      },
      idempotencyKey: `${box.id}:${delivery.ses_message_id}`,
      started: { mailbox_id: box.id },
    });

    // A replayed start already filed its attachments the first time.
    if (!result.replayed) {
      await this.fileAttachments(result.instance, mail.parts);
    }
    await this.record(box, delivery, {
      status: 'accepted',
      instance_id: result.instance.id,
      subject: mail.subject,
      from_email: mail.sender,
    });
    await this.prisma.workflow_mailboxes.updateMany({
      where: { id: box.id, store_id: box.store_id },
      data: { last_received_at: new Date() },
    });
    return { status: 'accepted', instance_id: result.instance.id };
  }

  /** Attachments ≤ 25 MB go to the dossier; the rest are skipped and noted in the timeline. */
  private async fileAttachments(
    instance: WorkflowInstanceRow,
    parts: Array<{ filename: string; content_type: string; bytes: Buffer }>,
  ) {
    const stored: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    for (const [index, part] of parts.entries()) {
      if (part.bytes.length > MAILBOX_ATTACHMENT_MAX_BYTES) {
        skipped.push({ name: part.filename, reason: 'TOO_LARGE' });
        continue;
      }
      let file: Awaited<ReturnType<StoredFilesService['upload']>>;
      try {
        file = await this.files.upload({
          buffer: part.bytes,
          originalName: part.filename,
          mimeType: part.content_type,
          source: 'public_form',
          folder: `workflows/${instance.id}`,
          actor: SYSTEM,
        });
      } catch (e) {
        skipped.push({ name: part.filename, reason: this.reason(e) });
        continue;
      }
      try {
        await this.prisma.$transaction(async (tx: any) => {
          const dossier =
            (await this.dossiers.getByInstance(instance.id, tx)) ??
            (await this.dossiers.createForInstance(tx, instance));
          await this.dossiers.addFileItem(tx, {
            dossier_id: dossier.id,
            file_id: file.id,
            stage_key: instance.current_stage_key,
            // One slot per attachment: a shared key would supersede the previous file.
            requirement_key: `email_attachment_${index + 1}`,
            actor: SYSTEM,
          });
        });
        stored.push(part.filename);
      } catch (e) {
        await this.files.discard(file);
        skipped.push({ name: part.filename, reason: this.reason(e) });
      }
    }
    await this.prisma.$transaction(async (tx: any) => {
      await this.events.lockInstance(tx, instance.store_id, instance.id);
      await this.events.append(tx, {
        store_id: instance.store_id,
        instance_id: instance.id,
        type: 'email_received',
        actor: SYSTEM,
        payload: { attachments: stored, skipped },
      });
    });
  }

  private async record(
    box: { id: number; store_id: number },
    delivery: WorkflowMailboxDelivery,
    row: {
      status: 'accepted' | 'rejected';
      instance_id?: number;
      error?: string;
      subject?: string;
      from_email?: string;
    },
  ) {
    try {
      await this.prisma.withoutScope().workflow_mailbox_messages.create({
        data: {
          store_id: box.store_id,
          mailbox_id: box.id,
          message_id: delivery.ses_message_id,
          status: row.status,
          instance_id: row.instance_id,
          error: row.error?.slice(0, 500),
          subject: row.subject?.slice(0, 300),
          from_email: row.from_email?.slice(0, 255),
        },
      });
    } catch (e) {
      // The unique (mailbox, message) makes a concurrent duplicate harmless.
      if ((e as { code?: string })?.code !== 'P2002') {
        this.logger.error(`Mailbox ${box.id}: could not record a received mail.`);
      }
    }
  }

  private reason(e: unknown): string {
    return e instanceof VendixHttpException ? e.errorCode : 'ATTACHMENT_NOT_STORED';
  }

  private describe(e: unknown): string {
    if (e instanceof VendixHttpException) return `${e.errorCode}: ${e.message}`;
    const reason = (e as { response?: { reason_code?: string } })?.response?.reason_code;
    return reason ?? 'MAIL_NOT_PROCESSED';
  }
}
