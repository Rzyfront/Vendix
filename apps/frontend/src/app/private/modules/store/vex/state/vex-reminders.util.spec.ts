import type { Reminder } from '../../dashboard/services/reminders.service';
import type { VexConversation, VexMessage } from '../models/vex.models';
import {
  countReminders,
  filterReminders,
  matchesReminderFilter,
  vexActivityFingerprint,
} from './vex-reminders.util';

function reminder(partial: Partial<Reminder> & Pick<Reminder, 'id'>): Reminder {
  return {
    title: `Recordatorio ${partial.id}`,
    note: null,
    remind_at: null,
    status: 'pending',
    bucket: 'no_date',
    link: null,
    source: 'manual',
    completed_at: null,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    ...partial,
  };
}

const ITEMS: Reminder[] = [
  reminder({ id: 1, bucket: 'upcoming', remind_at: '2026-11-20T15:00:00Z' }),
  reminder({ id: 2, bucket: 'overdue', remind_at: '2026-11-10T15:00:00Z' }),
  reminder({ id: 3, bucket: 'today', remind_at: '2026-11-15T18:00:00Z', source: 'vex' }),
  reminder({ id: 4, bucket: 'no_date' }),
  reminder({
    id: 5,
    status: 'done',
    bucket: 'done',
    completed_at: '2026-11-14T10:00:00Z',
  }),
  reminder({
    id: 6,
    status: 'done',
    bucket: 'done',
    completed_at: '2026-11-15T10:00:00Z',
  }),
  reminder({ id: 7, bucket: 'today', remind_at: '2026-11-15T13:00:00Z' }),
];

function ids(items: Reminder[]): number[] {
  return items.map((item) => item.id);
}

describe('vex reminders sidebar filters', () => {
  it('"Pendientes" lists every pending reminder in the dashboard order, never done ones', () => {
    expect(ids(filterReminders(ITEMS, 'pending'))).toEqual([2, 7, 3, 1, 4]);
  });

  it('"Hoy", "Vencidos" and "Próximos" keep only pending reminders of that bucket', () => {
    expect(ids(filterReminders(ITEMS, 'today'))).toEqual([7, 3]);
    expect(ids(filterReminders(ITEMS, 'overdue'))).toEqual([2]);
    expect(ids(filterReminders(ITEMS, 'upcoming'))).toEqual([1]);
  });

  it('"Hechos" lists completed reminders, most recently completed first', () => {
    expect(ids(filterReminders(ITEMS, 'done'))).toEqual([6, 5]);
  });

  it('a done reminder never matches a pending filter even if its bucket says so', () => {
    const stale = reminder({ id: 9, status: 'done', bucket: 'today' });
    expect(matchesReminderFilter(stale, 'today')).toBe(false);
    expect(matchesReminderFilter(stale, 'pending')).toBe(false);
    expect(matchesReminderFilter(stale, 'done')).toBe(true);
  });

  it('counts each filter for the chips', () => {
    expect(countReminders(ITEMS)).toEqual({
      pending: 5,
      today: 2,
      overdue: 1,
      upcoming: 1,
      done: 2,
    });
    expect(countReminders([])).toEqual({
      pending: 0,
      today: 0,
      overdue: 0,
      upcoming: 0,
      done: 0,
    });
  });

  it('does not mutate the list it receives', () => {
    const copy = [...ITEMS];
    filterReminders(ITEMS, 'pending');
    expect(ITEMS).toEqual(copy);
  });
});

function message(role: VexMessage['role'], streaming = false): VexMessage {
  return {
    id: `${role}-${Math.random()}`,
    role,
    content: '',
    created_at: new Date(),
    streaming,
  };
}

function conversation(messages: VexMessage[]): VexConversation {
  return {
    id: 'c1',
    title: 'Chat',
    messages,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('vexActivityFingerprint (when the sidebar re-reads reminders)', () => {
  it('stays the same while a Vex turn is still streaming', () => {
    const before = vexActivityFingerprint([conversation([message('user')])], null);
    const streaming = vexActivityFingerprint(
      [conversation([message('user'), message('agent', true)])],
      null,
    );
    expect(streaming).toBe(before);
  });

  it('changes when a Vex turn finishes (it may have created or changed a reminder)', () => {
    const streaming = vexActivityFingerprint(
      [conversation([message('user'), message('agent', true)])],
      null,
    );
    const done = vexActivityFingerprint(
      [conversation([message('user'), message('agent', false)])],
      null,
    );
    expect(done).not.toBe(streaming);
  });

  it('changes when a confirmed step starts and finishes applying (e.g. deleting a reminder)', () => {
    const convs = [conversation([message('user'), message('agent')])];
    const idle = vexActivityFingerprint(convs, null);
    const applying = vexActivityFingerprint(convs, 'plan-1');
    const applied = vexActivityFingerprint(convs, null);
    expect(applying).not.toBe(idle);
    expect(applied).not.toBe(applying);
  });

  it('ignores messages the user sends', () => {
    const before = vexActivityFingerprint([conversation([message('agent')])], null);
    const after = vexActivityFingerprint(
      [conversation([message('agent'), message('user')])],
      null,
    );
    expect(after).toBe(before);
  });
});
