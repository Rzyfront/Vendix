import type { issued_documents, signature_requests, signature_signers } from '@prisma/client';
import { randomInt, timingSafeEqual } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAuditService } from '../../workflows/audit/workflow-audit.service';
import { storeAllowsFlows } from '../../workflows/engine/workflow-industry';
import { hashTrackingToken } from '../../workflows/tracking/workflow-tracking-links.service';
import { bytesMatchMime } from '../file-signature';
import { StoredFilesService } from '../stored-files.service';
import { SignDocumentDto } from './dto/signature.dto';
import { SignatureDeliveryService } from './signature-delivery.service';
import { SignatureEvidenceService } from './signature-evidence.service';
import { SignatureFlowNotifier } from './signature-flow.notifier';
import { SignatureSealService } from './signature-seal.service';
import {
  DECLINE_REASON_MAX,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS,
  OTP_RESEND_SECONDS,
  OTP_TTL_MINUTES,
  OTP_VERIFIED_TTL_MINUTES,
  SIGNATURE_IMAGE_MAX_BYTES,
  maskDestination,
  sha256Hex,
} from './signature.constants';

export interface ClientMeta {
  ip: string | null;
  user_agent: string | null;
}

export type SigningState = 'pending' | 'signed' | 'declined' | 'blocked';

interface Resolved {
  signer: signature_signers;
  request: signature_requests;
  document: issued_documents;
  store_id: number;
  organization_id: number;
}

const PUBLIC_ACTOR = { type: 'public' as const, id: null };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Hash of a code, tied to the signer's link so a code never works for another signer. */
export function otpHash(signerTokenHash: string, code: string): string {
  return sha256Hex(`${signerTokenHash}:${code}`);
}

type VerifyOtpOutcome =
  | { kind: 'ok' | 'closed' | 'blocked' | 'expired'; remaining?: number }
  | { kind: 'wrong'; remaining: number };

/**
 * Public side of the signature: what the signer sees and the four things they
 * may do (ask for a code, verify it, sign, decline). The store comes from the
 * request domain; an unknown, expired, cancelled or foreign-store token is
 * always the same generic 404.
 */
@Injectable()
export class SignaturePublicService {
  private readonly logger = new Logger(SignaturePublicService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly evidence: SignatureEvidenceService,
    private readonly delivery: SignatureDeliveryService,
    private readonly files: StoredFilesService,
    private readonly seal: SignatureSealService,
    private readonly flow: SignatureFlowNotifier,
    /** Append-only audit trail (P7.2): required, so no path runs unaudited. */
    private readonly audit: WorkflowAuditService,
  ) {}

  // ---- view --------------------------------------------------------------

  async view(token: string, meta: ClientMeta) {
    const r = await this.resolve(token);
    return this.inContext(r, async () => {
      const state = this.stateOf(r);
      if (!r.signer.viewed_at && state === 'pending') {
        await this.prisma.$transaction(async (tx: any) => {
          await this.evidence.lock(tx, r.request.id);
          const touched = await tx.signature_signers.updateMany({
            where: { id: r.signer.id, store_id: r.store_id, viewed_at: null, status: { in: ['pending', 'viewed'] } },
            data: { viewed_at: new Date(), status: 'viewed' },
          });
          if (touched.count > 0) {
            await this.evidence.append(tx, {
              request_id: r.request.id,
              signer_id: r.signer.id,
              type: 'opened',
              ip_address: meta.ip,
              user_agent: meta.user_agent,
            });
          }
        });
      }
      const store = await this.prisma.withoutScope().stores.findFirst({
        where: { id: r.store_id },
        select: { name: true },
      });
      let pdf: Awaited<ReturnType<StoredFilesService['signedDownloadUrl']>> | null = null;
      if (state === 'pending' && r.document.file_id) {
        // Fail-closed: the signer's access is written before the URL exists.
        await this.audit.recordNow({
          action: 'document.public_file_downloaded',
          target_type: 'issued_document',
          target_id: r.document.id,
          instance_id: r.document.workflow_instance_id,
          actor: { type: 'public', id: null, label: r.signer.name },
          summary: `${r.signer.name} abrió el documento ${r.document.reference} para firmarlo`,
          details: {
            signature_request_id: r.request.id,
            signer_id: r.signer.id,
            file_id: r.document.file_id,
          },
        });
        pdf = await this.files.signedDownloadUrl(r.document.file_id);
      }
      return {
        state,
        store: { name: store?.name ?? '' },
        document: { title: r.document.title, reference: r.document.reference, sha256: r.request.document_sha256 },
        signer: {
          name: r.signer.name,
          role_label: r.signer.role_label,
          method: r.signer.method,
          destination: maskDestination(r.signer.method, r.signer.email, r.signer.phone),
          otp_verified: this.otpStillValid(r.signer),
          attempts_remaining: Math.max(0, OTP_MAX_ATTEMPTS - r.signer.otp_attempts),
        },
        consent: { text: r.request.consent_text, version: r.request.consent_text_version },
        pdf_url: pdf?.url ?? null,
        expires_at: r.request.expires_at,
      };
    });
  }

  // ---- one-time code -----------------------------------------------------

  /**
   * Sends a one-time code. The limits (wait between codes, cap of codes) are
   * checked and the code is stored under the request lock, with a conditional
   * claim on `otp_sent_at`, before anything is delivered: parallel calls send
   * one code, and every delivered code is the stored one. The `otp_sent`
   * evidence is written once the code was delivered; a failed delivery
   * releases the claim so the signer can ask again.
   */
  async sendOtp(token: string, meta: ClientMeta) {
    const r = await this.resolveOpen(token);
    return this.inContext(r, async () => {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const hash = otpHash(r.signer.token_hash, code);
      const now = new Date();
      const previousSentAt: Date | null = await this.prisma.$transaction(async (tx: any) => {
        await this.evidence.lock(tx, r.request.id);
        const signer = await tx.signature_signers.findFirst({
          where: { id: r.signer.id, store_id: r.store_id },
          select: { status: true, otp_sent_at: true },
        });
        if (!signer || !['pending', 'viewed'].includes(signer.status)) {
          throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_CLOSED);
        }
        const sends = await tx.signature_evidence_events.count({
          where: { request_id: r.request.id, store_id: r.store_id, signer_id: r.signer.id, type: 'otp_sent' },
        });
        const waitUntil = new Date(now.getTime() - OTP_RESEND_SECONDS * 1000);
        const tooSoon = signer.otp_sent_at !== null && new Date(signer.otp_sent_at) > waitUntil;
        if (sends >= OTP_MAX_SENDS || tooSoon) {
          throw new VendixHttpException(
            ErrorCodes.SIGNATURE_OTP_RATE_LIMIT,
            sends >= OTP_MAX_SENDS
              ? 'Ya pediste el máximo de códigos. Pide un nuevo enlace a quien te envió el documento.'
              : `Espera ${OTP_RESEND_SECONDS} segundos antes de pedir otro código.`,
          );
        }
        const claimed = await tx.signature_signers.updateMany({
          where: {
            id: r.signer.id,
            store_id: r.store_id,
            status: { in: ['pending', 'viewed'] },
            OR: [{ otp_sent_at: null }, { otp_sent_at: { lte: waitUntil } }],
          },
          data: {
            otp_hash: hash,
            otp_sent_at: now,
            otp_expires_at: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
            otp_verified_at: null,
          },
        });
        if (claimed.count === 0) {
          throw new VendixHttpException(
            ErrorCodes.SIGNATURE_OTP_RATE_LIMIT,
            `Espera ${OTP_RESEND_SECONDS} segundos antes de pedir otro código.`,
          );
        }
        return signer.otp_sent_at;
      });
      const store = await this.prisma.withoutScope().stores.findFirst({
        where: { id: r.store_id },
        select: { name: true },
      });
      try {
        await this.delivery.sendOtp(r.signer, { store_id: r.store_id, store_name: store?.name ?? '', code });
      } catch (e) {
        // Not delivered: the stored code is useless and the wait would block a retry.
        await this.prisma.signature_signers.updateMany({
          where: { id: r.signer.id, store_id: r.store_id, otp_hash: hash },
          data: { otp_hash: null, otp_expires_at: null, otp_sent_at: previousSentAt },
        });
        throw e;
      }
      // Evidence of what was really delivered; the 60 s claim keeps parallel calls out meanwhile.
      await this.prisma.$transaction(async (tx: any) => {
        await this.evidence.lock(tx, r.request.id);
        await this.evidence.append(tx, {
          request_id: r.request.id,
          signer_id: r.signer.id,
          type: 'otp_sent',
          ip_address: meta.ip,
          user_agent: meta.user_agent,
          payload: {
            method: r.signer.method,
            destination: maskDestination(r.signer.method, r.signer.email, r.signer.phone),
          },
        });
      });
      return {
        sent: true,
        destination: maskDestination(r.signer.method, r.signer.email, r.signer.phone),
        expires_in_seconds: OTP_TTL_MINUTES * 60,
        resend_after_seconds: OTP_RESEND_SECONDS,
        attempts_remaining: Math.max(0, OTP_MAX_ATTEMPTS - r.signer.otp_attempts),
      };
    });
  }

  async verifyOtp(token: string, code: string, meta: ClientMeta) {
    const r = await this.resolveOpen(token);
    const outcome = await this.inContext<VerifyOtpOutcome>(r, () =>
      this.prisma.$transaction(async (tx: any) => {
        await this.evidence.lock(tx, r.request.id);
        const signer = await tx.signature_signers.findFirst({
          where: { id: r.signer.id, store_id: r.store_id },
        });
        if (!signer || !['pending', 'viewed', 'blocked'].includes(signer.status)) {
          return { kind: 'closed' as const };
        }
        if (signer.status === 'blocked' || signer.otp_attempts >= OTP_MAX_ATTEMPTS) {
          return { kind: 'blocked' as const };
        }
        if (!signer.otp_hash || !signer.otp_expires_at || new Date(signer.otp_expires_at).getTime() <= Date.now()) {
          return { kind: 'expired' as const };
        }
        const given = Buffer.from(otpHash(signer.token_hash, (code ?? '').trim()), 'hex');
        const stored = Buffer.from(signer.otp_hash, 'hex');
        if (given.length === stored.length && timingSafeEqual(given, stored)) {
          await tx.signature_signers.updateMany({
            where: { id: signer.id, store_id: r.store_id },
            data: { otp_verified_at: new Date(), otp_hash: null },
          });
          await this.evidence.append(tx, {
            request_id: r.request.id,
            signer_id: signer.id,
            type: 'otp_verified',
            ip_address: meta.ip,
            user_agent: meta.user_agent,
            payload: { method: signer.method },
          });
          return { kind: 'ok' as const };
        }
        const attempts = signer.otp_attempts + 1;
        const blocked = attempts >= OTP_MAX_ATTEMPTS;
        await tx.signature_signers.updateMany({
          where: { id: signer.id, store_id: r.store_id },
          data: { otp_attempts: attempts, ...(blocked ? { status: 'blocked' } : {}) },
        });
        await this.evidence.append(tx, {
          request_id: r.request.id,
          signer_id: signer.id,
          type: 'otp_failed',
          ip_address: meta.ip,
          user_agent: meta.user_agent,
          payload: { attempts, attempts_remaining: OTP_MAX_ATTEMPTS - attempts, blocked },
        });
        return { kind: blocked ? ('blocked' as const) : ('wrong' as const), remaining: OTP_MAX_ATTEMPTS - attempts };
      }),
    );
    // Thrown after the commit, so a failed attempt is never rolled back.
    switch (outcome.kind) {
      case 'ok':
        return { verified: true };
      case 'wrong':
        throw new VendixHttpException(
          ErrorCodes.SIGNATURE_OTP_INVALID,
          `Código incorrecto. Te ${outcome.remaining === 1 ? 'queda 1 intento' : `quedan ${outcome.remaining} intentos`}.`,
          { attempts_remaining: outcome.remaining },
        );
      case 'blocked':
        throw new VendixHttpException(ErrorCodes.SIGNATURE_BLOCKED);
      case 'expired':
        throw new VendixHttpException(
          ErrorCodes.SIGNATURE_OTP_INVALID,
          'El código venció o aún no lo pediste. Pide uno nuevo.',
          { attempts_remaining: Math.max(0, OTP_MAX_ATTEMPTS - r.signer.otp_attempts) },
        );
      default:
        throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_CLOSED);
    }
  }

  // ---- sign / decline ----------------------------------------------------

  async sign(token: string, dto: SignDocumentDto, meta: ClientMeta) {
    const r = await this.resolveOpen(token);
    if (dto.consent !== true) throw new VendixHttpException(ErrorCodes.SIGNATURE_CONSENT_REQUIRED);
    if (!this.otpStillValid(r.signer)) throw new VendixHttpException(ErrorCodes.SIGNATURE_OTP_REQUIRED);
    const image = this.decodeStroke(dto.signature_png);

    return this.inContext(r, async () => {
      const file = await this.files.upload({
        buffer: image,
        mimeType: 'image/png',
        originalName: `firma-${r.signer.id}.png`,
        folder: `signatures/${r.request.id}`,
        source: 'signature_image',
        actor: PUBLIC_ACTOR,
      });
      let allSigned = false;
      try {
        allSigned = await this.prisma.$transaction(async (tx: any) => {
          await this.evidence.lock(tx, r.request.id);
          const request = await tx.signature_requests.findFirst({
            where: { id: r.request.id, store_id: r.store_id },
          });
          const signer = await tx.signature_signers.findFirst({
            where: { id: r.signer.id, store_id: r.store_id },
          });
          if (!request || !signer) throw new VendixHttpException(ErrorCodes.SIGNATURE_PUBLIC_NOT_FOUND);
          this.assertSignerOpen(request, signer);
          if (!this.otpStillValid(signer)) throw new VendixHttpException(ErrorCodes.SIGNATURE_OTP_REQUIRED);
          const now = new Date();
          await tx.signature_signers.updateMany({
            where: { id: signer.id, store_id: r.store_id },
            data: {
              status: 'signed',
              signed_at: now,
              signed_ip: meta.ip ? meta.ip.slice(0, 64) : null,
              signed_user_agent: meta.user_agent ? meta.user_agent.slice(0, 400) : null,
              signature_file_id: file.id,
            },
          });
          await tx.signature_requests.updateMany({
            where: { id: request.id, store_id: r.store_id },
            data: { status: 'partially_signed' },
          });
          await this.evidence.append(tx, {
            request_id: request.id,
            signer_id: signer.id,
            type: 'consent_accepted',
            ip_address: meta.ip,
            user_agent: meta.user_agent,
            payload: {
              consent_text_version: request.consent_text_version,
              consent_text_sha256: sha256Hex(request.consent_text),
            },
          });
          await this.evidence.append(tx, {
            request_id: request.id,
            signer_id: signer.id,
            type: 'signed',
            ip_address: meta.ip,
            user_agent: meta.user_agent,
            occurred_at: now,
            payload: {
              signature_file_id: file.id,
              signature_sha256: file.sha256,
              document_sha256: request.document_sha256,
              otp_verified_at: new Date(signer.otp_verified_at).toISOString(),
            },
          });
          const unsigned = await tx.signature_signers.count({
            where: { request_id: request.id, store_id: r.store_id, status: { not: 'signed' } },
          });
          return unsigned === 0;
        });
      } catch (e) {
        await this.files.discard(file);
        throw e;
      }
      let sealed = false;
      if (allSigned) {
        try {
          sealed = await this.seal.seal(r.request.id);
        } catch (e) {
          // The signature is recorded; the cron retries the seal.
          this.logger.error(`Seal of request ${r.request.id} failed: ${(e as Error)?.message}`);
        }
      }
      return { signed: true, completed: sealed };
    });
  }

  async decline(token: string, reason: string, meta: ClientMeta) {
    const text = (reason ?? '').trim().slice(0, DECLINE_REASON_MAX);
    if (text.length < 3) {
      throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001, 'Escribe el motivo del rechazo.');
    }
    const r = await this.resolveOpen(token);
    return this.inContext(r, () =>
      this.prisma.$transaction(async (tx: any) => {
        await this.evidence.lock(tx, r.request.id);
        const request = await tx.signature_requests.findFirst({
          where: { id: r.request.id, store_id: r.store_id },
        });
        const signer = await tx.signature_signers.findFirst({
          where: { id: r.signer.id, store_id: r.store_id },
        });
        if (!request || !signer) throw new VendixHttpException(ErrorCodes.SIGNATURE_PUBLIC_NOT_FOUND);
        this.assertSignerOpen(request, signer);
        await tx.signature_signers.updateMany({
          where: { id: signer.id, store_id: r.store_id },
          data: { status: 'declined', declined_reason: text },
        });
        await tx.signature_requests.updateMany({
          where: { id: request.id, store_id: r.store_id },
          data: { status: 'declined' },
        });
        await tx.issued_documents.updateMany({
          where: { id: request.issued_document_id, store_id: r.store_id, status: 'pending_signature' },
          data: { status: 'issued' },
        });
        await this.evidence.append(tx, {
          request_id: request.id,
          signer_id: signer.id,
          type: 'declined',
          ip_address: meta.ip,
          user_agent: meta.user_agent,
          payload: { reason: text },
        });
        await this.flow.notify(tx, r.store_id, r.document.workflow_instance_id, {
          type: 'signature_declined',
          payload: {
            label: `Firma rechazada: ${text}`,
            reason: text,
            signer: signer.name,
            document_reference: r.document.reference,
          },
        });
        return { declined: true };
      }),
    );
  }

  // ---- internals ---------------------------------------------------------

  private decodeStroke(raw: string): Buffer {
    const bad = () => new VendixHttpException(ErrorCodes.SIGNATURE_IMAGE_INVALID);
    const body = (raw ?? '').replace(/^data:image\/png;base64,/, '').trim();
    if (!body || body.length % 4 !== 0 || !BASE64.test(body)) throw bad();
    const buffer = Buffer.from(body, 'base64');
    if (buffer.length === 0 || buffer.length > SIGNATURE_IMAGE_MAX_BYTES) throw bad();
    if (!bytesMatchMime(buffer, 'image/png')) throw bad();
    return buffer;
  }

  private otpStillValid(signer: { otp_verified_at: Date | null }): boolean {
    return (
      !!signer.otp_verified_at &&
      Date.now() - new Date(signer.otp_verified_at).getTime() <= OTP_VERIFIED_TTL_MINUTES * 60_000
    );
  }

  private stateOf(r: Resolved): SigningState {
    if (r.signer.status === 'signed') return 'signed';
    if (r.signer.status === 'blocked') return 'blocked';
    if (r.signer.status === 'declined' || r.request.status === 'declined') return 'declined';
    return 'pending';
  }

  /** Throws the right 409/403 when the signer can no longer act. */
  private assertSignerOpen(request: { status: string }, signer: { status: string }) {
    if (signer.status === 'signed') throw new VendixHttpException(ErrorCodes.SIGNATURE_ALREADY_SIGNED);
    if (signer.status === 'blocked') throw new VendixHttpException(ErrorCodes.SIGNATURE_BLOCKED);
    if (
      !['pending', 'viewed'].includes(signer.status) ||
      !['pending', 'partially_signed'].includes(request.status)
    ) {
      throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_CLOSED);
    }
  }

  private async resolveOpen(token: string): Promise<Resolved> {
    const r = await this.resolve(token);
    this.assertSignerOpen(r.request, r.signer);
    return r;
  }

  private inContext<T>(r: Resolved, fn: () => Promise<T>): Promise<T> {
    return RequestContextService.runIsolated(
      {
        store_id: r.store_id,
        organization_id: r.organization_id,
        is_super_admin: false,
        is_owner: false,
      },
      fn,
    );
  }

  /** Same generic 404 for an unknown, expired, cancelled or foreign-store token. */
  private async resolve(token: string): Promise<Resolved> {
    const storeId = RequestContextService.getStoreId();
    const notFound = () => new VendixHttpException(ErrorCodes.SIGNATURE_PUBLIC_NOT_FOUND);
    if (!storeId || typeof token !== 'string' || token.length < 20 || token.length > 200) {
      throw notFound();
    }
    const db = this.prisma.withoutScope();
    if (!(await storeAllowsFlows(db as never, storeId))) throw notFound();
    const signer = await db.signature_signers.findFirst({
      where: { token_hash: hashTrackingToken(token), store_id: storeId },
    });
    if (!signer || signer.status === 'expired') throw notFound();
    const request = await db.signature_requests.findFirst({
      where: { id: signer.request_id, store_id: storeId },
    });
    if (!request || request.status === 'cancelled' || request.status === 'expired') throw notFound();
    const open = ['pending', 'partially_signed'].includes(request.status);
    if (open && new Date(request.expires_at).getTime() <= Date.now()) throw notFound();
    const document = await db.issued_documents.findFirst({
      where: { id: request.issued_document_id, store_id: storeId },
    });
    if (!document) throw notFound();
    const store = await db.stores.findFirst({ where: { id: storeId }, select: { organization_id: true } });
    if (!store) throw notFound();
    return { signer, request, document, store_id: storeId, organization_id: store.organization_id };
  }
}
