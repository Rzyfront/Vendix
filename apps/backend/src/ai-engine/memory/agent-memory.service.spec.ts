import { RequestContextService } from '../../common/context/request-context.service';
import {
  AgentMemoryService,
  MemoryActor,
  looksLikeSecret,
} from './agent-memory.service';

type Row = Record<string, any>;

/** In-memory stand-in for the scoped `ai_agent_memories` delegate. */
function fakePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([field, cond]) => {
      if (field === 'OR') return (cond as Row[]).some((c) => matches(row, c));
      if (cond && typeof cond === 'object' && 'in' in (cond as Row)) {
        return (cond as { in: unknown[] }).in.includes(row[field]);
      }
      return row[field] === cond;
    });
  const memories = {
    findMany: jest.fn(async ({ where, take }: Row = {}) =>
      rows.filter((r) => matches(r, where)).slice(0, take ?? undefined),
    ),
    findFirst: jest.fn(
      async ({ where }: Row) => rows.find((r) => matches(r, where)) ?? null,
    ),
    create: jest.fn(async ({ data }: Row) => {
      const row = {
        id: ++seq,
        last_used_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        ...data,
      };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    deleteMany: jest.fn(async ({ where }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { count: hit.length };
    }),
  };
  const users = {
    findMany: jest.fn(async () => [
      { id: 7, first_name: 'Ana', last_name: 'Ruiz' },
      { id: 8, first_name: 'Beto', last_name: null },
    ]),
  };
  return { rows, prisma: { ai_agent_memories: memories, users } };
}

const ana: MemoryActor = { store_id: 1, organization_id: 10, user_id: 7 };
const beto: MemoryActor = { store_id: 1, organization_id: 10, user_id: 8 };
const otherStore: MemoryActor = { store_id: 2, organization_id: 20, user_id: 9 };

function setup() {
  const fake = fakePrisma();
  const service = new AgentMemoryService(fake.prisma as never);
  return { ...fake, service };
}

const agentWrite = (
  key: string,
  content: string,
  conversationId: number | null = 100,
) => ({ key, content, origin: 'agent' as const, conversationId });

describe('AgentMemoryService', () => {
  it('remember by one user is listed for another user of the same store, never for another store', async () => {
    const { service } = setup();
    await service.remember(ana, agentWrite('learning.format', 'video'));

    const forBeto = await service.list(beto);
    expect(forBeto.items.map((i) => [i.key, i.content])).toEqual([
      ['learning.format', 'video'],
    ]);
    expect(forBeto.items[0].created_by).toEqual({ id: 7, name: 'Ana Ruiz' });
    expect(forBeto.limits).toMatchObject({
      max_entries: 40,
      max_chars: 2000,
      used_entries: 1,
      // the counter measures the snapshot line, not the bare content
      used_chars: '- learning.format: video\n'.length,
    });

    expect((await service.list(otherStore)).items).toEqual([]);
    await RequestContextService.runIsolated(
      { store_id: 2 } as never,
      async () => expect(await service.buildSnapshotBlock()).toBe(''),
    );
  });

  it('upserts by key, recording source conversation and the writer', async () => {
    const { service, rows } = setup();
    const first = await service.remember(ana, agentWrite('learning.format', 'video'));
    expect(first.replaced).toBe(false);
    const second = await service.remember(
      beto,
      agentWrite('learning.format', 'post', 200),
    );
    expect(second.replaced).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      content: 'post',
      origin: 'agent',
      source_conversation_id: 200,
      created_by_user_id: 7,
      updated_by_user_id: 8,
      user_id: null,
    });
  });

  it('edit changes the snapshot text and turns the row manual, detached from its conversation', async () => {
    const { service, rows } = setup();
    const { item } = await service.remember(ana, agentWrite('learning.format', 'video'));
    expect(await service.buildSnapshotBlock(1)).toContain('- learning.format: video');

    const edited = await service.edit(beto, item.id, 'post');
    expect(edited).toMatchObject({ origin: 'manual', source_conversation_id: null });
    expect(edited.updated_by).toEqual({ id: 8, name: 'Beto' });
    const snapshot = await service.buildSnapshotBlock(1);
    expect(snapshot).toContain('- learning.format: post');
    expect(snapshot).not.toContain('video');
    expect(rows[0].last_used_at).toBeInstanceOf(Date);

    // an agent write on a manual row never downgrades it
    await service.remember(ana, agentWrite('learning.format', 'video', 300));
    expect(rows[0]).toMatchObject({ origin: 'manual', source_conversation_id: null });
  });

  it('delete removes the memory from the snapshot; delete all clears the store only', async () => {
    const { service } = setup();
    const a = await service.remember(ana, agentWrite('a.one', 'uno'));
    await service.remember(ana, agentWrite('a.two', 'dos'));
    await service.remember(otherStore, agentWrite('a.one', 'ajeno'));

    expect(await service.remove(beto, a.item.id)).toEqual({ deleted: 1 });
    const snapshot = await service.buildSnapshotBlock(1);
    expect(snapshot).not.toContain('a.one');
    expect(snapshot).toContain('a.two');
    await expect(service.remove(beto, a.item.id)).rejects.toMatchObject({
      errorCode: 'AI_MEMORY_NOT_FOUND_001',
    });
    // a row of another store is not reachable by id
    const foreign = (await service.list(otherStore)).items[0];
    await expect(service.remove(ana, foreign.id)).rejects.toMatchObject({
      errorCode: 'AI_MEMORY_NOT_FOUND_001',
    });

    expect(await service.removeAll(ana)).toEqual({ deleted: 1 });
    expect((await service.list(otherStore)).items).toHaveLength(1);
    expect(await service.forget(otherStore, 'a.one')).toBe(1);
    expect(await service.forget(otherStore, 'a.one')).toBe(0);
  });

  it('enforces the 40-entry cap with AI_MEMORY_LIMIT_001, still allowing a replacement at the cap', async () => {
    const { service } = setup();
    for (let i = 0; i < 40; i++) {
      await service.remember(ana, agentWrite(`k.${i}`, 'x'));
    }
    await expect(
      service.remember(ana, agentWrite('k.new', 'x')),
    ).rejects.toMatchObject({
      errorCode: 'AI_MEMORY_LIMIT_001',
      message: expect.stringContaining('Edita o borra uno'),
    });
    await expect(
      service.remember(ana, agentWrite('k.0', 'reemplazo')),
    ).resolves.toMatchObject({ replaced: true });
  });

  it('enforces the 2000-char block total (key and format included) and the 500-char entry cap', async () => {
    const { service } = setup();
    // each line costs `- c.N: ` (7) + content + newline (1)
    const full = 'a'.repeat(500);
    for (let i = 0; i < 3; i++) await service.remember(ana, agentWrite(`c.${i}`, full));
    await service.remember(ana, agentWrite('c.3', 'a'.repeat(2000 - 3 * 508 - 8)));
    expect((await service.list(ana)).limits.used_chars).toBe(2000);
    await expect(
      service.remember(ana, agentWrite('c.4', 'una más')),
    ).rejects.toMatchObject({ errorCode: 'AI_MEMORY_LIMIT_001' });
    await expect(
      service.remember(ana, agentWrite('c.big', 'a'.repeat(501))),
    ).rejects.toMatchObject({ errorCode: 'AI_MEMORY_LIMIT_001' });
    // editing a row counts the total without its old text
    const c0 = (await service.list(ana)).items.find((i) => i.key === 'c.0')!;
    await expect(service.edit(ana, c0.id, 'b'.repeat(500))).resolves.toBeDefined();
    await expect(service.edit(ana, c0.id, 'b'.repeat(501))).rejects.toMatchObject({
      errorCode: 'AI_MEMORY_LIMIT_001',
    });
  });

  it.each([
    'mi contraseña es Tigre123',
    'password: hunter2hunter2',
    'tarjeta 4111 1111 1111 1111',
    'el cvv es 123',
    'cédula del cliente 1.020.304.050',
    'usa la api key: abcd1234efgh5678',
    'sk_live_abcdefghijklmnop',
  ])('rejects secret-like content "%s" with AI_MEMORY_FORBIDDEN_001', async (text) => {
    const { service, rows } = setup();
    await expect(
      service.remember(ana, agentWrite('x.secret', text)),
    ).rejects.toMatchObject({ errorCode: 'AI_MEMORY_FORBIDDEN_001' });
    expect(rows).toHaveLength(0);
    expect(looksLikeSecret(text)).toBe(true);
  });

  it('accepts ordinary preferences and rejects invalid keys', async () => {
    const { service } = setup();
    await expect(
      service.remember(ana, agentWrite('tone.reports', 'Reportes cortos, sin emojis, desde el 15 de marzo de 2026')),
    ).resolves.toBeDefined();
    await expect(
      service.remember(ana, agentWrite('Mala Clave!', 'x')),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
  });

  it('learning.format keeps one vocabulary: aliases are stored as video or post, anything else is rejected', async () => {
    const { service, rows } = setup();
    await service.remember(ana, agentWrite('learning.format', 'Paso a paso'));
    expect(rows[0].content).toBe('post');
    await service.edit(beto, rows[0].id, 'videos');
    expect(rows[0].content).toBe('video');
    await expect(
      service.remember(ana, agentWrite('learning.format', 'audio')),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
    expect(rows[0].content).toBe('video');
  });

  it('a learning.format row saved with the old value reaches Vex as the canonical one', async () => {
    const { service, rows } = setup();
    await service.remember(ana, agentWrite('learning.format', 'video'));
    rows[0].content = 'paso a paso'; // written before the vocabulary was unified
    const block = await service.buildSnapshotBlock(1);
    expect(block).toContain('- learning.format: post');
    expect(block).not.toContain('paso a paso');
  });

  it('purge hook deletes only un-edited agent rows born in that conversation', async () => {
    const { service, rows } = setup();
    await service.remember(ana, agentWrite('p.agent', 'a', 100));
    await service.remember(ana, agentWrite('p.other', 'b', 101));
    const edited = await service.remember(ana, agentWrite('p.edited', 'c', 100));
    await service.edit(ana, edited.item.id, 'c editado');
    await service.remember(otherStore, agentWrite('p.foreign', 'd', 100));

    const count = await service.deleteUnEditedFromConversation(100, { storeId: 1 });
    expect(count).toBe(1);
    expect(rows.map((r) => r.key).sort()).toEqual(['p.edited', 'p.foreign', 'p.other']);
  });

  it('every memory the caps accept reaches the block Vex receives', async () => {
    const { service, rows } = setup();
    const accepted: string[] = [];
    let rejected = 0;
    // 6 x 330 chars of content (1980) used to pass the cap while only 5 lines fit
    for (let i = 0; i < 6; i++) {
      try {
        await service.remember(ana, agentWrite(`s.${i}`, 'a'.repeat(330)));
        accepted.push(`s.${i}`);
      } catch (error) {
        expect(error).toMatchObject({ errorCode: 'AI_MEMORY_LIMIT_001' });
        rejected++;
      }
    }
    expect(rejected).toBe(1);
    expect(rows.map((r) => r.key)).toEqual(accepted);

    const block = await service.buildSnapshotBlock(1);
    expect(block.startsWith('Memoria de la tienda')).toBe(true);
    for (const key of accepted) {
      expect(block).toContain(`- ${key}: ${'a'.repeat(330)}`);
    }
    expect(block.split('\n')).toHaveLength(accepted.length + 1);
    expect(rows.every((r) => r.last_used_at instanceof Date)).toBe(true);
  });

  it('a store exactly at the 2000-char cap sends every memory; one more char is rejected', async () => {
    const { service, rows } = setup();
    // 4 lines of `- e.N: ` (7) + 492 + newline (1) = 4 x 500 = 2000
    for (let i = 0; i < 4; i++) {
      await service.remember(ana, agentWrite(`e.${i}`, 'z'.repeat(492)));
    }
    const header = (await service.buildSnapshotBlock(1)).split('\n')[0];
    const block = await service.buildSnapshotBlock(1);
    expect(block.length - header.length).toBe(2000);
    for (let i = 0; i < 4; i++) expect(block).toContain(`- e.${i}: ${'z'.repeat(492)}`);

    await expect(
      service.edit(ana, rows[0].id, 'z'.repeat(493)),
    ).rejects.toMatchObject({ errorCode: 'AI_MEMORY_LIMIT_001' });
    await expect(
      service.remember(ana, agentWrite('e.4', 'z')),
    ).rejects.toMatchObject({ errorCode: 'AI_MEMORY_LIMIT_001' });
    expect(rows).toHaveLength(4);
  });
});
