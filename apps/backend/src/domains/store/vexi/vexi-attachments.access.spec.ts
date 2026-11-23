import { RequestContextService } from '@common/context/request-context.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createAiToolboxTools } from '../../../ai-engine/tools/domains/ai-toolbox.tools';
import { McpToolProvider } from '../mcp/providers/mcp-tool.provider';
import { VexController } from '../vex/vex.controller';
import { VexiAttachmentsService } from './vexi-attachments.service';

/**
 * B2 (auditoría F6 r1): dos personas de la misma tienda. El adjunto de la
 * dueña (`att_41`, una nómina) no lo puede leer el cajero por ningún camino:
 * ni por `/mcp` (`read_attachment` con registro y proveedor reales) ni por la
 * URL firmada del chat. La tabla en memoria evalúa el `where` que el servicio
 * envía de verdad, así que quitar el filtro por usuario rompe estos casos.
 */

type Row = {
  id: number;
  store_id: number;
  user_id: number;
  s3_key: string;
  mime_type: string;
  original_name: string;
  size_bytes: number;
  derived_text_key: string | null;
  linked_entity_type: string | null;
  linked_entity_id: number | null;
  stored_file_id: number | null;
};

const STORE = 7;
const OWNER = 1;
const CASHIER = 2;

/** Minimal evaluator of the Prisma filters this service sends. */
function matches(row: Record<string, unknown>, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as any[]).every((w) => matches(row, w));
    if (key === 'OR') return (cond as any[]).some((w) => matches(row, w));
    if (cond && typeof cond === 'object' && 'in' in (cond as any)) {
      return (cond as any).in.includes(row[key]);
    }
    return row[key] === cond;
  });
}

function fakePrisma(rows: Row[]) {
  const pick = (row: Row, select?: Record<string, boolean>) =>
    select
      ? Object.fromEntries(
          Object.keys(select).map((k) => [k, (row as any)[k]]),
        )
      : row;
  // StorePrismaService injects the store; the fake does the same.
  const scoped = (where: any) => ({ AND: [where, { store_id: STORE }] });
  return {
    sent: [] as any[],
    ai_attachments: {
      findFirst: jest.fn(async ({ where, select }: any) => {
        const row = rows.find((r) => matches(r, scoped(where)));
        return row ? pick(row, select) : null;
      }),
      findMany: jest.fn(async ({ where, select }: any) =>
        rows.filter((r) => matches(r, scoped(where))).map((r) => pick(r, select)),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => matches(r, scoped(where)));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
  };
}

const PAYROLL = {
  kind: 'text',
  original_name: 'nomina.txt',
  mime_type: 'text/plain',
  text: 'SALARIO GERENTE 9.000.000',
};

function ctx(userId: number, permissions: string[]) {
  return {
    is_super_admin: false,
    is_owner: false,
    store_id: STORE,
    organization_id: 3,
    user_id: userId,
    permissions,
    roles: [],
  } as any;
}

describe('adjuntos del chat · aislamiento por usuario dentro de la tienda (B2)', () => {
  let rows: Row[];
  let service: VexiAttachmentsService;
  let s3: { downloadFile: jest.Mock; getPresignedUrl: jest.Mock };

  beforeEach(() => {
    rows = [
      {
        id: 41,
        store_id: STORE,
        user_id: OWNER,
        s3_key: 'stores/7/vexi/nomina.txt',
        mime_type: 'text/plain',
        original_name: 'nomina.txt',
        size_bytes: 120,
        derived_text_key: 'stores/7/vexi/nomina.txt.json',
        linked_entity_type: null,
        linked_entity_id: null,
        stored_file_id: null,
      },
    ];
    s3 = {
      downloadFile: jest.fn(async () =>
        Buffer.from(JSON.stringify(PAYROLL), 'utf8'),
      ),
      getPresignedUrl: jest.fn(async (key: string) => `https://s3/${key}?sig`),
    };
    service = new VexiAttachmentsService(fakePrisma(rows) as any, s3 as any);
  });

  function mcp() {
    const registry = new AIToolRegistry({} as any);
    for (const tool of createAiToolboxTools({
      toolbox: {} as never,
      attachments: service,
      s3: {} as never,
    })) {
      registry.register(tool);
    }
    return new McpToolProvider(registry);
  }

  function urlEndpoint() {
    const controller = Object.create(VexController.prototype) as VexController;
    Object.assign(controller, {
      attachments: service,
      responseService: { success: (data: unknown) => ({ data }) },
    });
    return controller;
  }

  describe('por /mcp (read_attachment)', () => {
    it('la dueña lee su propio adjunto', async () => {
      const result = await RequestContextService.runIsolated(
        ctx(OWNER, ['store:orders:read']),
        () => mcp().callTool('read_attachment', { attachment_id: 'att_41' }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('SALARIO GERENTE');
    });

    it('el cajero NO lee el adjunto de la dueña: error de no disponible y nunca baja el archivo', async () => {
      const result = await RequestContextService.runIsolated(
        ctx(CASHIER, ['store:orders:read', 'store:orders:create']),
        () => mcp().callTool('read_attachment', { attachment_id: 'att_41' }),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('ya no está disponible');
      expect(result.content[0].text).not.toContain('SALARIO');
      expect(s3.downloadFile).not.toHaveBeenCalled();
    });

    it('sin el prefijo (handle "41") tampoco pasa', async () => {
      const result = await RequestContextService.runIsolated(
        ctx(CASHIER, []),
        () => mcp().callTool('read_attachment', { attachment_id: '41' }),
      );
      expect(result.isError).toBe(true);
      expect(s3.downloadFile).not.toHaveBeenCalled();
    });

    it('guardado en una orden: quien tiene store:orders:read lo lee; sin ese permiso, no', async () => {
      rows[0].linked_entity_type = 'order';
      rows[0].linked_entity_id = 900;

      const reader = await RequestContextService.runIsolated(
        ctx(CASHIER, ['store:orders:read']),
        () => mcp().callTool('read_attachment', { attachment_id: 'att_41' }),
      );
      expect(reader.isError).toBeUndefined();

      const other = await RequestContextService.runIsolated(
        ctx(CASHIER, ['store:customers:read']),
        () => mcp().callTool('read_attachment', { attachment_id: 'att_41' }),
      );
      expect(other.isError).toBe(true);
    });
  });

  describe('por la URL firmada del chat (GET store/vex/attachments/:handle/url)', () => {
    it('la dueña obtiene la URL', async () => {
      const out: any = await RequestContextService.runIsolated(
        ctx(OWNER, []),
        () => urlEndpoint().attachmentUrl('att_41'),
      );
      expect(out.data.url).toContain('nomina.txt');
    });

    it('el cajero recibe "no existe o ya no está disponible" y nunca se firma nada', async () => {
      await expect(
        RequestContextService.runIsolated(ctx(CASHIER, []), () =>
          urlEndpoint().attachmentUrl('att_41'),
        ),
      ).rejects.toThrow(/no existe o ya no está disponible/);
      expect(s3.getPresignedUrl).not.toHaveBeenCalled();
    });
  });

  it('sin usuario en contexto no resuelve ningún adjunto', async () => {
    await expect(
      RequestContextService.runIsolated(
        { ...ctx(OWNER, []), user_id: undefined },
        () => service.signedUrl('att_41'),
      ),
    ).rejects.toThrow(/ya no está disponible/);
  });

  it('las mutaciones por handle no tocan el adjunto ajeno (linkTo)', async () => {
    await RequestContextService.runIsolated(ctx(CASHIER, []), () =>
      service.linkTo('att_41', 'expense', 5),
    );
    expect(rows[0].linked_entity_type).toBeNull();
  });

  it('el agente de documentos (T44) tampoco resuelve el adjunto ajeno', async () => {
    const own = await RequestContextService.runIsolated(ctx(OWNER, []), () =>
      service.findAttachmentForAgent(41),
    );
    const foreign = await RequestContextService.runIsolated(
      ctx(CASHIER, ['store:orders:update']),
      () => service.findAttachmentForAgent(41),
    );
    expect(own?.id).toBe(41);
    expect(foreign).toBeNull();
  });
});
