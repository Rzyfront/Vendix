import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Service, isS3NotFoundError } from './s3.service';

/**
 * QUI-1009 — `objectExistsStrict` separates "the object is gone" (false) from
 * "S3 is unreachable" (rethrown), unlike `objectExists`, which says false for both.
 */
describe('S3Service.objectExistsStrict', () => {
  const build = (send: jest.Mock) => {
    const service = Object.create(S3Service.prototype) as S3Service;
    Object.assign(service, { s3Client: { send }, bucketName: 'bucket' });
    return service;
  };
  const notFound = Object.assign(new Error('NotFound'), {
    name: 'NotFound',
    $metadata: { httpStatusCode: 404 },
  });
  const s3Down = Object.assign(new Error('socket hang up'), {
    name: 'TimeoutError',
    $metadata: { httpStatusCode: 503 },
  });

  it('true when HEAD answers', async () => {
    const send = jest.fn().mockResolvedValue({});
    await expect(build(send).objectExistsStrict('tmp/a/1/s.xlsx')).resolves.toBe(true);
    const command = send.mock.calls[0][0] as HeadObjectCommand;
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command.input).toEqual({ Bucket: 'bucket', Key: 'tmp/a/1/s.xlsx' });
  });

  it('false when S3 says the object does not exist', async () => {
    const send = jest.fn().mockRejectedValue(notFound);
    await expect(build(send).objectExistsStrict('tmp/a/1/s.xlsx')).resolves.toBe(false);
  });

  it('rethrows any other S3 failure', async () => {
    const send = jest.fn().mockRejectedValue(s3Down);
    await expect(build(send).objectExistsStrict('tmp/a/1/s.xlsx')).rejects.toBe(s3Down);
  });

  it('an unsafe or empty key is false without calling S3', async () => {
    const send = jest.fn();
    await expect(build(send).objectExistsStrict('../etc/passwd')).resolves.toBe(false);
    await expect(build(send).objectExistsStrict(null)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('isS3NotFoundError: NoSuchKey (GET), NotFound (HEAD) and 404 only', () => {
    expect(isS3NotFoundError({ name: 'NoSuchKey' })).toBe(true);
    expect(isS3NotFoundError({ Code: 'NoSuchKey' })).toBe(true);
    expect(isS3NotFoundError(notFound)).toBe(true);
    expect(isS3NotFoundError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isS3NotFoundError(s3Down)).toBe(false);
    expect(isS3NotFoundError({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })).toBe(false);
    expect(isS3NotFoundError(undefined)).toBe(false);
  });
});
