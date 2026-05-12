import {
  getWompiRolloutMode,
  isLegacyInlineTokenAllowed,
  isWompiRecurrentEnforced,
} from './wompi-rollout.config';

/**
 * Wompi rollout flag — covers all branches of the env var read.
 *
 * The flag is read from `process.env.WOMPI_RECURRENT_ENFORCE` on every
 * call, so the contract is a strict equality with the literal string
 * `'true'`. Anything else (undefined, '', '0', 'false', 'TRUE', etc.) keeps
 * the system in log-only mode.
 */
describe('wompi-rollout.config', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('isWompiRecurrentEnforced', () => {
    it('returns false when WOMPI_RECURRENT_ENFORCE is undefined', () => {
      delete process.env.WOMPI_RECURRENT_ENFORCE;
      expect(isWompiRecurrentEnforced()).toBe(false);
    });

    it("returns false when WOMPI_RECURRENT_ENFORCE='false'", () => {
      process.env.WOMPI_RECURRENT_ENFORCE = 'false';
      expect(isWompiRecurrentEnforced()).toBe(false);
    });

    it("returns true when WOMPI_RECURRENT_ENFORCE='true'", () => {
      process.env.WOMPI_RECURRENT_ENFORCE = 'true';
      expect(isWompiRecurrentEnforced()).toBe(true);
    });
  });

  describe('isLegacyInlineTokenAllowed', () => {
    it('returns true when WOMPI_RECURRENT_ENFORCE is undefined (log-only default)', () => {
      delete process.env.WOMPI_RECURRENT_ENFORCE;
      expect(isLegacyInlineTokenAllowed()).toBe(true);
    });

    it("returns true when WOMPI_RECURRENT_ENFORCE='false'", () => {
      process.env.WOMPI_RECURRENT_ENFORCE = 'false';
      expect(isLegacyInlineTokenAllowed()).toBe(true);
    });

    it("returns false when WOMPI_RECURRENT_ENFORCE='true'", () => {
      process.env.WOMPI_RECURRENT_ENFORCE = 'true';
      expect(isLegacyInlineTokenAllowed()).toBe(false);
    });
  });

  describe('getWompiRolloutMode', () => {
    it("returns 'log_only' when flag is undefined", () => {
      delete process.env.WOMPI_RECURRENT_ENFORCE;
      expect(getWompiRolloutMode()).toBe('log_only');
    });

    it("returns 'enforce' when WOMPI_RECURRENT_ENFORCE='true'", () => {
      process.env.WOMPI_RECURRENT_ENFORCE = 'true';
      expect(getWompiRolloutMode()).toBe('enforce');
    });
  });
});
