import { Test, TestingModule } from '@nestjs/testing';

import { RequestContextService } from '@common/context/request-context.service';

import { StorePrismaService } from './store-prisma.service';

/**
 * Aislamiento de tenant de los perfiles de facturación.
 *
 * Un perfil no guarda datos de negocio: guarda la CONFIGURACIÓN FISCAL con la
 * que se calcula un documento. Leer la de otro tenant no filtraría información
 * ajena — calcularía IVA con las tarifas de otra empresa, y el documento
 * resultante llevaría el consecutivo y el NIT propios. Por eso el scoping se
 * verifica sobre el FILTRO QUE LLEGA A LA CONSULTA y no sobre la presencia de la
 * extensión: `dian_configurations` estuvo registrado en `relational_scopes` sin
 * estar en `all_scoped_models`, y la entrada relacional sola era código muerto.
 */
describe('StorePrismaService · aislamiento de invoice_profiles', () => {
  let service: StorePrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorePrismaService],
    }).compile();
    service = module.get<StorePrismaService>(StorePrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Devuelve el `where` con el que la extensión llamó a la consulta real. */
  async function scopedWhere(
    model: string,
    args: any,
    context: { organization_id?: number; store_id?: number } = {
      organization_id: 2,
      store_id: 3,
    },
  ) {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(context as any);
    const query = jest.fn().mockResolvedValue(null);
    await (service as any).applyStoreScoping(model, 'findFirst', args, query);
    return query.mock.calls[0][0].where;
  }

  it('un `where: { id }` sobre invoice_profiles gana el filtro de tienda', async () => {
    // Sin el registro en `store_scoped_models`, este `where` viajaría desnudo y
    // cualquier id de otro tenant sería legible y editable.
    await expect(scopedWhere('invoice_profiles', { where: { id: 5 } })).resolves.toEqual(
      { id: 5, store_id: 3 },
    );
  });

  it('las versiones se scopean a través del perfil, no por una columna propia', async () => {
    // La tabla NO tiene `store_id` a propósito: duplicarlo permitiría que una
    // versión declarara una tienda distinta de la de su perfil, y entonces
    // habría dos fuentes de verdad que pueden divergir. El perfil es el ancla.
    await expect(
      scopedWhere('invoice_profile_versions', { where: { id: 9 } }),
    ).resolves.toEqual({ id: 9, profile: { store_id: 3 } });
  });

  it('sin tienda en contexto, invoice_profiles no se consulta: rechaza', async () => {
    // El fallo abierto sería devolver todo. `store_scoped_models` exige la
    // tienda antes de construir el filtro.
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 2 } as any);
    await expect(
      (service as any).applyStoreScoping(
        'invoice_profiles',
        'findFirst',
        { where: { id: 5 } },
        jest.fn(),
      ),
    ).rejects.toThrow(/store context required/);
  });

  it('sin contexto de petición no se consulta nada', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(null as any);
    await expect(
      (service as any).applyStoreScoping(
        'invoice_profiles',
        'findFirst',
        {},
        jest.fn(),
      ),
    ).rejects.toThrow(/no request context/);
  });

  it('los dos modelos están en las extensiones: la entrada relacional sola es código muerto', async () => {
    const extensions = (service as any).createStoreQueryExtensions();

    expect(extensions.invoice_profiles).toBeDefined();
    expect(typeof extensions.invoice_profiles.findFirst).toBe('function');
    expect(typeof extensions.invoice_profiles.update).toBe('function');

    expect(extensions.invoice_profile_versions).toBeDefined();
    expect(typeof extensions.invoice_profile_versions.findFirst).toBe('function');
    expect(typeof extensions.invoice_profile_versions.create).toBe('function');
  });

  it('los getters exponen el cliente CON scope, no el base', () => {
    // Contraejemplo vivo en `get invoice_data_requests()`, que devuelve
    // `baseClient` y deja cualquier `where: { id }` legible entre tenants.
    //
    // Se comprueba primero que el delegado EXISTE. Sin eso la comparación sería
    // `undefined === undefined` y pasaría igual con los getters mal escritos:
    // jest corre en el host, y el cliente Prisma del host es una copia distinta
    // de la del contenedor —`/app/node_modules` es un volumen nombrado—, así que
    // se queda rancio hasta que se genera también acá.
    const base = (service as any).baseClient;
    const scoped = (service as any).scoped_client;

    expect(base.invoice_profiles).toBeDefined();
    expect(base.invoice_profile_versions).toBeDefined();

    expect(service.invoice_profiles).toBe(scoped.invoice_profiles);
    expect(service.invoice_profile_versions).toBe(
      scoped.invoice_profile_versions,
    );
    expect(service.invoice_profiles).not.toBe(base.invoice_profiles);
    expect(service.invoice_profile_versions).not.toBe(
      base.invoice_profile_versions,
    );
  });

  it('un `store_id` ajeno en el `where` del llamador NO lo saca de su tienda', async () => {
    // `mergeScopedWhere` NO sobrescribe el valor del llamador: lo deja arriba y
    // empuja el scope a un `AND`. El resultado es `store_id = 99 AND
    // store_id = 3`, imposible, así que la consulta devuelve cero filas.
    //
    // Se afirma la forma COMPLETA y no `toMatchObject`: mirar sólo el
    // `store_id` de arriba muestra el 99 del llamador y parece una fuga cuando
    // en realidad es la mitad de una contradicción. La protección está en el
    // `AND`, no en el valor de arriba.
    await expect(
      scopedWhere('invoice_profiles', { where: { id: 5, store_id: 99 } }),
    ).resolves.toEqual({ id: 5, store_id: 99, AND: [{ store_id: 3 }] });
  });
});
