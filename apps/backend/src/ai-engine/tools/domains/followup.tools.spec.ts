import { RemindersService } from '../../../domains/store/reminders/reminders.service';
import {
  createFollowupTools,
  extractSuggestedFollowups,
  followupFingerprint,
  Followup,
  FollowupToolDeps,
} from './followup.tools';
import { isForeignSurfaceTool } from '../surface-tools';

const NOW = new Date('2026-11-20T15:00:00Z'); // 10:00 en Bogotá
const CONTEXT = { store_id: 1, user_id: 7, organization_id: 2 };

type State = Awaited<ReturnType<FollowupToolDeps['conversations']['getState']>>;

function build(
  overrides: Partial<{
    state: State;
    pending: Array<{ title: string; remind_at: Date | null }>;
    turn: string | undefined;
    tz: string;
  }> = {},
) {
  const reminders = new RemindersService({} as never);
  const write = jest.fn();
  const getState = jest
    .fn()
    .mockResolvedValue(
      'state' in overrides ? overrides.state : { muted: false, known: [] },
    );
  const list = jest.fn().mockResolvedValue({
    items: overrides.pending ?? [],
  });
  let turn = 'turn' in overrides ? overrides.turn : 'turn-1';
  const tools = createFollowupTools({
    remindersService: {
      parseRemindAt: reminders.parseRemindAt.bind(reminders),
      list,
    },
    conversations: { getState },
    resolveTimezone: async () => overrides.tz ?? 'America/Bogota',
    turnKey: () => turn,
    now: () => NOW,
  });
  const tool = tools.find((t) => t.name === 'suggest_followup')!;
  const call = async (args: Record<string, unknown>) =>
    JSON.parse(
      (await tool.handler!(
        { conversation_id: 5, source_phrase: 'el viernes llamo', ...args },
        CONTEXT,
      )) as string,
    ).data;
  return {
    tool,
    call,
    getState,
    list,
    write,
    setTurn: (t: string) => (turn = t),
  };
}

const valid = {
  kind: 'reminder',
  title: 'Llamar a la distribuidora',
  remind_at: '2026-11-27T09:00',
};

describe('suggest_followup', () => {
  it('is a read-only tool with no confirmation circuit', () => {
    const { tool } = build();
    expect(tool.readOnly).toBe(true);
    expect(tool.requiresConfirmation).toBeUndefined();
    expect(tool.clientSide).toBeUndefined();
    expect(tool.parameters.required).toEqual(
      expect.arrayContaining(['kind', 'title', 'source_phrase']),
    );
  });

  it('suggests a reminder, reading the date in the store timezone', async () => {
    const { call } = build();
    const data = await call(valid);
    expect(data.suggested).toBe(true);
    expect(data.followup).toMatchObject({
      kind: 'reminder',
      title: 'Llamar a la distribuidora',
      remind_at: '2026-11-27T14:00:00.000Z', // 09:00 Bogotá = 14:00 UTC
      status: 'suggested',
      source_phrase: 'el viernes llamo',
    });
    expect(data.followup.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses another store timezone for the same wall clock', async () => {
    const { call } = build({ tz: 'America/Mexico_City' });
    const data = await call(valid);
    expect(data.followup.remind_at).toBe('2026-11-27T15:00:00.000Z');
  });

  it('writes nothing: only reads state and pending reminders', async () => {
    const { call, getState, list } = build();
    await call(valid);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('rejects a reminder without date', async () => {
    const { call } = build();
    expect(await call({ ...valid, remind_at: undefined })).toEqual(
      expect.objectContaining({ suggested: false, reason: 'invalid' }),
    );
  });

  it('rejects past dates, bad kinds, long titles and broken links', async () => {
    const { call } = build();
    for (const bad of [
      { remind_at: '2026-11-01T09:00' },
      { remind_at: 'mañana' },
      { kind: 'task' },
      { title: 'x'.repeat(121) },
      { title: '   ' },
      { link_type: 'order' }, // exige link_id
      { link_type: 'planet', link_id: 1 },
    ]) {
      const data = await call({ ...valid, ...bad });
      expect(data).toEqual(
        expect.objectContaining({ suggested: false, reason: 'invalid' }),
      );
    }
  });

  it('accepts a link and a dateless log_entry', async () => {
    const { call } = build();
    const data = await call({
      kind: 'log_entry',
      title: 'Acuerdo de precio con Lácteos',
      link_type: 'supplier',
      link_id: 12,
      link_label: 'Lácteos del Valle',
    });
    expect(data.suggested).toBe(true);
    expect(data.followup).toMatchObject({
      kind: 'log_entry',
      remind_at: null,
      link_type: 'supplier',
      link_id: 12,
      link_label: 'Lácteos del Valle',
    });
  });

  it('allows only one suggestion per turn', async () => {
    const { call, setTurn } = build();
    expect((await call(valid)).suggested).toBe(true);
    expect(await call({ ...valid, title: 'Otro seguimiento' })).toEqual(
      expect.objectContaining({ suggested: false, reason: 'limit' }),
    );
    setTurn('turn-2');
    expect((await call({ ...valid, title: 'Otro seguimiento' })).suggested).toBe(
      true,
    );
  });

  it('skips when the conversation is muted', async () => {
    const { call } = build({ state: { muted: true, known: [] } });
    expect(await call(valid)).toEqual(
      expect.objectContaining({ suggested: false, reason: 'muted' }),
    );
  });

  it('skips a fingerprint already suggested, saved or dismissed', async () => {
    for (const status of ['suggested', 'saved', 'dismissed'] as const) {
      const known: Followup[] = [
        {
          id: 'a',
          kind: 'reminder',
          title: 'LLAMAR a la  distribuidora!',
          remind_at: '2026-11-27T20:00:00.000Z', // mismo día local
          status,
        },
      ];
      const { call } = build({ state: { muted: false, known } });
      expect(await call(valid)).toEqual(
        expect.objectContaining({ suggested: false, reason: 'duplicate' }),
      );
    }
  });

  it('does not treat another day or kind as duplicate', async () => {
    const known: Followup[] = [
      {
        id: 'a',
        kind: 'reminder',
        title: 'Llamar a la distribuidora',
        remind_at: '2026-11-28T14:00:00.000Z',
        status: 'saved',
      },
    ];
    const { call } = build({ state: { muted: false, known } });
    expect((await call(valid)).suggested).toBe(true);
  });

  it('skips when an equivalent pending reminder already exists', async () => {
    const { call } = build({
      pending: [
        {
          title: 'llamar a la distribuidora',
          remind_at: new Date('2026-11-27T14:00:00Z'),
        },
      ],
    });
    expect(await call(valid)).toEqual(
      expect.objectContaining({ suggested: false, reason: 'duplicate' }),
    );
  });

  it('still suggests when the pending-reminder check fails', async () => {
    const built = build();
    built.list.mockRejectedValue(new Error('boom'));
    expect((await built.call(valid)).suggested).toBe(true);
  });

  it('is invalid outside a Vex conversation of the user', async () => {
    const { call } = build({ state: null });
    expect(await call(valid)).toEqual(
      expect.objectContaining({ suggested: false, reason: 'invalid' }),
    );
    const { tool } = build();
    const raw = await tool.handler!({ ...valid, source_phrase: 'x' }, CONTEXT);
    expect(JSON.parse(raw as string).data.reason).toBe('invalid'); // sin conversation_id
  });

  it('fingerprint ignores case, accents, punctuation and time of day', () => {
    expect(
      followupFingerprint('reminder', 'Cobrar a Peña', '2026-11-27'),
    ).toBe(followupFingerprint('reminder', 'cobrar  a pena!', '2026-11-27'));
    expect(followupFingerprint('reminder', 'a', '2026-11-27')).not.toBe(
      followupFingerprint('log_entry', 'a', '2026-11-27'),
    );
  });
});

describe('Vex-only surface', () => {
  it('hides suggest_followup from Vexi and keeps vex_* rule', () => {
    expect(isForeignSurfaceTool('suggest_followup', 'vexi')).toBe(true);
    expect(isForeignSurfaceTool('suggest_followup', undefined)).toBe(true);
    expect(isForeignSurfaceTool('suggest_followup', 'vex')).toBe(false);
    expect(isForeignSurfaceTool('vex_render_table', 'vexi')).toBe(true);
    expect(isForeignSurfaceTool('create_reminder', 'vexi')).toBe(false);
  });
});

describe('extractSuggestedFollowups', () => {
  it('keeps the one suggestion of the turn and ignores everything else', async () => {
    const { tool } = build();
    const result = (await tool.handler!(
      {
        conversation_id: 5,
        kind: 'reminder',
        title: 'Llamar a la distribuidora',
        remind_at: '2026-11-27T09:00',
        source_phrase: 'el viernes llamo al proveedor',
      },
      CONTEXT,
    )) as string;
    const skipped = JSON.stringify({ data: { suggested: false, reason: 'muted' } });
    const found = extractSuggestedFollowups([
      { name: 'list_reminders', result },
      { name: 'suggest_followup', result: '{"truncated":' },
      { name: 'suggest_followup', result: skipped },
      { name: 'suggest_followup', result },
      { name: 'suggest_followup', result },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'reminder',
      title: 'Llamar a la distribuidora',
      status: 'suggested',
    });
    expect(extractSuggestedFollowups([])).toEqual([]);
  });
});
