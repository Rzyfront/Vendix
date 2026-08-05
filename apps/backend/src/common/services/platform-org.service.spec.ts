import { Test, TestingModule } from '@nestjs/testing';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { PlatformOrgService } from './platform-org.service';

/**
 * Este servicio decide QUÉ entidad contable es "la de la plataforma", y esa
 * respuesta tiene que coincidir con la que `StorePrismaService` deriva para
 * filtrar cada consulta. Cuando no coinciden, todo lo que se escribe bajo una es
 * invisible para las lecturas de la otra: filas que existen contestan 404 y
 * ningún valor que el operador teclee reconcilia los dos lados.
 *
 * En producción pasó exactamente eso — los ajustes fiscales de plataforma
 * apuntaban a la entidad de la tienda 1 mientras el scope solo resolvía la
 * consolidada, así que la resolución de habilitación era ilegible para el flujo
 * que tenía que leerla.
 */
describe('PlatformOrgService — selección de la entidad fiscal', () => {
  let service: PlatformOrgService;
  let organizations: { findFirst: jest.Mock; findUnique: jest.Mock };

  /** Las tres entidades que la organización plataforma tiene en producción. */
  const PLATFORM_ENTITIES = [
    { id: 18, store_id: 1, scope: 'STORE', fiscal_scope: 'STORE' },
    { id: 21, store_id: 2, scope: 'STORE', fiscal_scope: 'STORE' },
    { id: 95, store_id: null, scope: 'ORGANIZATION', fiscal_scope: 'ORGANIZATION' },
  ];

  const buildOrg = (
    fiscal_scope: string,
    accounting_entities: typeof PLATFORM_ENTITIES,
  ) => ({
    id: 1,
    fiscal_scope,
    operating_scope: 'ORGANIZATION',
    accounting_entities,
  });

  beforeEach(async () => {
    organizations = { findFirst: jest.fn(), findUnique: jest.fn() };
    const withoutScope = jest.fn(() => ({ organizations }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformOrgService,
        { provide: GlobalPrismaService, useValue: { withoutScope } },
      ],
    }).compile();

    service = module.get(PlatformOrgService);
    organizations.findFirst.mockResolvedValue({ id: 1 });
  });

  afterEach(() => service.clearCache());

  it('devuelve la entidad consolidada, no la primera activa, cuando fiscal_scope es ORGANIZATION', async () => {
    // La entidad 18 llega primero en el array — es la que devolvía el `take(1)`
    // sin orden que causó el defecto.
    organizations.findUnique.mockResolvedValue(
      buildOrg('ORGANIZATION', PLATFORM_ENTITIES),
    );

    const context = await service.getPlatformContext();

    expect(context?.accounting_entity_id).toBe(95);
    expect(context?.fiscal_scope).toBe('ORGANIZATION');
  });

  it('pide las entidades ordenadas por id para que la respuesta sea determinista', async () => {
    organizations.findUnique.mockResolvedValue(
      buildOrg('ORGANIZATION', PLATFORM_ENTITIES),
    );

    await service.getPlatformContext();

    const select = organizations.findUnique.mock.calls[0][0].select;
    expect(select.accounting_entities.orderBy).toEqual({ id: 'asc' });
    // Sin `take: 1`: hay que ver todas para poder elegir la que corresponde al
    // fiscal_scope en vez de la que la base devuelva primero.
    expect(select.accounting_entities.take).toBeUndefined();
  });

  it('falla en vez de caer en una entidad de tienda cuando falta la consolidada', async () => {
    // Degradar aquí es lo que reproduce el bug: la entidad de tienda "funciona"
    // al escribir y desaparece al leer.
    organizations.findUnique.mockResolvedValue(
      buildOrg(
        'ORGANIZATION',
        PLATFORM_ENTITIES.filter((entity) => entity.store_id !== null),
      ),
    );

    await expect(service.getPlatformContext()).rejects.toThrow(
      /fiscal_scope=ORGANIZATION but no active consolidated accounting_entity/,
    );
  });

  it('devuelve la entidad de tienda cuando fiscal_scope es STORE', async () => {
    organizations.findUnique.mockResolvedValue(
      buildOrg('STORE', PLATFORM_ENTITIES),
    );

    const context = await service.getPlatformContext();

    expect(context?.accounting_entity_id).toBe(18);
    expect(context?.fiscal_scope).toBe('STORE');
  });

  it('falla cuando la organización plataforma no tiene ninguna entidad activa', async () => {
    organizations.findUnique.mockResolvedValue(buildOrg('ORGANIZATION', []));

    await expect(service.getPlatformContext()).rejects.toThrow(
      /has no active accounting_entity/,
    );
  });

  it('devuelve null sin consultar entidades cuando la organización plataforma no existe', async () => {
    organizations.findUnique.mockResolvedValue(null);

    await expect(service.getPlatformContext()).resolves.toBeNull();
  });
});
