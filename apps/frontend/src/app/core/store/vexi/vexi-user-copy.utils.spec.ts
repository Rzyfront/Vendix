import { HttpErrorResponse } from '@angular/common/http';
import {
  VEXI_OBJECTIVE_CONFLICT_COPY,
  VEXI_OBJECTIVE_SERVER_NOTICES,
  VEXI_STEP_DETAIL_COPY,
  parseVexiObjectiveConflict,
  vexiConflictFromNotice,
  vexiErrorText,
  vexiIsNonFailureCode,
  vexiIsScaffoldTool,
  vexiObjectiveConflictNotice,
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

  it('shows the specific server message only when it is in the closed catalog', () => {
    const pending = VEXI_OBJECTIVE_SERVER_NOTICES[0];
    const notice = vexiObjectiveConflictNotice(
      http409({ error_code: 'AI_OBJECTIVE_REQUIRES_RESUME', message: pending }),
    );
    expect(notice).toBe(pending);
    expect(vexiConflictFromNotice(notice)).toBe('requires_resume');
    expect(
      vexiObjectiveConflictNotice(
        http409({
          error_code: 'AI_OBJECTIVE_REQUIRES_RESUME',
          message: 'Usa resume_plan con el objective:42',
        }),
      ),
    ).toBe(VEXI_OBJECTIVE_CONFLICT_COPY.requires_resume);
    expect(
      vexiObjectiveConflictNotice(http409({ error_code: 'AI_OBJECTIVE_LEASE_BUSY' })),
    ).toBe(VEXI_OBJECTIVE_CONFLICT_COPY.lease_busy);
    expect(vexiObjectiveConflictNotice(http409({ error_code: 'X' }))).toBeNull();
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

  it('visible detail is a whitelist: only catalog lines survive', () => {
    expect(vexiVisibleDetail('{"a":1}')).toBe('');
    expect(vexiVisibleDetail('Usa search_tools')).toBe('');
    // Real next_step of a ui_* command: human-looking, written for the model.
    expect(
      vexiVisibleDetail('Cuéntale exactamente qué pasó y qué tiene que hacer él.'),
    ).toBe('');
    expect(vexiVisibleDetail(' Caja cerrada ')).toBe('');
    for (const line of VEXI_STEP_DETAIL_COPY)
      expect(vexiVisibleDetail(` ${line} `)).toBe(line);
  });

  it('discovery and plan tools are scaffolding', () => {
    for (const name of ['search_tools', 'search_playbooks', 'load_playbook', 'load_recipe', 'propose_plan'])
      expect(vexiIsScaffoldTool(name)).toBeTrue();
    expect(vexiIsScaffoldTool('list_cash_sessions')).toBeFalse();
  });
});
