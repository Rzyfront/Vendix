import {
  AI_DRAFT_MAX_BYTES,
  AiDraftStatusResponse,
  mapAiDraftStatus,
  validateAiDraftFile,
} from './template-ai-draft.util';

describe('template-ai-draft.util', () => {
  describe('validateAiDraftFile', () => {
    it('rejects an unsupported type', () => {
      const r = validateAiDraftFile({ name: 'form.docx', type: 'application/msword', size: 1000 });
      expect(r.ok).toBeFalse();
      if (!r.ok) expect(r.message).toContain('PDF');
    });

    it('rejects a file over 10 MiB', () => {
      const r = validateAiDraftFile({ name: 'big.pdf', type: 'application/pdf', size: AI_DRAFT_MAX_BYTES + 1 });
      expect(r.ok).toBeFalse();
      if (!r.ok) expect(r.message).toContain('10 MB');
    });

    it('rejects an empty file', () => {
      expect(validateAiDraftFile({ name: 'a.pdf', type: 'application/pdf', size: 0 }).ok).toBeFalse();
    });

    it('accepts pdf and png', () => {
      expect(validateAiDraftFile({ name: 'a.pdf', type: 'application/pdf', size: 5000 }).ok).toBeTrue();
      expect(validateAiDraftFile({ name: 'a.PNG', type: '', size: 5000 }).ok).toBeTrue();
    });
  });

  describe('mapAiDraftStatus', () => {
    it('keeps waiting while pending', () => {
      expect(mapAiDraftStatus({ status: 'pending' }).kind).toBe('pending');
    });

    it('done with errors returns prefill text and errors', () => {
      const res: AiDraftStatusResponse = {
        status: 'done',
        json: { name: 'X' },
        errors: [{ path: 'name', message: 'bad' }],
      };
      const s = mapAiDraftStatus(res);
      expect(s.kind).toBe('done');
      if (s.kind === 'done') {
        expect(s.text).toBe(JSON.stringify({ name: 'X' }, null, 2));
        expect(s.errors).toEqual([{ path: 'name', message: 'bad' }]);
      }
    });

    it('failed not_configured says there is no vision model', () => {
      const s = mapAiDraftStatus({ status: 'failed', error_code: null, error_reason: 'not_configured', message: 'x' });
      expect(s.kind).toBe('failed');
      if (s.kind === 'failed') expect(s.message).toContain('visión');
    });

    it('failed AI_VISION_001 says there is no vision model', () => {
      const s = mapAiDraftStatus({ status: 'failed', error_code: 'AI_VISION_001', message: 'x' });
      if (s.kind === 'failed') expect(s.message).toContain('visión');
    });

    it('failed plan_quota says quota exhausted', () => {
      const s = mapAiDraftStatus({ status: 'failed', error_code: null, error_reason: 'plan_quota', message: 'x' });
      if (s.kind === 'failed') expect(s.message).toContain('cuota');
    });

    it('generic failed shows the server message', () => {
      const s = mapAiDraftStatus({ status: 'failed', error_code: 'X', message: 'No se pudo leer el PDF' });
      if (s.kind === 'failed') expect(s.message).toBe('No se pudo leer el PDF');
    });
  });
});
