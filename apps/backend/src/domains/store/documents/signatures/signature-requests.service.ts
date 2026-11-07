import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { hashTrackingToken } from '../../workflows/tracking/workflow-tracking-links.service';
import { StoredFilesService } from '../stored-files.service';
import { CreateSignatureRequestDto } from './dto/signature.dto';
import { SignatureDeliveryService, EMAIL_PATTERN } from './signature-delivery.service';
import { SignatureEvidenceService, verifyEvidenceChain } from './signature-evidence.service';
import { SignatureFlowNotifier } from './signature-flow.notifier';
import { SignatureSealService } from './signature-seal.service';
import {
  CONSENT_TEXT,
  CONSENT_TEXT_VERSION,
  MAX_SIGNERS,
  OPEN_REQUEST_STATUSES,
  SIGNATURE_TTL_DAYS,
  maskDestination,
} from './signature.constants';

type Actor = { type: 'user' | 'system'; id: number | null };

const DOCUMENT_STATUS_TEXT: Record<string, string> = {
  rendering: 'se está generando',
  failed: 'falló al generarse',
  pending_signature: 'ya está pendiente de firma',
  signed: 'ya está firmado',
  voided: 'fue anulado',
  superseded: 'fue reemplazado por otra emisión',
};

/** Creates, cancels, expires and reads signature requests of issued documents. */
@Injectable()
export class SignatureRequestsService {
  private readonly logger = new Logger(SignatureRequestsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly evidence: SignatureEvidenceService,
    private readonly delivery: SignatureDeliveryService,
    private readonly flow: SignatureFlowNotifier,
    private readonly seal: SignatureSealService,
    private readonly files: StoredFilesService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id };
  }

  // ---- create ------------------------------------------------------------

  async create(input: CreateSignatureRequestDto, actor: Actor) {
    const c = this.ctx();
    const signers = this.normalizeSigners(input.signers);
    const document = await this.prisma.issued_documents.findFirst({
      where: { id: input.issued_document_id, store_id: c.store_id },
    });
    if (!document) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    if (document.status !== 'issued' || !document.pdf_sha256) {
      throw new VendixHttpException(
        ErrorCodes.SIGNATURE_DOCUMENT_NOT_SIGNABLE,
        `Solo se puede enviar a firmar un documento emitido; ${document.reference} ${DOCUMENT_STATUS_TEXT[document.status] ?? `está en estado ${document.status}`}.`,
      );
    }
    await this.delivery.assertPublicDomain(c.store_id);
    if (signers.some((s) => s.method === 'otp_whatsapp')) {
      await this.delivery.assertWhatsappChannel(c.store_id);
    }

    const tokens = signers.map(() => randomBytes(32).toString('base64url'));
    const expiresAt = new Date(Date.now() + SIGNATURE_TTL_DAYS * 86_400_000);
    const created = await this.prisma.$transaction(async (tx: any) => {
      const flipped = await tx.issued_documents.updateMany({
        where: { id: document.id, store_id: c.store_id, status: 'issued' },
        data: { status: 'pending_signature' },
      });
      if (flipped.count === 0) {
        throw new VendixHttpException(
          ErrorCodes.SIGNATURE_DOCUMENT_NOT_SIGNABLE,
          `Solo se puede enviar a firmar un documento emitido; ${document.reference} ya no lo está.`,
        );
      }
      const request = await tx.signature_requests.create({
        data: {
          organization_id: c.organization_id,
          store_id: c.store_id,
          issued_document_id: document.id,
          document_sha256: document.pdf_sha256,
          status: 'pending',
          expires_at: expiresAt,
          consent_text: CONSENT_TEXT,
          consent_text_version: CONSENT_TEXT_VERSION,
          created_by_type: actor.type,
          created_by_id: actor.id,
        },
      });
      const rows: any[] = [];
      for (let i = 0; i < signers.length; i++) {
        rows.push(
          await tx.signature_signers.create({
            data: {
              store_id: c.store_id,
              request_id: request.id,
              order: i + 1,
              ...signers[i],
              token_hash: hashTrackingToken(tokens[i]),
            },
          }),
        );
      }
      await this.evidence.append(tx, {
        request_id: request.id,
        type: 'created',
        payload: {
          issued_document_id: document.id,
          document_sha256: document.pdf_sha256,
          consent_text_version: CONSENT_TEXT_VERSION,
          signers: rows.map((s) => ({ id: s.id, name: s.name, method: s.method })),
          expires_at: expiresAt.toISOString(),
        },
      });
      await this.flow.notify(tx, c.store_id, document.workflow_instance_id, {
        type: 'signature_requested',
        payload: {
          label: 'Documento enviado a firmar',
          document_reference: document.reference,
          signers: rows.length,
        },
      });
      return { request, rows };
    });

    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: c.store_id },
      select: { name: true },
    });
    for (let i = 0; i < created.rows.length; i++) {
      const signer = created.rows[i];
      try {
        await this.delivery.sendLink(signer, {
          store_id: c.store_id,
          store_name: store?.name ?? '',
          document_title: document.title,
          url: await this.delivery.linkUrl(c.store_id, tokens[i]),
          expires_at: expiresAt,
        });
        await this.prisma.$transaction((tx: any) =>
          this.evidence.append(tx, {
            request_id: created.request.id,
            signer_id: signer.id,
            type: 'sent',
            payload: { method: signer.method, destination: maskDestination(signer.method, signer.email, signer.phone) },
          }),
        );
      } catch (e) {
        await this.cancel(created.request.id, `No se pudo enviar el enlace a ${signer.name}.`).catch((err) =>
          this.logger.warn(`Could not cancel request ${created.request.id}: ${(err as Error)?.message}`),
        );
        throw e;
      }
    }
    return this.get(created.request.id);
  }

  private normalizeSigners(raw: CreateSignatureRequestDto['signers']) {
    const bad = (message: string) =>
      new VendixHttpException(ErrorCodes.SIGNATURE_SIGNER_INVALID, message);
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SIGNERS) {
      throw bad(`Indica entre 1 y ${MAX_SIGNERS} firmantes.`);
    }
    const slots = new Set<string>();
    return raw.map((s) => {
      const name = (s.name ?? '').trim();
      if (name.length < 2) throw bad('Cada firmante necesita su nombre.');
      const email = s.email?.trim() || null;
      const phoneRaw = s.phone?.trim() || null;
      if (s.method === 'otp_email') {
        if (!email || !EMAIL_PATTERN.test(email)) {
          throw bad(`${name}: indica un correo válido para enviarle el código.`);
        }
      } else if (s.method === 'otp_whatsapp') {
        if (!phoneRaw) throw bad(`${name}: indica el celular para enviarle el código por WhatsApp.`);
      } else {
        throw bad(`${name}: el método debe ser correo o WhatsApp.`);
      }
      const slot = s.slot_key?.trim() || null;
      if (slot) {
        if (slots.has(slot)) throw bad(`La casilla de firma "${slot}" está asignada a dos firmantes.`);
        slots.add(slot);
      }
      return {
        name,
        document_number: s.document_number?.trim() || null,
        email,
        phone: phoneRaw ? this.delivery.phoneOf(phoneRaw) : null,
        role_label: s.role_label?.trim() || null,
        slot_key: slot,
        method: s.method,
      };
    });
  }

  // ---- cancel / expire ---------------------------------------------------

  async cancel(requestId: number, reason: string) {
    const c = this.ctx();
    const text = (reason ?? '').trim();
    if (text.length < 3) {
      throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001, 'Escribe el motivo de la cancelación.');
    }
    await this.prisma.$transaction(async (tx: any) => {
      await this.evidence.lock(tx, requestId);
      const request = await tx.signature_requests.findFirst({
        where: { id: requestId, store_id: c.store_id },
      });
      if (!request) throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_NOT_FOUND);
      if (!OPEN_REQUEST_STATUSES.includes(request.status)) {
        throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_CLOSED);
      }
      await this.close(tx, request, 'cancelled', 'cancelled', text.slice(0, 500));
    });
    return this.get(requestId);
  }

  /** Expires the requests whose link life is over. Returns how many closed. */
  async expireDue(now: Date): Promise<number> {
    const c = this.ctx();
    const due: Array<{ id: number }> = await this.prisma.signature_requests.findMany({
      where: { store_id: c.store_id, status: { in: [...OPEN_REQUEST_STATUSES] }, expires_at: { lte: now } },
      select: { id: true },
      take: 200,
    });
    let closed = 0;
    for (const { id } of due) {
      try {
        const done = await this.prisma.$transaction(async (tx: any) => {
          await this.evidence.lock(tx, id);
          const request = await tx.signature_requests.findFirst({ where: { id, store_id: c.store_id } });
          if (!request || !OPEN_REQUEST_STATUSES.includes(request.status)) return false;
          const signers: Array<{ status: string }> = await tx.signature_signers.findMany({
            where: { request_id: id, store_id: c.store_id },
            select: { status: true },
          });
          // Everyone signed and only the seal is missing: the seal retry finishes it.
          if (signers.length > 0 && signers.every((s) => s.status === 'signed')) return false;
          await this.close(tx, request, 'expired', 'expired', null);
          return true;
        });
        if (done) closed += 1;
      } catch (e) {
        this.logger.warn(`Signature request ${id} could not expire: ${(e as Error)?.message}`);
      }
    }
    return closed;
  }

  /** Seals the requests whose signers all signed but the seal failed earlier. */
  async sealPending(): Promise<number> {
    const c = this.ctx();
    const rows: Array<{ id: number }> = await this.prisma.signature_requests.findMany({
      where: { store_id: c.store_id, status: 'partially_signed' },
      select: { id: true },
      take: 50,
    });
    let sealed = 0;
    for (const { id } of rows) {
      try {
        if (await this.seal.seal(id)) sealed += 1;
      } catch (e) {
        this.logger.warn(`Seal of request ${id} failed again: ${(e as Error)?.message}`);
      }
    }
    return sealed;
  }

  /** Closes an open request (cancel / expire) and gives the document back. */
  private async close(
    tx: any,
    request: { id: number; store_id: number; issued_document_id: number },
    status: 'cancelled' | 'expired',
    evidenceType: 'cancelled' | 'expired',
    reason: string | null,
  ) {
    const now = new Date();
    await tx.signature_requests.updateMany({
      where: { id: request.id, store_id: request.store_id },
      data: { status, ...(status === 'cancelled' ? { cancelled_at: now } : {}) },
    });
    await tx.signature_signers.updateMany({
      where: { request_id: request.id, store_id: request.store_id, status: { in: ['pending', 'viewed'] } },
      data: { status: 'expired' },
    });
    await tx.issued_documents.updateMany({
      where: { id: request.issued_document_id, store_id: request.store_id, status: 'pending_signature' },
      data: { status: 'issued' },
    });
    await this.evidence.append(tx, {
      request_id: request.id,
      type: evidenceType,
      payload: reason ? { reason } : {},
    });
    const document = await tx.issued_documents.findFirst({
      where: { id: request.issued_document_id, store_id: request.store_id },
      select: { reference: true, workflow_instance_id: true },
    });
    await this.flow.notify(tx, request.store_id, document?.workflow_instance_id ?? null, {
      type: status === 'cancelled' ? 'signature_cancelled' : 'signature_expired',
      payload: {
        label: status === 'cancelled' ? `Firma cancelada: ${reason}` : 'La solicitud de firma venció',
        document_reference: document?.reference ?? null,
      },
    });
  }

  // ---- read --------------------------------------------------------------

  async get(requestId: number) {
    const c = this.ctx();
    const request = await this.prisma.signature_requests.findFirst({
      where: { id: requestId, store_id: c.store_id },
    });
    if (!request) throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_NOT_FOUND);
    return (await this.present([request]))[0];
  }

  /** Issued documents of a workflow request with their signature requests and evidence. */
  async listByInstance(instanceId: number) {
    const c = this.ctx();
    const documents: any[] = await this.prisma.issued_documents.findMany({
      where: { workflow_instance_id: instanceId, store_id: c.store_id, status: { notIn: ['superseded', 'voided'] } },
      orderBy: { id: 'asc' },
    });
    const requests: any[] = documents.length
      ? await this.prisma.signature_requests.findMany({
          where: { store_id: c.store_id, issued_document_id: { in: documents.map((d) => d.id) } },
          orderBy: { id: 'desc' },
        })
      : [];
    const presented = await this.present(requests);
    return documents.map((d) => ({
      id: d.id,
      reference: d.reference,
      title: d.title,
      status: d.status,
      requirement_key: d.requirement_key,
      issued_at: d.issued_at,
      requests: presented.filter((r) => r.issued_document_id === d.id),
    }));
  }

  async sealedDownload(requestId: number) {
    const c = this.ctx();
    const request = await this.prisma.signature_requests.findFirst({
      where: { id: requestId, store_id: c.store_id },
      select: { sealed_file_id: true },
    });
    if (!request) throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_NOT_FOUND);
    if (!request.sealed_file_id) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    return this.files.signedDownloadUrl(request.sealed_file_id);
  }

  private async present(requests: any[]) {
    if (requests.length === 0) return [];
    const c = this.ctx();
    const ids = requests.map((r) => r.id);
    const signers: any[] = await this.prisma.signature_signers.findMany({
      where: { store_id: c.store_id, request_id: { in: ids } },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
    const events: any[] = await this.prisma.signature_evidence_events.findMany({
      where: { store_id: c.store_id, request_id: { in: ids } },
      orderBy: { seq: 'asc' },
    });
    return requests.map((r) => {
      const own = events.filter((e) => e.request_id === r.id);
      const chain = verifyEvidenceChain(own);
      return {
        id: r.id,
        issued_document_id: r.issued_document_id,
        status: r.status,
        document_sha256: r.document_sha256,
        sealed_sha256: r.sealed_sha256,
        has_sealed_file: r.sealed_file_id !== null,
        expires_at: r.expires_at,
        created_at: r.created_at,
        completed_at: r.completed_at,
        cancelled_at: r.cancelled_at,
        consent_text_version: r.consent_text_version,
        chain: { valid: chain.valid, count: chain.count, last_hash: chain.last_hash },
        signers: signers
          .filter((s) => s.request_id === r.id)
          .map((s) => ({
            id: s.id,
            name: s.name,
            document_number: s.document_number,
            role_label: s.role_label,
            method: s.method,
            destination: maskDestination(s.method, s.email, s.phone),
            status: s.status,
            viewed_at: s.viewed_at,
            otp_verified_at: s.otp_verified_at,
            signed_at: s.signed_at,
            signed_ip: s.signed_ip,
            declined_reason: s.declined_reason,
          })),
        events: own.map((e) => ({
          seq: e.seq,
          type: e.type,
          signer_id: e.signer_id,
          ip_address: e.ip_address,
          occurred_at: e.occurred_at,
          payload: e.payload,
          event_hash: e.event_hash,
        })),
      };
    });
  }
}
