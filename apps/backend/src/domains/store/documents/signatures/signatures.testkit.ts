import { createHash } from 'crypto';
import { PDFDocument } from '@common/pdf/pdfkit';
import { buildWorkflowKit } from '../../../../testing/workflows/workflow-test-kit';
import { seedPeople } from '../../../../testing/workflows/workflow-test-kit';
import { DossiersService } from '../dossiers.service';
import { IssuedDocumentRenderer, RenderIssuedOptions } from '../templates/issued-document-renderer';
import { SignatureDeliveryService } from './signature-delivery.service';
import { SignatureEvidenceService } from './signature-evidence.service';
import { SignatureExpiryCron } from './signature-expiry.cron';
import { SignatureFlowNotifier } from './signature-flow.notifier';
import { SignaturePublicService } from './signature-public.service';
import { SignatureRequestsService } from './signature-requests.service';
import { SignatureSealService } from './signature-seal.service';

export const PNG_STROKE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(300, 9),
]);
export const strokeBase64 = (png = PNG_STROKE) => `data:image/png;base64,${png.toString('base64')}`;
export const DOC_SHA = 'a'.repeat(64);

export const META = { ip: '203.0.113.7', user_agent: 'Mozilla/5.0 (iPhone)' };

/** Renderer double: records the call and writes the real evidence sheet on a real PDF. */
export function fakeRenderer() {
  const texts: string[] = [];
  const render = jest.fn(async (_id: number, options?: RenderIssuedOptions) => {
    const pdf = new PDFDocument({ compress: false });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => pdf.on('end', () => resolve()));
    const text = pdf.text.bind(pdf);
    (pdf as any).text = (t: string, ...rest: unknown[]) => {
      texts.push(String(t));
      return (text as any)(t, ...rest);
    };
    pdf.text('Contrato');
    await options?.appendPages?.(pdf);
    pdf.end();
    await done;
    return Buffer.concat(chunks);
  });
  const renderer: IssuedDocumentRenderer = { render };
  return { renderer, render, texts };
}

/** Signature services wired on the in-memory engine kit, with mail/WhatsApp/S3 doubles. */
export function buildSignatureKit() {
  const kit = buildWorkflowKit();
  seedPeople(kit.db);
  kit.db.insert('organizations', { id: 1, slug: 'org' });
  kit.db.table('stores').forEach((st) => (st.slug = `tienda-${st.id}`));
  kit.db.table('stores').find((st) => st.id === 1)!.name = 'Taller Central';
  kit.db.insert('domain_settings', {
    store_id: 1, app_type: 'STORE_ECOMMERCE', status: 'active', is_primary: true, hostname: 'taller.example.com',
  });
  kit.db.insert('social_channels', {
    store_id: 1, channel_type: 'whatsapp', provider: 'meta_cloud', status: 'connected',
  });

  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const email = {
    sendEmail: jest.fn(async (to: string, subject: string, _html: string, text?: string) => {
      sent.push({ to, subject, text: text ?? '' });
      return { success: true };
    }),
  };
  const messaging = { sendTemplate: jest.fn(async () => ({ status: 'sent' })) };
  const s3 = kit.s3 as any;
  s3.downloadFile = jest.fn(async () => PNG_STROKE);

  const dossiers = new DossiersService(kit.prisma);
  const prisma = kit.prisma;
  const evidence = new SignatureEvidenceService(prisma);
  const delivery = new SignatureDeliveryService(prisma, email as any, messaging as any);
  const flow = new SignatureFlowNotifier({ get: () => kit.events } as any);
  const fake = fakeRenderer();
  const seal = new SignatureSealService(prisma, evidence, fake.renderer, kit.storedFiles, dossiers, s3, flow);
  const requests = new SignatureRequestsService(prisma, evidence, delivery, flow, seal, kit.storedFiles, kit.workflowAudit);
  const publicSvc = new SignaturePublicService(prisma, evidence, delivery, kit.storedFiles, seal, flow, kit.workflowAudit);
  const cron = new SignatureExpiryCron(prisma, requests);

  /** Issued PDF file + dossier + workflow request + issued document of store 1. */
  function seedDocument(extra: Record<string, unknown> = {}) {
    const file = kit.db.insert('stored_files', {
      organization_id: 1, store_id: 1, s3_key: `k/${Math.random()}.pdf`, original_name: 'DOC-000001.pdf',
      mime_type: 'application/pdf', size_bytes: 100, sha256: DOC_SHA, source: 'generated', uploaded_by_type: 'system',
    });
    if (!kit.db.table('workflow_instances').length) {
      kit.db.insert('workflow_instances', {
        id: 1, organization_id: 1, store_id: 1, definition_id: 1, version_id: 1, reference: 'FLU-000001',
        title: 'Contratación', current_stage_key: 'firma', status: 'active', stage_entry_seq: 1,
        stage_entered_at: new Date(), created_by_type: 'user', created_by_id: 1,
      });
      kit.db.insert('dossiers', { id: 1, store_id: 1, organization_id: 1, reference: 'EXP-000001', workflow_instance_id: 1 });
    }
    return kit.db.insert('issued_documents', {
      organization_id: 1, store_id: 1, reference: 'DOC-000001', title: 'Contrato laboral',
      template_id: 1, template_version_id: 1, dossier_id: 1, workflow_instance_id: 1,
      requirement_key: 'contrato', stage_key: 'firma', data_snapshot: {}, data_hash: 'b'.repeat(64),
      file_id: file.id, pdf_sha256: DOC_SHA, status: 'issued', issued_by_type: 'user', ...extra,
    });
  }

  const tokenOf = (text: string) => /\/firmar\/([\w-]+)/.exec(text)![1];
  const codeOf = (text: string) => /(\d{6})/.exec(text)![1];
  const asAdmin = (store_id = 1) =>
    kit.as({ store_id, user_id: 1, permissions: ['store:workflows:manage'], is_owner: true });
  const asVisitor = (store_id = 1) =>
    kit.as({ store_id, user_id: undefined, permissions: [], is_owner: false });

  return {
    kit, sent, email, messaging, s3, evidence, delivery, seal, requests, publicSvc, cron, fake,
    seedDocument, tokenOf, codeOf, asAdmin, asVisitor,
    sha: (b: Buffer) => createHash('sha256').update(b).digest('hex'),
  };
}

export type SignatureKit = ReturnType<typeof buildSignatureKit>;

export async function codeOfError(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { errorCode?: string }).errorCode;
  }
}
