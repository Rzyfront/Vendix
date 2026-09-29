import {
  createPlanningTools,
  PROPOSE_PLAN_TOOL,
} from './planning.tools';
import { AGENT_PLAN_TOOLS } from '../../interfaces/agent-plan.interface';

describe('planning.tools', () => {
  const tools = createPlanningTools();
  const byName = (n: string) => tools.find((t) => t.name === n)!;

  it('publica exactamente los 7 tools del contrato, readOnly y domain planning', () => {
    expect(tools.map((t) => t.name)).toEqual([...AGENT_PLAN_TOOLS]);
    for (const t of tools) {
      expect(t.domain).toBe('planning');
      expect(t.readOnly).toBe(true);
    }
    expect(PROPOSE_PLAN_TOOL).toBe('propose_plan');
  });

  it('propose_plan de respaldo: next_step sin el texto viejo y prohíbe mencionar el plan', async () => {
    const out = JSON.parse(
      await byName('propose_plan').handler!(
        {
          goal: 'g',
          deliverables: [{ description: 'x' }],
          steps: [{ title: 'a', kind: 'cambio', done_when: 'y' }],
        },
        {} as any,
      ),
    );
    expect(out.plan_declared).toBe(true);
    expect(out.steps).toEqual([
      { order: 1, title: 'a', kind: 'cambio', needs_user_decision: false },
    ]);
    expect(out.next_step).toContain('NUNCA menciones plan, pasos, tareas ni entregables');
    expect(out.next_step).not.toContain('Resúmele');
    expect(out.next_step).not.toContain('un paso por turno');
  });

  it('propose_plan de respaldo recorta a 12 pasos', async () => {
    const steps = Array.from({ length: 15 }, (_, i) => ({ title: `p${i}`, kind: 'verificacion' }));
    const out = JSON.parse(
      await byName('propose_plan').handler!({ goal: 'g', steps }, {} as any),
    );
    expect(out.steps).toHaveLength(12);
    expect(out.dropped).toBe(3);
  });

  it('respaldos stateless devuelven ok:false; ask_user devuelve ask:true', async () => {
    for (const n of ['update_plan_step', 'verify_deliverables', 'revise_plan', 'pause_plan', 'resume_plan']) {
      expect(JSON.parse(await byName(n).handler!({}, {} as any))).toEqual({
        ok: false,
        reason: 'sin conversación: el plan no se persiste en esta superficie',
      });
    }
    expect(JSON.parse(await byName('ask_user').handler!({ question: '¿Cuál?' }, {} as any))).toEqual({
      ask: true,
      question: '¿Cuál?',
    });
  });
});
