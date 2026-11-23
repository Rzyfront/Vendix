import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { RutScannerController as OrgRutScannerController } from '../../domains/organization/settings/rut-scanner.controller';
import { RutScannerController as StoreRutScannerController } from '../../domains/store/settings/rut-scanner.controller';
import { OrgDianConfigController } from '../../domains/organization/invoicing/dian-config/dian-config.controller';
import { DianConfigController } from '../../domains/store/invoicing/dian-config/dian-config.controller';
import { SuperadminFiscalOperationsController } from '../../domains/superadmin/fiscal-operations/superadmin-fiscal-operations.controller';
import { SubscriptionFiscalController } from '../../domains/superadmin/subscriptions/fiscal/subscription-fiscal.controller';
import { ResolutionsController } from '../../domains/store/invoicing/resolutions/resolutions.controller';
import { RouteFlowController } from '../../domains/store/dispatch-routes/route-flow/route-flow.controller';
import { InventoryAdjustmentsController } from '../../domains/store/inventory/adjustments/inventory-adjustments.controller';
import { MemberBulkScannerController } from '../../domains/store/memberships/member-bulk-scanner.controller';

/**
 * ia-cargas F6: the synchronous AI scan endpoints marked `@deprecated` (504
 * after 60 s of proxy) had no caller left in apps/frontend, apps/mobile,
 * other backend services, the Vexi toolbox or jobs, so they were removed.
 * Their `/async` replacement (ai-scan queue) stays.
 */
type Ctor = new (...args: never[]) => unknown;

/** `POST` paths a controller exposes, without its prefix. */
function postPaths(controller: Ctor): string[] {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => proto[name])
    .filter((handler): handler is object => typeof handler === 'function')
    .filter(
      (handler) =>
        Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.POST,
    )
    .map((handler) => String(Reflect.getMetadata(PATH_METADATA, handler)));
}

const CASES: Array<{
  name: string;
  controller: Ctor;
  prefix: string;
  retired: string;
  kept: string;
}> = [
  {
    name: 'RUT (organización)',
    controller: OrgRutScannerController,
    prefix: 'organization/settings/rut-scanner',
    retired: 'scan',
    kept: 'scan/async',
  },
  {
    name: 'RUT (tienda)',
    controller: StoreRutScannerController,
    prefix: 'store/settings/rut-scanner',
    retired: 'scan',
    kept: 'scan/async',
  },
  {
    name: 'RUT (plataforma)',
    controller: SuperadminFiscalOperationsController,
    prefix: 'super-admin/fiscal',
    retired: 'identity/rut-scanner/scan',
    kept: 'identity/rut-scanner/scan/async',
  },
  {
    name: 'habilitación DIAN (organización)',
    controller: OrgDianConfigController,
    prefix: 'organization/invoicing/dian-config',
    retired: 'scan-habilitation',
    kept: 'scan-habilitation/async',
  },
  {
    name: 'habilitación DIAN (tienda)',
    controller: DianConfigController,
    prefix: 'store/invoicing/dian-config',
    retired: 'scan-habilitation',
    kept: 'scan-habilitation/async',
  },
  {
    name: 'resolución DIAN (tienda)',
    controller: ResolutionsController,
    prefix: 'store/invoicing/resolutions',
    retired: 'scan',
    kept: 'scan/async',
  },
  {
    name: 'resolución DIAN (plataforma)',
    controller: SubscriptionFiscalController,
    prefix: 'superadmin/subscriptions/fiscal',
    retired: 'resolutions/scan',
    kept: 'resolutions/scan/async',
  },
  {
    name: 'planilla de ruta',
    controller: RouteFlowController,
    prefix: 'store/dispatch-routes',
    retired: ':id/scan',
    kept: ':id/scan/async',
  },
  {
    name: 'conteo de inventario por foto',
    controller: InventoryAdjustmentsController,
    prefix: 'store/inventory/adjustments',
    retired: 'scan',
    kept: 'scan/async',
  },
  {
    name: 'padrón de socios',
    controller: MemberBulkScannerController,
    prefix: 'store/memberships/bulk-scan',
    retired: '/',
    kept: 'async',
  },
];

describe('Escaneos con IA síncronos retirados (ia-cargas F6)', () => {
  it.each(CASES)(
    '$name: POST $prefix/$retired ya no existe y POST $prefix/$kept sigue',
    ({ controller, prefix, retired, kept }) => {
      expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(prefix);
      const paths = postPaths(controller);
      expect(paths).not.toContain(retired);
      expect(paths).toContain(kept);
    },
  );

  it('el padrón de socios conserva analyze y commit (los usa Vexi)', () => {
    const paths = postPaths(MemberBulkScannerController);
    expect(paths).toEqual(expect.arrayContaining(['analyze', 'commit']));
  });

  it('la planilla de ruta conserva match y confirm', () => {
    const paths = postPaths(RouteFlowController);
    expect(paths).toEqual(
      expect.arrayContaining([':id/scan/match', ':id/scan/confirm']),
    );
  });
});
