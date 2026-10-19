import { TestBed } from '@angular/core/testing';
import { VexiToolTraceComponent } from './vexi-tool-trace.component';
import type { ToolStep } from '../../../core/store/vexi/vexi.actions';
import type { VexiToolExecution } from '../../../core/services/vexi-api.service';

/** Gate noJargon (plan §5.3) over everything the trace puts on screen. */
const NO_JARGON =
  /postcondici|search_tools|search_playbooks|load_playbook|playbook|objetivo original|next_step|next_action|semantic_status|requires_revalidation|Conservo el avance|evidencia suficiente|no está verificada|RECUPERACIÓN TÉCNICA|inferencia|schema|preflight|fingerprint|lease|tool_call:|objective:|\(interno\)|BATCH_NOT|AI_AGENT_/i;

const receipt = (
  patch: Partial<VexiToolExecution> = {},
): VexiToolExecution => ({
  schema_version: '1',
  status: 'ok',
  freshness: 'observed',
  retryable: false,
  error_code: null,
  effect_status: 'not_applicable',
  evidence_refs: [],
  resource_ids: {},
  ...patch,
});

const step = (
  id: string,
  status: ToolStep['status'],
  execution?: VexiToolExecution,
  summary?: string,
): ToolStep => ({
  id,
  name: 'get_cash_session_status',
  status,
  execution,
  summary,
});

async function render(steps: ToolStep[]) {
  const fixture = TestBed.createComponent(VexiToolTraceComponent);
  fixture.componentRef.setInput('steps', steps);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const component = fixture.componentInstance as unknown as {
    summary: () => string;
    rows: () => { text: string; summary: string; status: string }[];
  };
  return { host, component };
}

describe('VexiToolTraceComponent (texto visible del rastro)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [VexiToolTraceComponent] });
  });

  it('held-back calls are not counted as failures nor listed', async () => {
    const { component } = await render([
      step('a', 'done', receipt()),
      step('b', 'done', receipt()),
      step('c', 'done', receipt()),
      step(
        'd',
        'failed',
        receipt({
          status: 'recoverable_error',
          error_code: 'BATCH_NOT_DISPATCHED',
        }),
        'Busca la herramienta autorizada',
      ),
      step(
        'e',
        'failed',
        receipt({ status: 'blocked', error_code: 'AI_AGENT_TOOL_STAGED' }),
      ),
    ]);
    expect(component.summary()).toBe('Consulté 3 datos');
    expect(component.rows().length).toBe(3);
  });

  it('a compacted read reads as a normal read, without a warning', async () => {
    const { component } = await render([
      step('a', 'done', receipt({ freshness: 'truncated' })),
      step('b', 'done', receipt({ compacted: true })),
    ]);
    expect(component.summary()).toBe('Consulté 2 datos');
    for (const row of component.rows()) {
      expect(row.text).toBe('Consulté la caja');
      expect(row.summary).toBe('');
    }
  });

  it('maps error codes to store language and never shows receipt notes', async () => {
    const { host, component } = await render([
      step(
        'a',
        'failed',
        receipt({
          status: 'blocked',
          error_code: 'NOT_ALLOWED',
          next_action: 'Usa search_tools para buscar la herramienta',
        }),
        'Busca la herramienta autorizada con search_tools',
      ),
      step(
        'b',
        'failed',
        receipt({ status: 'recoverable_error', error_code: 'SOMETHING_NEW' }),
      ),
    ]);
    const texts = component.rows().map((row) => row.text);
    expect(texts).toEqual([
      'No tienes permiso para esta consulta.',
      'No pude consultar este dato.',
    ]);
    expect(component.rows().every((row) => row.summary === '')).toBeTrue();
    expect(host.textContent ?? '').not.toMatch(NO_JARGON);
  });

  it('drops raw payloads and internal notes from the detail line', async () => {
    const { host, component } = await render([
      step('a', 'done', undefined, '{"rows":[1,2,3]}'),
      step(
        'b',
        'done',
        undefined,
        'Conservo el avance, faltan postcondiciones',
      ),
      step('c', 'done', undefined, 'Caja abierta desde las 8:00'),
    ]);
    expect(component.rows().map((row) => row.summary)).toEqual([
      '',
      '',
      'Caja abierta desde las 8:00',
    ]);
    expect(host.textContent ?? '').not.toMatch(NO_JARGON);
  });
});
