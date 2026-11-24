import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PWA_BRAND_ICON_VERSION,
  PWA_ICON_IMMUTABLE_CACHE,
  PWA_ICON_SHORT_CACHE,
  PublicPwaService,
  pwaIconCacheControl,
  pwaIconVersion,
} from './public-pwa.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';

/**
 * GUARDIA OBLIGATORIA del ícono dinámico de la app instalada (PWA).
 *
 * Corre en el job "PWA Manifest Guard" del CI, que es check requerido para
 * mergear a develop y a main, y está protegido por CODEOWNERS: no se cambia ni
 * se quita sin la aprobación de Rafael.
 *
 * Qué protege: al instalar la app en Android, Windows o Linux (Chromium usa los
 * íconos del manifest), cada tienda debe quedar con SU ícono y no con el de
 * Vendix. Se rompió porque el ícono de respaldo de Vendix se servía como
 * «inmutable por 7 días» bajo la misma URL que el de la tienda: CloudFront y el
 * navegador lo guardaban una semana aunque la tienda ya tuviera logo.
 */

const ORG = { id: 33, slug: 'vendix-demo' };
const STORE = { id: 94, slug: 'vendix-pit-and-grill' };
const STORE_PATH = `organizations/${ORG.slug}-${ORG.id}/stores/${STORE.slug}-${STORE.id}`;
const LOGO = `${STORE_PATH}/logos/logo.webp`;
const VARIANTS = [
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon-180.png',
];
const VERSIONED_ICON = /^\/pwa\/v\/([a-f0-9]{12}|brand)\/([a-z0-9-]+\.png)$/;

const REPO_ROOT = join(__dirname, '../../../../../..');

describe('PWA Manifest Guard — ícono dinámico por tienda', () => {
  let service: PublicPwaService;
  let stores: { findUnique: jest.Mock };

  const build = (logoUrl: string | null) => {
    stores = {
      findUnique: jest.fn().mockResolvedValue({
        ...STORE,
        logo_url: logoUrl,
        organizations: ORG,
      }),
    };
    service = new PublicPwaService(
      {
        stores,
        store_settings: { findUnique: jest.fn().mockResolvedValue(null) },
        organizations: { findUnique: jest.fn().mockResolvedValue(ORG) },
        organization_settings: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      } as any,
      {
        resolveDomain: jest.fn().mockResolvedValue({
          app: 'STORE_ECOMMERCE',
          store_id: STORE.id,
          store_name: 'Pit & Grill',
          branding: { primary_color: '#2ecc71' },
        }),
      } as any,
      {
        objectExists: jest.fn().mockResolvedValue(false),
        getOrCreatePwaIcon: jest
          .fn()
          .mockResolvedValue(Buffer.from('tenant-icon')),
      } as any,
      new S3PathHelper(),
      { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() } as any,
    );
  };

  const iconsOf = async () =>
    ((await service.buildManifest('shop.test'))['icons'] as Array<{
      src: string;
      sizes: string;
      purpose: string;
    }>);
  const themeOf = async () =>
    String((await service.buildManifest('shop.test'))['theme_color']);

  it('una tienda con logo publica sus cuatro íconos en URLs versionadas por su logo', async () => {
    build(LOGO);
    const icons = await iconsOf();

    expect(icons.map((i) => i.src.match(VERSIONED_ICON)?.[2])).toEqual(
      VARIANTS,
    );
    const versions = new Set(icons.map((i) => i.src.match(VERSIONED_ICON)?.[1]));
    expect(versions.size).toBe(1);
    const [version] = [...versions];
    expect(version).not.toBe(PWA_BRAND_ICON_VERSION);
    expect(version).toBe(pwaIconVersion(LOGO, await themeOf()));
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512')).toBe(true);
  });

  it('cambiar el logo cambia la URL de los íconos (ninguna caché sirve el viejo)', () => {
    expect(pwaIconVersion(LOGO, '#2ecc71')).not.toBe(
      pwaIconVersion(`${STORE_PATH}/logos/new.webp`, '#2ecc71'),
    );
  });

  it('una tienda sin logo usa la versión «brand», nunca una versión de tienda', async () => {
    build(null);
    for (const icon of await iconsOf()) {
      expect(icon.src).toMatch(/^\/pwa\/v\/brand\//);
    }
  });

  it('el ícono de la tienda se sirve con su logo y solo es inmutable bajo su versión actual', async () => {
    build(LOGO);
    const icon = await service.resolveIconBuffer('shop.test', 'icon-512');
    const version = pwaIconVersion(LOGO, await themeOf());

    expect(icon.fromTenant).toBe(true);
    expect(icon.buffer.toString()).toBe('tenant-icon');
    expect(icon.version).toBe(version);
    expect(pwaIconCacheControl(icon, version)).toBe(PWA_ICON_IMMUTABLE_CACHE);
    expect(pwaIconCacheControl(icon, null)).toBe(PWA_ICON_SHORT_CACHE);
    expect(pwaIconCacheControl(icon, 'abcdefabcdef')).toBe(
      PWA_ICON_SHORT_CACHE,
    );
  });

  it('el ícono de respaldo de Vendix NUNCA se cachea como inmutable', async () => {
    build(null);
    const icon = await service.resolveIconBuffer('shop.test', 'icon-512');

    expect(icon.fromTenant).toBe(false);
    for (const requested of [null, PWA_BRAND_ICON_VERSION, 'abcdefabcdef']) {
      expect(pwaIconCacheControl(icon, requested)).toBe(PWA_ICON_SHORT_CACHE);
    }
  });

  it('el backend registra la ruta versionada de los íconos', () => {
    const main = readFileSync(join(REPO_ROOT, 'apps/backend/src/main.ts'), 'utf8');
    expect(main).toMatch(/httpAdapter\.get\(\s*'\/pwa\/v\/:version\/:asset'/);
    expect(main).toMatch(/pwaIconCacheControl\(/);
    expect(main).not.toMatch(/max-age=604800, immutable/);
  });

  it('el index.html enlaza el manifest dinámico del mismo origen y no lo reemplaza', () => {
    const html = readFileSync(
      join(REPO_ROOT, 'apps/frontend/src/index.html'),
      'utf8',
    );
    const manifests = html.match(/<link[^>]+rel="manifest"[^>]*>/g) ?? [];
    expect(manifests).toEqual([
      expect.stringContaining('href="/manifest.webmanifest"'),
    ]);
    // Un rel="icon" PNG de /pwa/ le gana el favicon por tienda (ver index.html).
    expect(html).not.toMatch(/<link[^>]+rel="icon"[^>]+href="\/pwa\//);
  });
});
