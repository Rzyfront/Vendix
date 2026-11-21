import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GoldenTurnObservation, gradeGoldenTurn } from './graders';

/**
 * Shape spec for the F2 governance cases (T20): action denied by the user's
 * role and the retired realtime voice. The per-agent quota case is not in the
 * corpus: the refusal is an HTTP 429 at stream-intent (the runner records it
 * as an error frame) and its counter lives in Redis, which setup_sql cannot
 * seed. It reads
 * the corpus only: no model, no database, no network.
 */
interface GovernanceCase {
  id: string;
  agent: 'vex' | 'vexi';
  principal: string;
  channel?: string;
  setup_sql?: string[];
  teardown_sql?: string[];
  turns: Array<{
    message: string;
    permission_notice?: 'allowed';
    expect_tools_any?: string[];
    expect_write?: boolean;
    expect_answer?: { min_chars: number; mentions_any: string[] };
    oracle?: { sql: string; unchanged?: boolean };
  }>;
}

const corpus: GovernanceCase[] = readFileSync(
  resolve(__dirname, 'golden-conversations.es.jsonl'),
  'utf8',
)
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const byPrefix = (prefix: string): GovernanceCase | undefined =>
  corpus.find((c) => c.id.startsWith(prefix));

const observe = (
  visible: string,
  agent: 'vex' | 'vexi',
  proposed = false,
): GoldenTurnObservation => ({
  agent,
  visible,
  tools: [],
  errorFrame: false,
  proposed,
  known: new Set(),
});

describe('golden governance cases — shape', () => {
  it('ids are unique across the corpus and the governance ids exist', () => {
    const ids = corpus.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(byPrefix('g69-vexi-anular-sin-permiso-rol')).toBeDefined();
    expect(byPrefix('g70-vexi-sin-voz-en-vivo')).toBeDefined();
  });

  it('every governance case has the required fields and an answer expectation', () => {
    for (const prefix of ['g69-', 'g70-']) {
      const c = byPrefix(prefix)!;
      expect(['vex', 'vexi']).toContain(c.agent);
      expect(['owner', 'cashier', 'restaurant_owner']).toContain(c.principal);
      expect(c.turns.length).toBeGreaterThan(0);
      for (const turn of c.turns) {
        expect(turn.message.length).toBeGreaterThan(0);
        expect(turn.expect_answer!.min_chars).toBeGreaterThan(0);
        expect(turn.expect_answer!.mentions_any.length).toBeGreaterThan(0);
        // None of them may stage a write or require a tool.
        expect(turn.expect_write).toBeUndefined();
        expect(turn.expect_tools_any).toBeUndefined();
      }
    }
  });

  it('role case: expects «tu rol no permite», no card, data unchanged, fixture restored', () => {
    const c = byPrefix('g69-')!;
    const turn = c.turns[0];
    expect(c.agent).toBe('vexi');
    expect(turn.message).toMatch(/anula/i);
    expect(turn.expect_answer!.mentions_any).toContain('tu rol no permite');
    expect(turn.oracle?.unchanged).toBe(true);
    expect(turn.oracle?.sql).toMatch(/cancelled/);
    expect(c.setup_sql?.join(' ')).toMatch(/store:orders:order_flow:create/);
    expect(c.teardown_sql?.join(' ')).toMatch(/store:orders:order_flow:create/);
  });

  it('voice case: dictation channel, answer points to dictation and spoken reply', () => {
    const c = byPrefix('g70-')!;
    expect(c.channel).toBe('dictation');
    const terms = c.turns[0].expect_answer!.mentions_any.join(' ');
    expect(terms).toMatch(/dictado/);
    expect(terms).toMatch(/lectura en voz/);
    expect(terms).not.toMatch(/voz en vivo/i);
  });
});

describe('gradeGoldenTurn — governance answers', () => {
  it('passes a role denial that names the limit and stages no card', () => {
    const c = byPrefix('g69-')!;
    const checks = gradeGoldenTurn(
      c.turns[0],
      observe(
        'Tu rol no permite anular órdenes; pídeselo al dueño de la tienda y con gusto te ayudo con otra cosa.',
        'vexi',
      ),
    );
    expect(Object.values(checks).every(Boolean)).toBe(true);
  });

  it('fails a role case when a confirmation card was proposed', () => {
    const c = byPrefix('g69-')!;
    const checks = gradeGoldenTurn(
      c.turns[0],
      observe('Tu rol no permite anular órdenes; pídeselo al dueño.', 'vexi', true),
    );
    expect(checks.useful_answer).toBe(false);
  });

  it('passes a voice answer that points to dictation and fails one that offers live voice', () => {
    const c = byPrefix('g70-')!;
    expect(
      gradeGoldenTurn(
        c.turns[0],
        observe(
          'La voz en vivo se retiró. Ahora puedes dictar tu mensaje con el micrófono y activar la lectura en voz de mis respuestas.',
          'vexi',
        ),
      ).useful_answer,
    ).toBe(true);
    expect(
      gradeGoldenTurn(c.turns[0], observe('Listo.', 'vexi')).useful_answer,
    ).toBe(false);
  });
});
