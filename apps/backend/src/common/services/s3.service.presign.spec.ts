import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Service } from './s3.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async () => 'https://signed.example/x'),
}));

describe('S3Service.getPresignedUrl — descarga forzada (B6)', () => {
  const service = Object.create(S3Service.prototype) as S3Service;
  Object.assign(service, {
    s3Client: {},
    bucketName: 'bucket',
    logger: { error: jest.fn() },
    validateS3Key: jest.fn(),
  });
  const command = () =>
    (getSignedUrl as jest.Mock).mock.calls.at(-1)[1] as GetObjectCommand;

  it('con downloadName firma attachment con el nombre codificado', async () => {
    await service.getPresignedUrl('k/a.html', 300, {
      downloadName: 'contrato ñ "x".html',
    });
    expect(command().input.ResponseContentDisposition).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('contrato ñ "x".html')}`,
    );
    expect((getSignedUrl as jest.Mock).mock.calls.at(-1)[2]).toEqual({ expiresIn: 300 });
  });

  it('sin opciones no cambia la firma de los demás usos', async () => {
    await service.getPresignedUrl('k/a.png');
    expect(command().input.ResponseContentDisposition).toBeUndefined();
  });
});
