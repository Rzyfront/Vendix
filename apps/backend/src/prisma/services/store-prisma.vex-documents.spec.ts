import { Test, TestingModule } from '@nestjs/testing';

import { RequestContextService } from '@common/context/request-context.service';

import { StorePrismaService } from './store-prisma.service';

/**
 * Aislamiento de tenant de los modelos de Vex Plus F6 (adjuntos del chat y
 * documentos guardados en registros). Los cuatro llevan `store_id` propio y
 * están registrados en `store_scoped_models`; sin ese registro el delegate
 * consultaría sin filtro y un adjunto, un archivo o un expediente de otra
 * tienda sería legible por id. Se verifica el FILTRO QUE LLEGA A LA CONSULTA,
 * no la presencia del nombre en la lista: si alguien quita el registro, este
 * spec falla.
 */
const VEX_DOCUMENT_MODELS = [
  'ai_attachments',
  'stored_files',
  'dossiers',
  'dossier_items',
] as const;

describe('StorePrismaService · aislamiento de adjuntos y documentos de Vex (F6)', () => {
  let service: StorePrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorePrismaService],
    }).compile();
    service = module.get<StorePrismaService>(StorePrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Devuelve el `where` con el que la extensión llamó a la consulta real. */
  async function scopedWhere(model: string, operation: string, args: any) {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 2, store_id: 3 } as any);
    const query = jest.fn().mockResolvedValue(null);
    await (service as any).applyStoreScoping(model, operation, args, query);
    return query.mock.calls[0][0].where;
  }

  it.each(VEX_DOCUMENT_MODELS)(
    '%s: un `where: { id }` gana el filtro de la tienda del contexto',
    async (model) => {
      await expect(
        scopedWhere(model, 'findFirst', { where: { id: 41 } }),
      ).resolves.toEqual({ id: 41, store_id: 3 });
      await expect(
        scopedWhere(model, 'findMany', { where: {} }),
      ).resolves.toEqual({ store_id: 3 });
    },
  );

  it.each(VEX_DOCUMENT_MODELS)(
    '%s: sin tienda en contexto no se consulta (rechaza, nunca devuelve todo)',
    async (model) => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ organization_id: 2 } as any);
      const query = jest.fn();
      await expect(
        (service as any).applyStoreScoping(
          model,
          'findFirst',
          { where: { id: 41 } },
          query,
        ),
      ).rejects.toThrow(/store context required/);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each(VEX_DOCUMENT_MODELS)(
    '%s: el servicio expone el delegate con scoping',
    (model) => {
      expect((service as any)[model]).toBeDefined();
    },
  );
});
