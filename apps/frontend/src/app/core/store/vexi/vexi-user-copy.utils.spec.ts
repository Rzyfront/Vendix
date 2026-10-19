import { HttpErrorResponse } from '@angular/common/http';
import {
  VEXI_OBJECTIVE_CONFLICT_COPY,
  parseVexiObjectiveConflict,
  vexiConflictFromNotice,
  vexiErrorText,
  vexiIsNonFailureCode,
  vexiVisibleDetail,
} from './vexi-user-copy.utils';

const http409 = (error: unknown) =>
  new HttpErrorResponse({ status: 409, statusText: 'Conflict', error });

describe('vexi-user-copy: conversación bloqueada (409)', () => {
  it('reads every body shape the backend can send', () => {
    expect(
      parseVexiObjectiveConflict(
        http409({ error_code: 'AI_OBJECTIVE_REQUIRES_RESUME', message: 'x' }),
      ),
    ).toBe('requires_resume');
    expect(
      parseVexiObjectiveConflict(http409({ code: 'AI_OBJECTIVE_LEASE_BUSY' })),
    ).toBe('lease_busy');
    expect(
      parseVexiObjectiveConflict(
        http409({
          statusCode: 409,
          message: { error_code: 'AI_OBJECTIVE_REQUIRES_RESUME' },
        }),
      ),
    ).toBe('requires_resume');
    expect(
      parseVexiObjectiveConflict(
        http409({ statusCode: 409, message: 'AI_OBJECTIVE_LEASE_BUSY' }),
      ),
    ).toBe('lease_busy');
    expect(
      parseVexiObjectiveConflict({
        type: 'error',
        error: 'AI_OBJECTIVE_REQUIRES_RESUME',
      }),
    ).toBe('requires_resume');
    expect(
      parseVexiObjectiveConflict(new Error('AI_OBJECTIVE_LEASE_BUSY')),
    ).toBe('lease_busy');
  });

  it('ignores any other error', () => {
    expect(parseVexiObjectiveConflict(http409({ error_code: 'X' }))).toBeNull();
    expect(parseVexiObjectiveConflict(null)).toBeNull();
    expect(parseVexiObjectiveConflict('boom')).toBeNull();
  });

  it('round-trips the visible notice so the panel can offer a new conversation', () => {
    for (const kind of ['requires_resume', 'lease_busy'] as const) {
      expect(vexiConflictFromNotice(VEXI_OBJECTIVE_CONFLICT_COPY[kind])).toBe(
        kind,
      );
    }
    expect(vexiConflictFromNotice('Otro error')).toBeNull();
    expect(vexiConflictFromNotice(null)).toBeNull();
  });
});

describe('vexi-user-copy: catálogo cerrado', () => {
  it('maps known codes and falls back for unknown ones', () => {
    expect(vexiErrorText('NOT_ALLOWED')).toBe(
      'No tienes permiso para esta consulta',
    );
    expect(vexiErrorText('AI_AGENT_TOOL_NOT_ALLOWED')).toBe(
      'No tienes permiso para esta consulta',
    );
    expect(vexiErrorText('WHATEVER')).toBe('No pude consultar este dato');
    expect(vexiErrorText(null)).toBe('No pude consultar este dato');
  });

  it('transport codes are not failures', () => {
    expect(vexiIsNonFailureCode('BATCH_NOT_DISPATCHED')).toBeTrue();
    expect(vexiIsNonFailureCode('AI_AGENT_TOOL_STAGED')).toBeTrue();
    expect(vexiIsNonFailureCode('NOT_ALLOWED')).toBeFalse();
    expect(vexiIsNonFailureCode(null)).toBeFalse();
  });

  it('visible detail drops payloads and internal notes', () => {
    expect(vexiVisibleDetail('{"a":1}')).toBe('');
    expect(vexiVisibleDetail('Usa search_tools')).toBe('');
    expect(vexiVisibleDetail(' Caja cerrada ')).toBe('Caja cerrada');
  });
});
