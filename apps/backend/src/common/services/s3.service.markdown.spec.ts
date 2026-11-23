import { extractS3KeyFromUrl } from '../helpers/s3-url.helper';
import { S3Service } from './s3.service';

describe('extractS3KeyFromUrl + S3Service markdown signing', () => {
  const OWN_BUCKET = 'vendix-assets-storage';

  function makeS3(
    presignImpl: (key: string, expiresIn?: number) => Promise<string> = async (
      key,
      expiresIn,
    ) => `https://${OWN_BUCKET}.s3.us-east-1.amazonaws.com/${key}?X-Amz-Signature=fresh&X-Amz-Expires=${expiresIn ?? 86400}`,
  ) {
    const getPresignedUrl = jest.fn(presignImpl);
    const service = Object.create(S3Service.prototype) as S3Service;
    Object.assign(service, {
      bucketName: OWN_BUCKET,
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
      getPresignedUrl,
    });
    return { service, getPresignedUrl };
  }

  describe('extractS3KeyFromUrl with bucketName', () => {
    it('extracts key from virtual-hosted and path-style URLs matching our bucket', () => {
      expect(
        extractS3KeyFromUrl(
          `https://${OWN_BUCKET}.s3.us-east-1.amazonaws.com/global/help-center/articles/step1.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=expired`,
          OWN_BUCKET,
        ),
      ).toBe('global/help-center/articles/step1.webp');

      expect(
        extractS3KeyFromUrl(
          `https://${OWN_BUCKET}.s3.amazonaws.com/global/help-center/articles/step2.webp`,
          OWN_BUCKET,
        ),
      ).toBe('global/help-center/articles/step2.webp');

      expect(
        extractS3KeyFromUrl(
          `https://s3.us-east-1.amazonaws.com/${OWN_BUCKET}/global/help-center/articles/step3.webp?X-Amz-Signature=old`,
          OWN_BUCKET,
        ),
      ).toBe('global/help-center/articles/step3.webp');
    });

    it('preserves foreign S3 bucket URLs and external CDN URLs untouched', () => {
      const foreignVirtual =
        'https://other-company-assets.s3.us-east-1.amazonaws.com/docs/img.png';
      const foreignPath =
        'https://s3.us-east-1.amazonaws.com/other-company-assets/docs/img.png';
      const external = 'https://cdn.example.com/images/guide.png';

      expect(extractS3KeyFromUrl(foreignVirtual, OWN_BUCKET)).toBe(
        foreignVirtual,
      );
      expect(extractS3KeyFromUrl(foreignPath, OWN_BUCKET)).toBe(foreignPath);
      expect(extractS3KeyFromUrl(external, OWN_BUCKET)).toBe(external);
    });
  });

  describe('S3Service.sanitizeMarkdownContent & signMarkdownContent', () => {
    it('signs raw S3 keys and re-signs expired own-bucket URLs while leaving external URLs untouched', async () => {
      const { service, getPresignedUrl } = makeS3();
      const rawKey =
        'global/help-center/articles/1777651583587-step1.webp';
      const expiredOwn = `https://${OWN_BUCKET}.s3.us-east-1.amazonaws.com/global/help-center/articles/step2.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=expired`;
      const external = 'https://cdn.example.com/public/diagram.png';
      const foreignS3 =
        'https://other-bucket.s3.us-east-1.amazonaws.com/public/photo.png';

      const md = [
        `Paso 1`,
        `![image](${rawKey})`,
        `Paso 2`,
        `![captura](${expiredOwn} "Título")`,
        `Paso 3`,
        `![externa](${external})`,
        `![otro-bucket](${foreignS3})`,
      ].join('\n');

      const sanitized = service.sanitizeMarkdownContent(md);
      expect(sanitized).toContain(`![image](${rawKey})`);
      expect(sanitized).toContain(
        '![captura](global/help-center/articles/step2.webp "Título")',
      );
      expect(sanitized).not.toContain('X-Amz-Signature=expired');
      expect(sanitized).toContain(`![externa](${external})`);
      expect(sanitized).toContain(`![otro-bucket](${foreignS3})`);

      const signed = await service.signMarkdownContent(md, 900);
      expect(signed).toContain(
        `![image](https://${OWN_BUCKET}.s3.us-east-1.amazonaws.com/${rawKey}?X-Amz-Signature=fresh&X-Amz-Expires=900)`,
      );
      expect(signed).toContain(
        `![captura](https://${OWN_BUCKET}.s3.us-east-1.amazonaws.com/global/help-center/articles/step2.webp?X-Amz-Signature=fresh&X-Amz-Expires=900 "Título")`,
      );
      expect(signed).toContain(`![externa](${external})`);
      expect(signed).toContain(`![otro-bucket](${foreignS3})`);
      expect(getPresignedUrl).toHaveBeenCalledTimes(2);
    });

    it('deduplicates repeated keys and preserves $ sequences in signed URLs', async () => {
      const { service, getPresignedUrl } = makeS3(
        async (key) => `https://signed.example/${key}?sig=a$&b$$c`,
      );
      const md = `![a](global/help-center/articles/1.webp)\n![b](global/help-center/articles/1.webp)`;

      const signed = await service.signMarkdownContent(md, 900);
      expect(signed).toBe(
        `![a](https://signed.example/global/help-center/articles/1.webp?sig=a$&b$$c)\n![b](https://signed.example/global/help-center/articles/1.webp?sig=a$&b$$c)`,
      );
      expect(getPresignedUrl).toHaveBeenCalledTimes(1);
    });

    it('returns markdown without images untouched without calling S3', async () => {
      const { service, getPresignedUrl } = makeS3();
      const md = '## Crear producto\n1. Ve a Productos\n2. Haz clic en Nuevo';

      expect(await service.signMarkdownContent(md, 900)).toBe(md);
      expect(getPresignedUrl).not.toHaveBeenCalled();
    });

    it('skips unsafe keys and non-http schemes without throwing', async () => {
      const { service, getPresignedUrl } = makeS3();
      const md = [
        '![a](../etc/passwd)',
        '![b](data:image/png;base64,AAAA)',
        '![c](javascript:alert(1))',
        '![d](/assets/local.png)',
      ].join('\n');

      expect(await service.signMarkdownContent(md, 900)).toBe(md);
      expect(getPresignedUrl).not.toHaveBeenCalled();
    });
  });
});
