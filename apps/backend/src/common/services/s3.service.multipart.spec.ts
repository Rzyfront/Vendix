import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { S3Service } from './s3.service';

describe('S3Service multipart helpers (P3.4)', () => {
  const send = jest.fn();
  const service = Object.create(S3Service.prototype) as S3Service;
  Object.assign(service, {
    s3Client: { send },
    bucketName: 'bucket',
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
  });
  const lastCommand = () => send.mock.calls.at(-1)[0];

  beforeEach(() => send.mockReset());

  it('creates the upload and returns the UploadId', async () => {
    send.mockResolvedValue({ UploadId: 'up-1' });
    await expect(service.createMultipartUpload('a/b.pdf', 'application/pdf')).resolves.toBe('up-1');
    expect(lastCommand()).toBeInstanceOf(CreateMultipartUploadCommand);
    expect(lastCommand().input).toMatchObject({ Bucket: 'bucket', Key: 'a/b.pdf', ContentType: 'application/pdf' });
  });

  it('uploads a part and returns its ETag', async () => {
    send.mockResolvedValue({ ETag: '"e1"' });
    await expect(service.uploadMultipartPart('a/b.pdf', 'up-1', 2, Buffer.from('xy'))).resolves.toBe('"e1"');
    expect(lastCommand()).toBeInstanceOf(UploadPartCommand);
    expect(lastCommand().input).toMatchObject({ UploadId: 'up-1', PartNumber: 2, ContentLength: 2 });
  });

  it('completes with the parts ordered by number', async () => {
    send.mockResolvedValue({});
    await service.completeMultipartUpload('a/b.pdf', 'up-1', [
      { partNumber: 2, etag: '"b"' },
      { partNumber: 1, etag: '"a"' },
    ]);
    expect(lastCommand()).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect(lastCommand().input.MultipartUpload.Parts).toEqual([
      { PartNumber: 1, ETag: '"a"' },
      { PartNumber: 2, ETag: '"b"' },
    ]);
  });

  it('abort never throws', async () => {
    send.mockRejectedValue(new Error('boom'));
    await expect(service.abortMultipartUpload('a/b.pdf', 'up-1')).resolves.toBeUndefined();
    expect(lastCommand()).toBeInstanceOf(AbortMultipartUploadCommand);
  });

  it('refuses a traversal key before calling S3', async () => {
    await expect(service.createMultipartUpload('../x', 'text/plain')).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('hashes a streamed object without buffering it', async () => {
    send.mockResolvedValue({ Body: Readable.from([Buffer.from('hello '), Buffer.from('world')]) });
    await expect(service.hashObject('a/b.txt')).resolves.toEqual({
      sha256: createHash('sha256').update('hello world').digest('hex'),
      size: 11,
    });
  });

  it('an existing method still behaves: headObject returns null for an unsafe key', async () => {
    await expect(service.headObject('../x')).resolves.toBeNull();
    send.mockResolvedValue({ ContentType: 'image/png', ContentLength: 4 });
    await expect(service.headObject('a/b.png')).resolves.toEqual({ contentType: 'image/png', contentLength: 4 });
    expect(lastCommand()).toBeInstanceOf(HeadObjectCommand);
  });
});
