import { Controller, INestApplication, Post, UploadedFile } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AllExceptionsFilter } from '../../../common/filters/http-exception.filter';
import {
  AI_ATTACHMENT_TOO_LARGE_MESSAGE,
  AI_ATTACHMENT_UPLOAD_LIMITS,
  AiAttachmentTooLargeInterceptor,
  AiAttachmentUpload,
} from './ai-attachment-upload.decorator';
import { AI_ATTACHMENT_MAX_BYTES } from './ai-attachments';
import { VexController } from '../vex/vex.controller';
import { VexiController } from './vexi.controller';

/** Same decorator as `POST store/vex/attachments` and `store/vexi/attachments`. */
@Controller('t')
class UploadProbeController {
  @Post('attachments')
  @AiAttachmentUpload()
  upload(@UploadedFile() file: Express.Multer.File) {
    return { size: file?.size ?? null };
  }
}

describe('AiAttachmentUpload (P1: Multer con limits)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  it('caps Multer at the real attachment limit, one file', () => {
    expect(AI_ATTACHMENT_UPLOAD_LIMITS).toEqual({
      fileSize: AI_ATTACHMENT_MAX_BYTES,
      files: 1,
    });
  });

  it('a file of exactly 10 MB still reaches the handler', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/attachments')
      .attach('file', Buffer.alloc(AI_ATTACHMENT_MAX_BYTES, 0x61), 'a.txt');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ size: AI_ATTACHMENT_MAX_BYTES });
  });

  it('one byte over is cut by Multer with the same 400 and Spanish message as the service', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/attachments')
      .attach('file', Buffer.alloc(AI_ATTACHMENT_MAX_BYTES + 1, 0x61), 'a.txt');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(AI_ATTACHMENT_TOO_LARGE_MESSAGE);
    expect(JSON.stringify(res.body)).toContain('INV_SCAN_INVALID_FILE');
    expect(AI_ATTACHMENT_TOO_LARGE_MESSAGE).toMatch(
      /^El archivo pesa más de 10 MB, que es el máximo\. Acepto: /,
    );
  });

  it('the Vex and Vexi upload routes use it', () => {
    const interceptorsOf = (handler: unknown) =>
      (Reflect.getMetadata('__interceptors__', handler as object) ?? []) as unknown[];
    // [size-error mapper, Multer mixin]: the mixin is a new class per use, so
    // its limits are proven over HTTP above, through the same decorator.
    for (const handler of [
      UploadProbeController.prototype.upload,
      VexController.prototype.uploadAttachment,
      VexiController.prototype.uploadAttachment,
    ]) {
      const used = interceptorsOf(handler);
      expect(used).toHaveLength(2);
      expect(used[0]).toBe(AiAttachmentTooLargeInterceptor);
      expect(typeof used[1]).toBe('function');
    }
  });
});
