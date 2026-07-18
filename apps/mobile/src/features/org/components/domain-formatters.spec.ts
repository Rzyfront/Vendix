import {
  formatAppType,
  formatOwnership,
  formatStatus,
  formatSslStatus,
  getAppTypeColor,
  getOwnershipColor,
  getStatusColor,
  getSslStatusColor,
  DOMAIN_STATUS_OPTIONS,
  DOMAIN_OWNERSHIP_OPTIONS,
  APP_TYPE_OPTIONS,
} from './domain-formatters';

describe('domain-formatters', () => {
  describe('formatAppType', () => {
    it('returns the Spanish label for known app types', () => {
      expect(formatAppType('STORE_ECOMMERCE')).toBe('E-commerce');
      expect(formatAppType('STORE_LANDING')).toBe('Landing de Tienda');
      expect(formatAppType('STORE_ADMIN')).toBe('Admin de Tienda');
      expect(formatAppType('ORG_LANDING')).toBe('Landing de Organización');
      expect(formatAppType('ORG_ADMIN')).toBe('Admin de Organización');
    });

    it('returns N/A for null/undefined', () => {
      expect(formatAppType(null)).toBe('N/A');
      expect(formatAppType(undefined)).toBe('N/A');
    });

    it('falls back to the raw string for unknown values', () => {
      expect(formatAppType('FOO_BAR')).toBe('FOO_BAR');
    });
  });

  describe('formatOwnership', () => {
    it('returns the Spanish label for known ownerships', () => {
      expect(formatOwnership('VENDIX_SUBDOMAIN')).toBe('Subdominio Vendix');
      expect(formatOwnership('CUSTOM_DOMAIN')).toBe('Dominio Personalizado');
      expect(formatOwnership('CUSTOM_SUBDOMAIN')).toBe('Subdominio Personalizado');
      expect(formatOwnership('THIRD_PARTY_SUBDOMAIN')).toBe('Subdominio Terceros');
    });
  });

  describe('formatStatus', () => {
    it('returns the Spanish label for known domain statuses', () => {
      expect(formatStatus('PENDING')).toBe('Pendiente');
      expect(formatStatus('ACTIVE')).toBe('Activo');
      expect(formatStatus('PENDING_DNS')).toBe('DNS Pendiente');
      expect(formatStatus('PENDING_CERTIFICATE')).toBe('Certificado pendiente');
      expect(formatStatus('ISSUING_CERTIFICATE')).toBe('Emitiendo certificado');
      expect(formatStatus('PROPAGATING')).toBe('Propagando SSL');
      expect(formatStatus('FAILED_CERTIFICATE')).toBe('Falló certificado');
    });

    it('returns Desconocido for null/undefined', () => {
      expect(formatStatus(null)).toBe('Desconocido');
      expect(formatStatus(undefined)).toBe('Desconocido');
    });
  });

  describe('formatSslStatus', () => {
    it('returns the Spanish label for known SSL statuses', () => {
      expect(formatSslStatus('PENDING')).toBe('Pendiente');
      expect(formatSslStatus('ISSUED')).toBe('Emitido');
      expect(formatSslStatus('PROVISIONING')).toBe('Aprovisionando');
      expect(formatSslStatus('REVOKED')).toBe('Revocado');
    });

    it('returns N/A for null/undefined', () => {
      expect(formatSslStatus(null)).toBe('N/A');
    });
  });

  describe('color getters return deterministic colors', () => {
    it('keeps ACTIVE → green and FAILED → red', () => {
      expect(getStatusColor('ACTIVE')).toBe('#22c55e');
      expect(getStatusColor('FAILED')).toBe('#ef4444');
    });

    it('keeps SSL ACTIVE → green and ERROR → red', () => {
      expect(getSslStatusColor('ACTIVE')).toBe('#22c55e');
      expect(getSslStatusColor('ERROR')).toBe('#ef4444');
    });

    it('falls back to gray for unknown values', () => {
      expect(getStatusColor('UNKNOWN_X')).toBe('#9ca3af');
      expect(getAppTypeColor('UNKNOWN_X')).toBe('#9ca3af');
      expect(getOwnershipColor('UNKNOWN_X')).toBe('#9ca3af');
      expect(getSslStatusColor('UNKNOWN_X')).toBe('#9ca3af');
    });
  });

  describe('option arrays are non-empty and have unique values', () => {
    it('DOMAIN_STATUS_OPTIONS has unique values', () => {
      const values = DOMAIN_STATUS_OPTIONS.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      expect(values.length).toBeGreaterThanOrEqual(10);
    });

    it('DOMAIN_OWNERSHIP_OPTIONS has unique values', () => {
      const values = DOMAIN_OWNERSHIP_OPTIONS.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    });

    it('APP_TYPE_OPTIONS has unique values', () => {
      const values = APP_TYPE_OPTIONS.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    });
  });
});
