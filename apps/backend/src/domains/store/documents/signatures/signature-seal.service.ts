import type { signature_signers } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { S3Service } from '@common/services/s3.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DossiersService } from '../dossiers.service';
import { StoredFilesService } from '../stored-files.service';
import { IssuedDocumentRenderer, SignatureStamp } from '../templates/issued-document-renderer';
import { SignatureFlowNotifier } from './signature-flow.notifier';
import { SignatureEvidenceService } from './signature-evidence.service';
import { drawEvidenceSheet } from './signature-evidence-sheet';
import { maskDestination, sha256Hex } from './signature.constants';

const SYSTEM = { type: 'system' as const, id: null };

/**
 * Seals a fully signed request: renders the document again with each stroke in
 * its box plus the evidence sheet, stores the PDF in the dossier and closes the
 * request. Safe to call more than once (the cron retries a seal that failed).
 */
@Injectable()
export class SignatureSealService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly evidence: SignatureEvidenceService,
    private readonly renderer: IssuedDocumentRenderer,
    private readonly files: StoredFilesService,
    private readonly dossiers: DossiersService,
    private readonly s3: S3Service,
    private readonly flow: SignatureFlowNotifier,
  ) {}

  /** Returns whether this call sealed the request. */
  async seal(requestId: number): Promise<boolean> {
    const storeId = RequestContextService.getStoreId();
    const request = await this.prisma.signature_requests.findFirst({
      where: { id: requestId, store_id: storeId },
    });
    if (!request) throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_NOT_FOUND);
    // Only a request whose last signer just signed can be sealed: a cancelled,
    // expired or declined one stays closed and a completed one is done.
    if (request.status !== 'partially_signed') return false;
    const signers: signature_signers[] = await this.prisma.signature_signers.findMany({
      where: { request_id: requestId, store_id: storeId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
    if (signers.length === 0 || signers.some((s) => s.status !== 'signed')) return false;

    const document = await this.prisma.issued_documents.findFirst({
      where: { id: request.issued_document_id, store_id: storeId },
    });
    if (!document) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: storeId },
      select: { name: true },
    });

    const stamps: SignatureStamp[] = [];
    for (const s of signers) {
      // A signed signer always has its stroke and time; without them the seal
      // would be incomplete evidence, so it fails and the cron retries later.
      if (s.signature_file_id === null || s.signed_at === null) {
        throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
      }
      const file = await this.files.findOne(s.signature_file_id);
      stamps.push({
        slot_key: s.slot_key,
        role_label: s.role_label,
        name: s.name,
        document_number: s.document_number,
        image: await this.s3.downloadFile(file.s3_key),
        signed_at: s.signed_at,
      });
    }
    const chain = await this.evidence.list(requestId);
    const sealedAt = new Date();
    const pdf = await this.renderer.render(document.id, {
      signatures: stamps,
      appendPages: (pdfDoc) =>
        drawEvidenceSheet(pdfDoc, {
          store_name: store?.name ?? '',
          document_title: document.title,
          document_reference: document.reference,
          document_sha256: request.document_sha256,
          consent_text_version: request.consent_text_version,
          signers: signers.map((s) => ({
            name: s.name,
            document_number: s.document_number,
            role_label: s.role_label,
            method: s.method,
            destination: maskDestination(s.method, s.email, s.phone),
            otp_verified_at: s.otp_verified_at,
            ip_address: s.signed_ip,
            user_agent: s.signed_user_agent,
            signed_at: s.signed_at,
          })),
          chain_last_hash: chain[chain.length - 1]?.event_hash ?? null,
          generated_at: sealedAt,
        }),
    });
    const sealedSha = sha256Hex(pdf);
    const file = await this.files.upload({
      buffer: pdf,
      mimeType: 'application/pdf',
      originalName: `${document.reference}-firmado.pdf`,
      folder: `documents/${document.id}`,
      source: 'generated',
      actor: SYSTEM,
    });

    let sealed = false;
    try {
      sealed = await this.prisma.$transaction(async (tx: any) => {
        await this.evidence.lock(tx, requestId);
        const fresh = await tx.signature_requests.findFirst({
          where: { id: requestId, store_id: storeId },
          select: { status: true },
        });
        // Re-checked under the lock: a cancel that won the race keeps the request closed.
        if (!fresh || fresh.status !== 'partially_signed') return false;
        await tx.signature_requests.updateMany({
          where: { id: requestId, store_id: storeId },
          data: {
            status: 'completed',
            sealed_file_id: file.id,
            sealed_sha256: sealedSha,
            completed_at: sealedAt,
          },
        });
        await tx.issued_documents.updateMany({
          where: { id: document.id, store_id: storeId },
          data: { status: 'signed' },
        });
        await this.evidence.append(tx, {
          request_id: requestId,
          type: 'sealed',
          payload: { sealed_file_id: file.id, sealed_sha256: sealedSha, document_sha256: request.document_sha256 },
        });
        if (document.dossier_id) {
          await this.dossiers.addDocumentItem(tx, {
            dossier_id: document.dossier_id,
            kind: 'signed_document',
            issued_document_id: document.id,
            file_id: file.id,
            stage_key: document.stage_key,
            requirement_key: document.requirement_key,
            actor: SYSTEM,
          });
        }
        await this.flow.notify(tx, storeId as number, document.workflow_instance_id, {
          type: 'signature_completed',
          payload: {
            label: 'Documento firmado',
            document_reference: document.reference,
            requirement_key: document.requirement_key,
          },
          advance: true,
        });
        return true;
      });
    } catch (e) {
      await this.files.discard(file);
      throw e;
    }
    if (!sealed) await this.files.discard(file);
    return sealed;
  }
}
