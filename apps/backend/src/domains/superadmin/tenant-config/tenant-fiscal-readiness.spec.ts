import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { RequestContextService } from '@common/context/request-context.service';
import { TenantContextRunner } from '@common/context/tenant-context-runner.service';
import { ResponseService } from '@common/responses/response.service';
import { S3Service } from '@common/services/s3.service';

import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { OrgDianConfigService } from '../../organization/invoicing/dian-config/dian-config.service';
import { ManualCertificateIssuerAdapter } from '../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { DianConfigService } from '../../store/invoicing/dian-config/dian-config.service';
import { DianTestService } from '../../store/invoicing/dian-config/dian-test.service';
import { DIAN_CONFIGURATION_TYPES } from '../../store/invoicing/fiscal-document-requirements';
import { FiscalProductionReadinessService } from '../../store/invoicing/providers/fiscal-production-readiness.service';

import { TenantDianConfigController } from './tenant-dian-config.controller';

/**
 * `GET /superadmin/tenants/:scope/:tenantId/invoicing/dian-config/fiscal-readiness`.
 *
 * ## Qué protege este archivo
 *
 * El rail de soporte no tenía el agregado, así que la consola componía los cuatro
 * ejes desde el cliente con un N+1 (`dian-config` + un `:id/production-readiness`
 * por configuración + `resolutions`). Eso no es una ineficiencia: es una SEGUNDA
 * implementación del mismo checklist. En cuanto una de las dos derive, soporte y
 * comerciante leerán estados distintos sobre el mismo NIT y no habrá forma de
 * saber cuál miente.
 *
 * Por eso el controlador delega en `DianConfigService.getFiscalReadiness` —el
 * MISMO método que sirve al panel del comerciante— y estos tests montan una app
 * Nest de verdad, con el servicio de tienda REAL sobre un Prisma falso. Un mock
 * del agregado afirmaría que el rail devuelve lo que el mock dice, que es
 * exactamente la clase de test que no habría detectado la divergencia.
 *
 * Los cuatro puntos que se afirman:
 *   (a) el literal `fiscal-readiness` resuelve su handler y NO cae en `:configId`;
 *   (b) la clave técnica no aparece en la respuesta serializada;
 *   (c) un tenant sin ninguna configuración recibe los CUATRO ejes;
 *   (d) un token sin `superadmin:tenants:dian:read` no pasa.
 */
describe('TenantDianConfigController · fiscal-readiness', () => {
  /** Clave técnica de mentira, tratada como la de verdad: NO puede salir. */
  const CLTEC_SECRETA = 'CLTEC-DE-UN-TERCERO-QUE-NUNCA-DEBE-VIAJAR-7b21';

  const TENANT = {
    organization_id: 7,
    store_id: 12,
    fiscal_scope: 'STORE' as const,
    operating_scope: 'STORE' as const,
    organization_name: 'Distribuidora Demo',
    organization_slug: 'demo',
    store_name: 'Sede Norte',
    store_is_active: true,
  };

  const SUPER_ADMIN = {
    id: 1,
    email: 'soporte@vendix.com',
    roles: ['super_admin'],
    permissions: [
      {
        name: 'superadmin:tenants:dian:read',
        path: '/superadmin/tenants',
        method: 'GET',
        status: 'active',
      },
    ],
  };

  /**
   * Dueño de una tienda: tiene facturación en SU panel y ninguna capacidad sobre
   * la consola de tenants. Es el atacante realista de este rail — no un token
   * vacío, sino uno legítimo apuntando a la puerta de al lado.
   */
  const COMERCIANTE = {
    id: 44,
    email: 'owner@tienda.com',
    roles: ['owner'],
    permissions: [
      {
        name: 'invoicing:read',
        path: '/store/invoicing',
        method: 'GET',
        status: 'active',
      },
    ],
  };

  const configRow = (overrides: Record<string, any> = {}) => ({
    id: 41,
    organization_id: TENANT.organization_id,
    store_id: TENANT.store_id,
    accounting_entity_id: 77,
    configuration_type: 'invoicing',
    operation_mode: 'own_software',
    environment: 'test',
    enablement_status: 'testing',
    software_id: 'sw-1',
    software_pin_encrypted: 'pin-cifrado',
    certificate_s3_key: 'certs/tenant.p12',
    certificate_password_encrypted: 'pass-cifrada',
    certificate_kms_key_id: null,
    certificate_expiry: new Date('2099-01-01T00:00:00Z'),
    certificate_fingerprint: 'huella',
    certificate_nit: '900123456',
    enablement_evidence: { track_id: 'track-1' },
    test_set_id: 'set-1',
    last_test_result: { success: true },
    nit: '900123456',
    nit_dv: '1',
    ...overrides,
  });

  const resolutionRow = (overrides: Record<string, any> = {}) => ({
    id: 501,
    document_type: 'sales_invoice',
    resolution_number: '18764000001',
    resolution_date: new Date('2024-01-01T00:00:00Z'),
    prefix: 'FE',
    range_from: 1,
    range_to: 1000,
    current_number: 10,
    valid_from: new Date('2024-01-01T00:00:00Z'),
    valid_to: new Date('2099-01-01T00:00:00Z'),
    is_active: true,
    technical_key: CLTEC_SECRETA,
    ...overrides,
  });

  let app: INestApplication;
  let storeDian: DianConfigService;
  let usuario: any;
  let prismaClient: {
    dian_configurations: { findMany: jest.Mock };
    invoice_resolutions: { findMany: jest.Mock; findFirst: jest.Mock };
  };

  const montar = async (options: {
    configs?: any[];
    resolutions?: any[];
    fiscal_scope?: string;
  }) => {
    prismaClient = {
      dian_configurations: {
        findMany: jest.fn().mockResolvedValue(options.configs ?? []),
      },
      invoice_resolutions: {
        findMany: jest.fn().mockResolvedValue(options.resolutions ?? []),
        // Sonda de clave técnica compartida: sin ClTec propia el hallazgo es
        // `null` — COMPROBADO Y LIMPIO, que no es lo mismo que no comprobar.
        findFirst: jest.fn().mockResolvedValue({
          id: 501,
          technical_key: null,
          accounting_entity: { tax_id: '900123456' },
        }),
      },
    };
    const prisma = { withoutScope: () => prismaClient } as any;
    const encryption = {
      isUsingFallbackKey: () => false,
      needsReencryption: () => false,
    } as any;
    // Servicio de readiness REAL: mockearlo afirmaría que la consola recibe UN
    // checklist, no que recibe EL checklist que bloquea la emisión.
    const readiness = new FiscalProductionReadinessService(prisma, encryption);
    const fiscalScope = {
      requireFiscalScope: jest
        .fn()
        .mockResolvedValue(options.fiscal_scope ?? 'STORE'),
    } as any;
    storeDian = new DianConfigService(prisma, encryption, fiscalScope, readiness);

    /**
     * Sustituto del runner: forja el contexto del tenant igual que el real, sin
     * arrastrar la resolución en base de datos de `(organization, store,
     * fiscal_scope)`, que no es lo que este archivo está probando.
     */
    const runner = {
      runAsTenant: jest.fn(
        (_target: any, opciones: any, fn: (scope: any) => Promise<any>) =>
          RequestContextService.run(
            {
              user_id: opciones?.actor?.user_id,
              email: opciones?.actor?.email,
              organization_id: TENANT.organization_id,
              store_id: TENANT.store_id,
              permissions: opciones?.permissions ?? [],
              is_super_admin: false,
              is_owner: false,
            },
            () => fn(TENANT),
          ),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantDianConfigController],
      providers: [
        { provide: TenantContextRunner, useValue: runner },
        { provide: DianConfigService, useValue: storeDian },
        { provide: OrgDianConfigService, useValue: {} },
        { provide: DianTestService, useValue: {} },
        { provide: ManualCertificateIssuerAdapter, useValue: {} },
        { provide: StorePrismaService, useValue: prisma },
        { provide: S3Service, useValue: {} },
        // El `ResponseService` real: la envoltura `{ success, message, data }`
        // es parte de lo que se serializa y la prueba de fuga la recorre entera.
        ResponseService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Los guards de la clase (`PermissionsGuard`, `RolesGuard`) se dejan REALES:
    // el punto (d) no vale nada contra un guard simulado. Lo único que se inyecta
    // es el usuario que el JWT habría puesto.
    app.use((req: any, _res: any, next: any) => {
      req.user = usuario;
      next();
    });
    await app.init();
    return app;
  };

  const RUTA = '/superadmin/tenants/stores/12/invoicing';

  beforeEach(() => {
    usuario = SUPER_ADMIN;
  });

  afterEach(async () => {
    if (app) await app.close();
    jest.clearAllMocks();
  });

  // (a) —————————————————————————————————————————————————————————————————————
  describe('resolución de ruta', () => {
    it('el literal fiscal-readiness resuelve su handler y no cae en dian-config/:configId', async () => {
      await montar({ configs: [], resolutions: [] });
      const porId = jest.spyOn(storeDian, 'getConfigById');
      const agregado = jest.spyOn(storeDian, 'getFiscalReadiness');

      const respuesta = await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/fiscal-readiness`)
        .expect(200);

      expect(agregado).toHaveBeenCalledTimes(1);
      // La ruta paramétrica es la que se traga el literal cuando el orden de
      // declaración está mal: si se hubiera invocado, el 400 de `ParseIntPipe`
      // sería el síntoma y esta llamada la causa.
      expect(porId).not.toHaveBeenCalled();
      expect(respuesta.body.success).toBe(true);
      expect(Array.isArray(respuesta.body.data.axes)).toBe(true);
    });

    it('la paramétrica sigue rechazando un literal cualquiera con 400 — que es lo que pasaría si el orden se invirtiera', async () => {
      await montar({ configs: [], resolutions: [] });

      // Mismo `ParseIntPipe`, mismo path, texto distinto: prueba que el 200 de
      // arriba lo consigue el ORDEN de declaración, no una laxitud del pipe.
      await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/estado-fiscal`)
        .expect(400);
    });

    it('el handler exige exactamente superadmin:tenants:dian:read', () => {
      const permisos = Reflect.getMetadata(
        PERMISSIONS_KEY,
        TenantDianConfigController.prototype.getFiscalReadiness,
      );
      // El mismo de los demás GET del rail: un permiso nuevo obligaría a sembrar
      // y asignar una fila que nadie recordaría, y el endpoint respondería 403
      // en producción a quien ya puede leerlo todo aquí.
      expect(permisos).toEqual(['superadmin:tenants:dian:read']);
    });
  });

  // (b) —————————————————————————————————————————————————————————————————————
  describe('clave técnica', () => {
    it('no serializa la clave técnica: solo informa technical_key_set', async () => {
      await montar({
        configs: [configRow()],
        resolutions: [resolutionRow()],
      });

      const respuesta = await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/fiscal-readiness`)
        .expect(200);

      const facturacion = respuesta.body.data.axes.find(
        (eje: any) => eje.configuration_type === 'invoicing',
      );
      const resolucion = facturacion.resolutions[0];

      expect(resolucion.technical_key_set).toBe(true);
      // Se ELIMINA, no se enmascara: `in` lo comprueba de verdad, mientras que
      // compararla con undefined pasaría igual si viajara como null.
      expect('technical_key' in resolucion).toBe(false);
      // Y no se cuela por ninguna otra rama del árbol (un spread olvidado en el
      // checklist, en la envoltura de respuesta o en un campo nuevo).
      expect(JSON.stringify(respuesta.body)).not.toContain(CLTEC_SECRETA);
    });

    it('technical_key_set false cuando el rango no tiene clave, sin inventar la columna', async () => {
      await montar({
        configs: [configRow()],
        resolutions: [resolutionRow({ technical_key: null })],
      });

      const respuesta = await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/fiscal-readiness`)
        .expect(200);

      const facturacion = respuesta.body.data.axes.find(
        (eje: any) => eje.configuration_type === 'invoicing',
      );
      expect(facturacion.resolutions[0].technical_key_set).toBe(false);
      expect('technical_key' in facturacion.resolutions[0]).toBe(false);
    });

    it('el barrido del rail respeta el technical_key_set que ya resolvió el agregado', async () => {
      await montar({ configs: [], resolutions: [] });
      // Regresión de la propia redacción defensiva: si recalculara desde una
      // columna ya eliminada en origen, un rango CON clave se anunciaría como
      // vacío y soporte mandaría a cargar una ClTec que ya estaba cargada.
      jest.spyOn(storeDian, 'getFiscalReadiness').mockResolvedValue({
        fiscal_scope: 'STORE',
        axes: [
          {
            configuration_type: 'invoicing',
            label: 'Factura electrónica de venta',
            config_id: 41,
            environment: 'test',
            enablement_status: 'testing',
            readiness: null,
            resolutions: [
              { id: 501, technical_key_set: true } as any,
              { id: 502, technical_key_set: false } as any,
            ],
          } as any,
        ],
      });

      const respuesta = await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/fiscal-readiness`)
        .expect(200);

      const resoluciones = respuesta.body.data.axes[0].resolutions;
      expect(resoluciones[0].technical_key_set).toBe(true);
      expect(resoluciones[1].technical_key_set).toBe(false);
    });
  });

  // (c) —————————————————————————————————————————————————————————————————————
  describe('tenant sin configuración', () => {
    it('devuelve los CUATRO ejes, con config_id null y not_started', async () => {
      await montar({ configs: [], resolutions: [] });

      const respuesta = await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/fiscal-readiness`)
        .expect(200);

      const ejes = respuesta.body.data.axes;
      expect(ejes).toHaveLength(DIAN_CONFIGURATION_TYPES.length);
      expect(ejes.map((eje: any) => eje.configuration_type)).toEqual([
        ...DIAN_CONFIGURATION_TYPES,
      ]);
      for (const eje of ejes) {
        expect(eje.config_id).toBeNull();
        // El eje EXISTE y está sin empezar. No es lo mismo que no aparecer: un
        // eje ausente se lee como «no le aplica a este contribuyente».
        expect(eje.enablement_status).toBe('not_started');
        expect(eje.environment).toBeNull();
        expect(eje.readiness).toBeNull();
        expect(eje.resolutions).toEqual([]);
        expect(eje.label).toBeTruthy();
      }
      expect(respuesta.body.data.fiscal_scope).toBe('STORE');
    });

    it('los ejes sin configurar siguen apareciendo cuando otro eje sí lo está', async () => {
      await montar({
        configs: [configRow()],
        resolutions: [resolutionRow()],
      });

      const respuesta = await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/fiscal-readiness`)
        .expect(200);

      const ejes = respuesta.body.data.axes;
      expect(ejes).toHaveLength(DIAN_CONFIGURATION_TYPES.length);
      const soporte = ejes.find(
        (eje: any) => eje.configuration_type === 'support_document',
      );
      expect(soporte.config_id).toBeNull();
      expect(soporte.enablement_status).toBe('not_started');
      // Y el que sí existe llega con el checklist real, no con una lista vacía:
      // es lo que hace innecesaria la composición N+1 desde el cliente.
      const facturacion = ejes.find(
        (eje: any) => eje.configuration_type === 'invoicing',
      );
      expect(facturacion.config_id).toBe(41);
      expect(facturacion.readiness.checks.length).toBeGreaterThan(0);
    });

    it('ejecuta el agregado DENTRO del contexto forjado del tenant', async () => {
      await montar({ configs: [], resolutions: [] });

      await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/fiscal-readiness`)
        .expect(200);

      // El predicado de tienda del agregado sale del ALS: fuera del contexto
      // forjado leería la organización del super admin y describiría a otro
      // contribuyente con la cara del que se está mirando.
      expect(prismaClient.dian_configurations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { store_id: TENANT.store_id } }),
      );
    });
  });

  // (d) —————————————————————————————————————————————————————————————————————
  describe('autorización', () => {
    it('un token de comerciante, sin superadmin:tenants:dian:read, recibe 403', async () => {
      await montar({ configs: [], resolutions: [] });
      usuario = COMERCIANTE;
      const agregado = jest.spyOn(storeDian, 'getFiscalReadiness');

      const respuesta = await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/fiscal-readiness`)
        .expect(403);

      expect(respuesta.body.error_code).toBe('AUTH_PERM_001');
      // El guard corta ANTES del handler: nada del tenant llegó a leerse, así
      // que el 403 tampoco filtra por diferencia de tiempos si el tenant existe.
      expect(agregado).not.toHaveBeenCalled();
    });

    it('sin usuario en la petición tampoco pasa', async () => {
      await montar({ configs: [], resolutions: [] });
      usuario = undefined;

      await request(app.getHttpServer())
        .get(`${RUTA}/dian-config/fiscal-readiness`)
        .expect(403);
    });
  });
});
