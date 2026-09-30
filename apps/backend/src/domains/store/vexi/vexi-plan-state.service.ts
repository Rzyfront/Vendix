import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  AgentPlan,
  AgentPlanDeliverable,
  AgentPlanHook,
  AgentPlanStep,
  AgentPlanStepStatus,
  AgentPlanStatus,
  AgentPlanToolName,
  AgentPlanToolOutcome,
} from '../../../ai-engine/interfaces/agent-plan.interface';
import { MAX_PLAN_STEPS } from '../../../ai-engine/tools/domains/planning.tools';

/** Un plan sin movimiento en este lapso se da por abandonado. */
export const PLAN_TTL_MS = 24 * 60 * 60 * 1000;

const DONE_LIKE: AgentPlanStepStatus[] = ['done', 'skipped', 'rejected'];

function reject(error: string): AgentPlanToolOutcome {
  return { result: JSON.stringify({ ok: false, error }) };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function summarize(plan: AgentPlan) {
  const open = (s: AgentPlanStepStatus) =>
    plan.steps
      .filter((x) => x.status === s)
      .map((x) => ({ order: x.order, title: x.title, kind: x.kind }));
  return {
    plan_status: plan.status,
    in_progress: open('in_progress'),
    pending: open('pending'),
    waiting_user: plan.steps
      .filter((x) => x.status === 'waiting_user')
      .map((x) => ({ order: x.order, title: x.title, question: x.question })),
    unverified_deliverables: plan.deliverables
      .filter((d) => !d.verified)
      .map((d) => ({ id: d.id, description: d.description })),
  };
}

function ok(plan: AgentPlan, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ ok: true, ...extra, estado: summarize(plan) });
}

/**
 * Bloque de texto para inyectar como mensaje system en cada turno. Es la guía
 * interna del agente: nunca se muestra a la persona.
 */
export function renderPlanForModel(plan: AgentPlan): string {
  const lines: string[] = [];
  lines.push(`LISTA INTERNA DE TAREAS (${plan.status})`);
  lines.push(`Objetivo: ${plan.goal}`);
  lines.push('Entregables:');
  for (const d of plan.deliverables) {
    lines.push(
      `- ${d.id}: ${d.description} — ${d.verified ? `✓${d.evidence ? ` (${d.evidence})` : ''}` : 'pendiente'}`,
    );
  }
  lines.push('Pasos:');
  for (const s of plan.steps) {
    const extra = s.evidence ? ` [evidencia: ${s.evidence}]` : '';
    lines.push(
      `${s.order}. [${s.status}] (${s.kind}) ${s.title} — listo cuando: ${s.done_when}${extra}`,
    );
  }
  const waiting = plan.steps.find(
    (s) => s.status === 'waiting_user' && s.question,
  );
  if (waiting) {
    lines.push(`Pregunta pendiente a la persona: ${waiting.question}`);
  }
  lines.push(
    'Esto es tu guía interna; nunca la menciones a la persona (ni plan, ni pasos, ni tareas, ni entregables). Encadena lecturas y verificaciones sin detenerte; detente solo ante una escritura o con ask_user.',
  );
  return lines.join('\n');
}

/**
 * Estado persistido del task list interno de Vexi:
 * `ai_conversations.metadata.agent_plan`. Read-modify-write que preserva las
 * llaves ajenas de `metadata` (p. ej. `agent_key`).
 */
@Injectable()
export class VexiPlanStateService {
  constructor(private readonly prisma: StorePrismaService) {}

  async get(conversationId: number): Promise<AgentPlan | null> {
    const { plan } = await this.load(conversationId);
    return plan;
  }

  async getActive(conversationId: number): Promise<AgentPlan | null> {
    const plan = await this.get(conversationId);
    return plan && plan.status === 'active' ? plan : null;
  }

  async setStatus(
    conversationId: number,
    status: AgentPlanStatus,
  ): Promise<AgentPlan | null> {
    const { plan, metadata } = await this.load(conversationId);
    if (!plan) return null;
    plan.status = status;
    await this.save(conversationId, metadata, plan);
    return plan;
  }

  async markCurrentChangeStep(
    conversationId: number,
    status: 'done' | 'rejected',
    evidence?: string,
  ): Promise<AgentPlan | null> {
    const { plan, metadata } = await this.load(conversationId);
    if (!plan) return null;
    const step =
      plan.steps.find((s) => s.kind === 'cambio' && s.status === 'in_progress') ??
      plan.steps.find((s) => s.kind === 'cambio' && s.status === 'pending');
    if (!step) return plan;
    step.status = status;
    if (evidence) step.evidence = evidence;
    delete step.question;
    await this.save(conversationId, metadata, plan);
    return plan;
  }

  createHook(conversationId: number): AgentPlanHook {
    return {
      execute: (name, args) => this.execute(conversationId, name, args ?? {}),
      snapshot: () => this.getActive(conversationId),
    };
  }

  // ── ejecución de tools ────────────────────────────────────────────────

  private async execute(
    conversationId: number,
    name: AgentPlanToolName,
    args: Record<string, any>,
  ): Promise<AgentPlanToolOutcome> {
    const { plan: current, metadata } = await this.load(conversationId);

    if (name === 'propose_plan') {
      return this.propose(conversationId, metadata, current, args);
    }
    if (name === 'resume_plan') {
      if (!current || (current.status !== 'paused' && current.status !== 'active')) {
        return reject('no hay plan activo');
      }
      current.status = 'active';
      await this.save(conversationId, metadata, current);
      return { result: ok(current) };
    }

    if (!current || current.status !== 'active') {
      return reject('no hay plan activo');
    }
    const plan = current;
    let outcome: AgentPlanToolOutcome;

    switch (name) {
      case 'update_plan_step':
        outcome = this.updateStep(plan, args);
        break;
      case 'verify_deliverables':
        outcome = this.verify(plan, args);
        break;
      case 'ask_user':
        outcome = this.ask(plan, args);
        break;
      case 'revise_plan':
        outcome = this.revise(plan, args);
        break;
      case 'pause_plan':
        plan.status = 'paused';
        outcome = { result: ok(plan, { reason: str(args.reason) }) };
        break;
      default:
        return reject(`herramienta desconocida: ${String(name)}`);
    }

    // Un rechazo no cambia estado: no se persiste.
    if (!outcome.result.startsWith('{"ok":false')) {
      await this.save(conversationId, metadata, plan);
    }
    return outcome;
  }

  private async propose(
    conversationId: number,
    metadata: Record<string, any>,
    previous: AgentPlan | null,
    args: Record<string, any>,
  ): Promise<AgentPlanToolOutcome> {
    const rawDel = Array.isArray(args.deliverables) ? args.deliverables : [];
    const rawSteps = Array.isArray(args.steps) ? args.steps : [];
    const descriptions = rawDel.map((d: any) => str(d?.description)).filter(Boolean);
    if (descriptions.length === 0) {
      return reject(
        'define al menos un entregable verificable (deliverables[].description)',
      );
    }
    if (rawSteps.length === 0) {
      return reject('define al menos un paso');
    }
    const steps: AgentPlanStep[] = [];
    for (const [i, raw] of rawSteps.slice(0, MAX_PLAN_STEPS).entries()) {
      const kind = raw?.kind === 'cambio' ? 'cambio' : 'verificacion';
      const doneWhen = str(raw?.done_when);
      if (kind === 'cambio' && !doneWhen) {
        return reject(
          `el paso ${i + 1} es un cambio y necesita done_when (criterio verificable)`,
        );
      }
      steps.push({
        order: i + 1,
        title: str(raw?.title) || `Paso ${i + 1}`,
        kind,
        done_when: doneWhen,
        status: 'pending',
        attempts: 0,
      });
    }
    const now = new Date().toISOString();
    const plan: AgentPlan = {
      id: randomUUID(),
      status: 'active',
      goal: str(args.goal),
      deliverables: descriptions.map((description: string, i: number) => ({
        id: `d${i + 1}`,
        description,
        verified: false,
      })),
      steps,
      created_at: now,
      updated_at: now,
    };
    // Solo se guarda el último plan; el previo queda superseded solo en el
    // resultado (no se conserva).
    await this.save(conversationId, metadata, plan);
    return {
      result: ok(plan, {
        plan_declared: true,
        superseded_previous: previous?.status === 'active',
        dropped: Math.max(0, rawSteps.length - steps.length),
        next_step:
          'Encadena lecturas y verificaciones sin detenerte; detente solo ante una escritura (tarjeta) o con ask_user. NUNCA menciones plan, pasos, tareas ni entregables a la persona.',
      }),
    };
  }

  private findStep(plan: AgentPlan, order: unknown): AgentPlanStep | undefined {
    return plan.steps.find((s) => s.order === Number(order));
  }

  private updateStep(
    plan: AgentPlan,
    args: Record<string, any>,
  ): AgentPlanToolOutcome {
    const step = this.findStep(plan, args.order);
    if (!step) return reject(`el paso ${String(args.order)} no existe`);
    const status = args.status as AgentPlanStepStatus;
    if (!['in_progress', 'done', 'failed', 'skipped'].includes(status)) {
      return reject('status inválido: usa in_progress, done, failed o skipped');
    }
    const evidence = str(args.evidence);
    if (status === 'done' && step.kind === 'cambio' && !evidence) {
      return reject(
        'un paso de cambio solo se marca done con evidence: lee el sistema y cita el dato real',
      );
    }
    step.status = status;
    if (evidence) step.evidence = evidence;
    if (str(args.note)) step.note = str(args.note);
    delete step.question;
    let extra: Record<string, unknown> = {};
    if (status === 'failed') {
      step.attempts += 1;
      if (step.attempts >= 2) {
        extra = {
          instruccion:
            'explícale a la persona qué pasó y pregúntale cómo seguir con ask_user',
        };
      }
    }
    plan.updated_at = new Date().toISOString();
    return { result: ok(plan, extra) };
  }

  private verify(plan: AgentPlan, args: Record<string, any>): AgentPlanToolOutcome {
    const items = Array.isArray(args.deliverables) ? args.deliverables : [];
    if (items.length === 0) return reject('indica los entregables a verificar');
    for (const it of items) {
      const d = plan.deliverables.find((x) => x.id === String(it?.id));
      if (!d) return reject(`el entregable ${String(it?.id)} no existe`);
      if (it?.verified === true && !str(it?.evidence)) {
        return reject(
          `el entregable ${d.id} solo se verifica con evidence: cita el dato real leído del sistema`,
        );
      }
    }
    for (const it of items) {
      const d = plan.deliverables.find((x) => x.id === String(it.id)) as AgentPlanDeliverable;
      d.verified = it.verified === true;
      if (str(it.evidence)) d.evidence = str(it.evidence);
    }
    plan.updated_at = new Date().toISOString();
    const stepsClosed = plan.steps.every((s) => DONE_LIKE.includes(s.status));
    if (stepsClosed && plan.deliverables.every((d) => d.verified)) {
      plan.status = 'done';
      return {
        result: ok(plan, {
          instruccion:
            'Todo está verificado. Redacta ahora la respuesta final en prosa natural con los datos reales (nombres, números, estados), sin mencionar plan, pasos, tareas ni entregables.',
        }),
      };
    }
    return { result: ok(plan) };
  }

  private ask(plan: AgentPlan, args: Record<string, any>): AgentPlanToolOutcome {
    const question = str(args.question);
    if (!question) return reject('escribe la pregunta para la persona');
    const step =
      (args.step_order != null ? this.findStep(plan, args.step_order) : undefined) ??
      plan.steps.find((s) => s.status === 'in_progress') ??
      plan.steps.find((s) => s.status === 'pending');
    if (step) {
      step.status = 'waiting_user';
      step.question = question;
    }
    plan.updated_at = new Date().toISOString();
    return { result: ok(plan, { asked: true }), endTurn: { text: question } };
  }

  private revise(plan: AgentPlan, args: Record<string, any>): AgentPlanToolOutcome {
    const removeOrders: number[] = Array.isArray(args.remove_orders)
      ? args.remove_orders.map(Number)
      : [];
    const updates: any[] = Array.isArray(args.update_steps) ? args.update_steps : [];
    const adds: any[] = Array.isArray(args.add_steps) ? args.add_steps : [];

    for (const o of [...removeOrders, ...updates.map((u) => Number(u?.order))]) {
      const s = this.findStep(plan, o);
      if (!s) return reject(`el paso ${o} no existe`);
      if (s.status === 'done') {
        return reject(`el paso ${o} ya está hecho: no se modifica ni se elimina`);
      }
    }
    const newSteps: Array<{ raw: any; step: AgentPlanStep }> = [];
    for (const raw of adds) {
      const kind = raw?.kind === 'cambio' ? 'cambio' : 'verificacion';
      const doneWhen = str(raw?.done_when);
      if (kind === 'cambio' && !doneWhen) {
        return reject('todo paso de cambio nuevo necesita done_when');
      }
      newSteps.push({
        raw,
        step: {
          order: 0,
          title: str(raw?.title) || 'Paso',
          kind,
          done_when: doneWhen,
          status: 'pending',
          attempts: 0,
        },
      });
    }

    let steps = plan.steps.filter((s) => !removeOrders.includes(s.order));
    // Para insertar por after_order se usa el objeto de referencia (los
    // órdenes se renumeran al final).
    const byOriginal = new Map(plan.steps.map((s) => [s.order, s]));
    for (const u of updates) {
      const s = byOriginal.get(Number(u.order))!;
      if (str(u.title)) s.title = str(u.title);
      if (str(u.done_when)) s.done_when = str(u.done_when);
    }
    for (const { raw, step } of newSteps) {
      const ref =
        raw?.after_order != null ? byOriginal.get(Number(raw.after_order)) : undefined;
      const idx = ref ? steps.indexOf(ref) : -1;
      if (idx >= 0) steps.splice(idx + 1, 0, step);
      else steps.push(step);
    }
    if (steps.length > MAX_PLAN_STEPS) {
      return reject(
        `el plan quedaría con ${steps.length} pasos y el máximo es ${MAX_PLAN_STEPS}`,
      );
    }
    steps = steps.map((s, i) => ({ ...s, order: i + 1 }));
    plan.steps = steps;

    const addDel: any[] = Array.isArray(args.add_deliverables) ? args.add_deliverables : [];
    let n = plan.deliverables.length;
    for (const d of addDel) {
      const description = str(d?.description);
      if (!description) continue;
      n += 1;
      plan.deliverables.push({ id: `d${n}`, description, verified: false });
    }
    if (str(args.goal)) plan.goal = str(args.goal);
    plan.updated_at = new Date().toISOString();
    return { result: ok(plan) };
  }

  // ── persistencia ──────────────────────────────────────────────────────

  private async load(
    conversationId: number,
  ): Promise<{ metadata: Record<string, any>; plan: AgentPlan | null }> {
    const row = await this.prisma.ai_conversations.findFirst({
      where: { id: conversationId },
      select: { metadata: true },
    });
    const raw = row?.metadata;
    const metadata: Record<string, any> =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as any) } : {};
    const plan = (metadata.agent_plan as AgentPlan | undefined) ?? null;
    if (!plan) return { metadata, plan: null };

    const age = Date.now() - new Date(plan.updated_at).getTime();
    if ((plan.status === 'active' || plan.status === 'paused') && age > PLAN_TTL_MS) {
      plan.status = 'abandoned';
      await this.save(conversationId, metadata, plan, false);
    }
    return { metadata, plan };
  }

  private async save(
    conversationId: number,
    metadata: Record<string, any>,
    plan: AgentPlan,
    touch = true,
  ): Promise<void> {
    if (touch) plan.updated_at = new Date().toISOString();
    await this.prisma.ai_conversations.updateMany({
      where: { id: conversationId },
      data: { metadata: { ...metadata, agent_plan: plan } as any },
    });
  }
}
