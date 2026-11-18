import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

import {
  AiScanJobError,
  aiJobErrorFromStatus,
  describeAiJobError,
} from './ai-job-error';
import { ERROR_MESSAGES } from './error-messages';

/** QUI-1020 — documento ilegible / fallo de Vendix / IA no disponible. */
describe('ai-job-error (QUI-1020)', () => {
  describe('aiJobErrorFromStatus', () => {
    it('respeta la categoría que manda el servidor', () => {
      const err = aiJobErrorFromStatus({
        status: 'failed',
        error: 'AI_PROVIDER_004',
        error_category: 'ai_unavailable',
        error_reason: 'rate_limited',
      });
      expect(err.category).toBe('ai_unavailable');
      expect(err.reason).toBe('rate_limited');
      expect(err.teamNotified).toBeTrue();
    });

    it('cuota del plan de la tienda: su propio texto y sin avisar al equipo', () => {
      const err = aiJobErrorFromStatus({ status: 'failed', error: 'SUBSCRIPTION_006' });
      expect(err.category).toBe('ai_unavailable');
      expect(err.reason).toBe('plan_quota');
      expect(err.message).toBe(ERROR_MESSAGES['SUBSCRIPTION_006']);
      expect(err.teamNotified).toBeFalse();
    });

    it('documento: usa el texto específico del código', () => {
      const err = aiJobErrorFromStatus({ status: 'failed', error: 'RTSCAN_PARSE_FAIL' });
      expect(err.category).toBe('document');
      expect(err.message).toBe(ERROR_MESSAGES['RTSCAN_PARSE_FAIL']);
    });
  });

  describe('describeAiJobError', () => {
    it('HTTP 400 al subir el archivo -> documento con el texto del backend', () => {
      const view = describeAiJobError(
        new HttpErrorResponse({
          status: 400,
          error: { error_code: 'RUT_SCAN_INVALID_FILE' },
        }),
      );
      expect(view.category).toBe('document');
      expect(view.message).toBe(ERROR_MESSAGES['RUT_SCAN_INVALID_FILE']);
    });

    it('sin conexión -> técnico, sin culpar al documento', () => {
      const view = describeAiJobError(new HttpErrorResponse({ status: 0 }));
      expect(view.category).toBe('technical');
      expect(view.message).toContain('No pudimos conectar con Vendix');
    });

    it('cuota agotada al encolar (402 SUBSCRIPTION_006) -> IA no disponible por plan', () => {
      const view = describeAiJobError(
        new HttpErrorResponse({ status: 402, error: { error_code: 'SUBSCRIPTION_006' } }),
      );
      expect(view.category).toBe('ai_unavailable');
      expect(view.reason).toBe('plan_quota');
    });

    it('timeout de RxJS -> atascado', () => {
      expect(describeAiJobError(new TimeoutError()).category).toBe('stalled');
    });

    it('conserva la categoría de un AiScanJobError y le pone título', () => {
      const view = describeAiJobError(new AiScanJobError('m', 'technical', 'X', null, true));
      expect(view).toEqual({
        category: 'technical',
        reason: null,
        code: 'X',
        title: 'Tuvimos un problema técnico',
        message: 'm',
        teamNotified: true,
      });
    });
  });
});
