import {
  API_HOSTS,
  normalizeHostname,
  resolveTenantHostname,
} from './tenant-hostname.util';
import { DomainConfigService } from '../config/domain.config';

const req = (headers: Record<string, string | string[] | undefined>) =>
  ({ headers }) as any;

describe('tenant-hostname.util', () => {
  describe('API_HOSTS', () => {
    it('contains both live API apexes and nothing else', () => {
      // Deliberate guard: the platform runs two API apexes simultaneously.
      // Changing this set must surface as a test diff, never as a silent edit.
      expect([...API_HOSTS].sort()).toEqual([
        'api.vendix.com',
        'api.vendix.online',
      ]);
    });
  });

  describe('normalizeHostname', () => {
    it('lowercases the host', () => {
      expect(normalizeHostname('NIKE.Vendix.Online')).toBe('nike.vendix.online');
    });

    it('strips the port', () => {
      expect(normalizeHostname('vendix.com:4200')).toBe('vendix.com');
    });

    it('keeps only the first hop of a comma-separated list', () => {
      expect(normalizeHostname('a.vendix.online, b.vendix.online')).toBe(
        'a.vendix.online',
      );
    });

    it('collapses an array-valued header to its first entry', () => {
      expect(normalizeHostname(['a.vendix.online', 'b.vendix.online'])).toBe(
        'a.vendix.online',
      );
    });

    it('drops characters that are not valid in a hostname', () => {
      expect(normalizeHostname('  nike.vendix.online/../evil  ')).toBe(
        'nike.vendix.online..evil',
      );
    });

    it('strips CR/LF so a header value cannot smuggle control characters', () => {
      const smuggled = normalizeHostname(
        'nike.vendix.online\r\nX-Injected: 1',
      );
      expect(smuggled).not.toMatch(/[\r\n]/);
      expect(smuggled).toBe('nike.vendix.onlinex-injected');
    });

    it('returns an empty string for empty / null / undefined', () => {
      expect(normalizeHostname(undefined)).toBe('');
      expect(normalizeHostname(null)).toBe('');
      expect(normalizeHostname('')).toBe('');
      expect(normalizeHostname('   ')).toBe('');
    });
  });

  describe('resolveTenantHostname', () => {
    it('QUI-564: the viewer Host beats the fixed X-Forwarded-Host injected by CloudFront', () => {
      // If this test goes red, the bug is back.
      expect(
        resolveTenantHostname(
          req({
            host: 'nike.vendix.online',
            'x-forwarded-host': 'vendix.online',
          }),
        ),
      ).toBe('nike.vendix.online');
    });

    it('returns the viewer Host when there is no proxy header', () => {
      expect(resolveTenantHostname(req({ host: 'nike.vendix.online' }))).toBe(
        'nike.vendix.online',
      );
    });

    it('falls back to x-forwarded-host when Host is the API itself', () => {
      expect(
        resolveTenantHostname(
          req({
            host: 'api.vendix.online',
            'x-forwarded-host': 'nike.vendix.online',
          }),
        ),
      ).toBe('nike.vendix.online');
      expect(
        resolveTenantHostname(
          req({
            host: 'api.vendix.com',
            'x-forwarded-host': 'nike.vendix.online',
          }),
        ),
      ).toBe('nike.vendix.online');
    });

    it('takes the first hop of a comma-separated x-forwarded-host chain', () => {
      expect(
        resolveTenantHostname(
          req({
            host: 'api.vendix.online',
            'x-forwarded-host': 'nike.vendix.online, edge.vendix.online',
          }),
        ),
      ).toBe('nike.vendix.online');
    });

    it('strips the port from the viewer Host (local dev: vendix.com:4200)', () => {
      expect(resolveTenantHostname(req({ host: 'vendix.com:4200' }))).toBe(
        'vendix.com',
      );
      expect(
        resolveTenantHostname(req({ host: 'nike.vendix.online:8443' })),
      ).toBe('nike.vendix.online');
    });

    it('is case-insensitive on both headers', () => {
      expect(resolveTenantHostname(req({ host: 'NIKE.VENDIX.ONLINE' }))).toBe(
        'nike.vendix.online',
      );
      // An uppercase API Host must still be recognized as an API host, or the
      // fallback to x-forwarded-host never fires and the tenant gets garbage.
      expect(
        resolveTenantHostname(
          req({
            host: 'API.Vendix.Online',
            'x-forwarded-host': 'Nike.Vendix.Online',
          }),
        ),
      ).toBe('nike.vendix.online');
    });

    it('keeps the API host when it is the only signal (direct hit, no proxy)', () => {
      // Preserved from the original closure in main.ts: it is NOT replaced by
      // the base domain, so the production-validated PWA path is unchanged.
      expect(resolveTenantHostname(req({ host: 'api.vendix.online' }))).toBe(
        'api.vendix.online',
      );
    });

    it('falls back to the base domain when both headers are absent or empty', () => {
      const base = DomainConfigService.getBaseDomain();
      expect(resolveTenantHostname(req({}))).toBe(base);
      expect(
        resolveTenantHostname(req({ host: '', 'x-forwarded-host': '' })),
      ).toBe(base);
      expect(resolveTenantHostname({ headers: undefined } as any)).toBe(base);
    });
  });
});
