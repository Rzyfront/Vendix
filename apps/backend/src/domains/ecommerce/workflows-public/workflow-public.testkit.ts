import { createHash } from 'crypto';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { buildWorkflowKit } from '../../../testing/workflows/workflow-test-kit';
import { WorkflowPublicUploadsService } from '../../store/workflows/public-link/workflow-public-uploads.service';
import { WorkflowTrackingLinksService } from '../../store/workflows/tracking/workflow-tracking-links.service';
import { WorkflowTrackingPublicService } from '../../store/workflows/tracking/workflow-tracking-public.service';
import {
  CaptchaChallenge,
  WorkflowPublicCaptchaService,
  leadingZeroBits,
} from './workflow-public-captcha.service';
import { WorkflowPublicFormService } from './workflow-public-form.service';

export const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG-looking buffer of `size` bytes. */
export function pngOf(size: number): Buffer {
  return Buffer.concat([PNG_HEAD, Buffer.alloc(size - PNG_HEAD.length, 7)]);
}

/** In-memory S3 with the multipart calls the public uploads use. */
export function fakeS3() {
  const open = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  const objects = new Map<string, Buffer>();
  let n = 0;
  return {
    objects,
    open,
    createMultipartUpload: jest.fn(async (key: string) => {
      const id = `mp-${++n}`;
      open.set(id, { key, parts: new Map() });
      return id;
    }),
    uploadMultipartPart: jest.fn(async (_key: string, id: string, part: number, body: Buffer) => {
      open.get(id)!.parts.set(part, body);
      return `"etag-${part}"`;
    }),
    completeMultipartUpload: jest.fn(async (key: string, id: string) => {
      const u = open.get(id);
      if (!u) throw Object.assign(new Error('The specified upload does not exist.'), { name: 'NoSuchUpload' });
      objects.set(
        key,
        Buffer.concat([...u.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b)),
      );
      open.delete(id);
    }),
    abortMultipartUpload: jest.fn(async (_key: string, id: string) => {
      open.delete(id);
    }),
    headObject: jest.fn(async (key: string) => {
      const buf = objects.get(key);
      return buf ? { contentType: null, contentLength: buf.length } : null;
    }),
    hashObject: jest.fn(async (key: string) => {
      const buf = objects.get(key)!;
      return { sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length };
    }),
    deleteFile: jest.fn(async (key: string) => {
      objects.delete(key);
    }),
  };
}

/** Finds `number` so sha256(salt + number) has the required leading zero bits. */
export function solveCaptcha(c: CaptchaChallenge) {
  for (let number = 0; ; number++) {
    const digest = createHash('sha256').update(`${c.salt}${number}`).digest();
    if (leadingZeroBits(digest) >= c.difficulty) {
      return { salt: c.salt, number, expires_at: c.expires_at, signature: c.signature };
    }
  }
}

/** The engine kit plus the P3 public services wired on the same in-memory DB. */
export function buildPublicKit() {
  const kit = buildWorkflowKit();
  const s3 = fakeS3();
  const redisSeen = new Set<string>();
  const redis = {
    set: jest.fn(async (key: string) => {
      if (redisSeen.has(key)) return null;
      redisSeen.add(key);
      return 'OK';
    }),
  };
  const email = { sendEmail: jest.fn(async () => ({ success: true })) };
  const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'test-secret-for-captcha' : undefined) };
  const uploads = new WorkflowPublicUploadsService(kit.prisma, s3 as never, new S3PathHelper());
  const trackingLinks = new WorkflowTrackingLinksService(kit.prisma, email as never);
  const captcha = new WorkflowPublicCaptchaService(config as never, redis as never);
  const form = new WorkflowPublicFormService(
    kit.prisma,
    kit.engine,
    captcha,
    uploads,
    trackingLinks,
    kit.dossiers,
  );
  const tracking = new WorkflowTrackingPublicService(kit.prisma, kit.dossiers, kit.events, uploads);
  return { ...kit, s3Multipart: s3, redis, email, config, uploads, trackingLinks, captcha, form, tracking };
}
