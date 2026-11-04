import 'reflect-metadata';
import { INDUSTRY_MODULE_KEY } from '../decorators/industry-module.decorator';
import { IndustryModuleGuard } from '../guards/industry-module.guard';
import { MODULE_INDUSTRIES } from './module-industries';
import { DispatchNotesController } from '../../domains/store/dispatch-notes/dispatch-notes.controller';
import { DispatchRoutesController } from '../../domains/store/dispatch-routes/dispatch-routes.controller';
import { RouteFlowController } from '../../domains/store/dispatch-routes/route-flow/route-flow.controller';
import { RouteTrackingController } from '../../domains/store/dispatch-routes/tracking/route-tracking.controller';
import { VehiclesController } from '../../domains/store/dispatch-routes/vehicles.controller';
import { LodgingAllotmentsController } from '../../domains/store/hospitality/reservations/allotments/allotments.controller';
import { LodgingInventoryBlocksController } from '../../domains/store/hospitality/reservations/blocks/inventory-blocks.controller';
import { LodgingCheckOutController } from '../../domains/store/hospitality/reservations/check-out/check-out.controller';
import { LodgingDepositsController } from '../../domains/store/hospitality/reservations/deposits/deposits.controller';
import { LodgingFolioSplitController } from '../../domains/store/hospitality/reservations/folio-split/folio-split.controller';
import { LodgingFolioController } from '../../domains/store/hospitality/reservations/folio/folio.controller';
import { LodgingFrontDeskController } from '../../domains/store/hospitality/reservations/front-desk/front-desk.controller';
import { LodgingGuestsController } from '../../domains/store/hospitality/reservations/guests/guests.controller';
import { LodgingKeyHandoversController } from '../../domains/store/hospitality/reservations/key-handovers/key-handovers.controller';
import { LodgingNightAuditController } from '../../domains/store/hospitality/reservations/night-audit/night-audit.controller';
import { LodgingPrecheckinController } from '../../domains/store/hospitality/reservations/precheckin/precheckin.controller';
import { LodgingRackController } from '../../domains/store/hospitality/reservations/rack/rack.controller';
import { LodgingCancellationsController } from '../../domains/store/hospitality/reservations/reports/cancellations.controller';
import { LodgingFonturController } from '../../domains/store/hospitality/reservations/reports/fontur.controller';
import { LodgingPerformanceController } from '../../domains/store/hospitality/reservations/reports/performance.controller';
import { LodgingPickupController } from '../../domains/store/hospitality/reservations/reports/pickup.controller';
import { LodgingVatExemptServicesController } from '../../domains/store/hospitality/reservations/reports/vat-exempt-services.controller';
import { LodgingReservationsController } from '../../domains/store/hospitality/reservations/reservations.controller';
import { LodgingRoomChargesController } from '../../domains/store/hospitality/reservations/room-charges/room-charges.controller';
import { KdsController } from '../../domains/store/kds/kds.controller';
import { KdsSessionsController } from '../../domains/store/kds/sessions/kds-sessions.controller';
import { KitchenFireController } from '../../domains/store/kitchen-fire/kitchen-fire.controller';
import { FormulasController } from '../../domains/store/manufacturing/formulas/formulas.controller';
import { ManufacturingOrdersController } from '../../domains/store/manufacturing/orders/manufacturing-orders.controller';
import { ManufacturingSettingsController } from '../../domains/store/manufacturing/settings/manufacturing-settings.controller';
import { MembershipAccessController } from '../../domains/store/membership-access/membership-access.controller';
import { MembershipPlansController } from '../../domains/store/membership-plans/membership-plans.controller';
import { MemberBulkScannerController } from '../../domains/store/memberships/member-bulk-scanner.controller';
import { MemberProfilesController } from '../../domains/store/memberships/member-profiles.controller';
import { MembershipsController } from '../../domains/store/memberships/memberships.controller';
import { MenuAvailabilityController } from '../../domains/store/menus/menu-availability.controller';
import { MenuEngineeringController } from '../../domains/store/menus/menu-engineering.controller';
import { MenuSectionsController } from '../../domains/store/menus/menu-sections.controller';
import { MenusController } from '../../domains/store/menus/menus.controller';
import { ProductionOrdersController } from '../../domains/store/production/production-orders.controller';
import { RecipesController } from '../../domains/store/recipes/recipes.controller';
import { SplitOrderController } from '../../domains/store/tables/split-order.controller';
import { TableSessionsController } from '../../domains/store/tables/table-sessions.controller';
import { TablesController } from '../../domains/store/tables/tables.controller';

// A removed decorator or guard on any admin controller fails this spec.
const EXPECTED: Array<[string, new (...args: any[]) => unknown, string]> = [
  ['DispatchNotesController', DispatchNotesController, 'orders_dispatch_notes'],
  ['DispatchRoutesController', DispatchRoutesController, 'orders_dispatch_routes'],
  ['RouteFlowController', RouteFlowController, 'orders_dispatch_routes'],
  ['RouteTrackingController', RouteTrackingController, 'orders_dispatch_routes'],
  ['VehiclesController', VehiclesController, 'dispatch_fleet'],
  ['LodgingAllotmentsController', LodgingAllotmentsController, 'hospitality_reservations'],
  ['LodgingInventoryBlocksController', LodgingInventoryBlocksController, 'hospitality_reservations'],
  ['LodgingCheckOutController', LodgingCheckOutController, 'hospitality_reservations'],
  ['LodgingDepositsController', LodgingDepositsController, 'hospitality_reservations'],
  ['LodgingFolioSplitController', LodgingFolioSplitController, 'hospitality_reservations'],
  ['LodgingFolioController', LodgingFolioController, 'hospitality_reservations'],
  ['LodgingFrontDeskController', LodgingFrontDeskController, 'hospitality_reservations'],
  ['LodgingGuestsController', LodgingGuestsController, 'hospitality_reservations'],
  ['LodgingKeyHandoversController', LodgingKeyHandoversController, 'hospitality_reservations'],
  ['LodgingNightAuditController', LodgingNightAuditController, 'hospitality_reservations'],
  ['LodgingPrecheckinController', LodgingPrecheckinController, 'hospitality_reservations'],
  ['LodgingRackController', LodgingRackController, 'hospitality_reservations'],
  ['LodgingCancellationsController', LodgingCancellationsController, 'hospitality_reservations'],
  ['LodgingFonturController', LodgingFonturController, 'hospitality_reservations'],
  ['LodgingPerformanceController', LodgingPerformanceController, 'hospitality_reservations'],
  ['LodgingPickupController', LodgingPickupController, 'hospitality_reservations'],
  ['LodgingVatExemptServicesController', LodgingVatExemptServicesController, 'hospitality_reservations'],
  ['LodgingReservationsController', LodgingReservationsController, 'hospitality_reservations'],
  ['LodgingRoomChargesController', LodgingRoomChargesController, 'hospitality_reservations'],
  ['KdsController', KdsController, 'restaurant_ops_kds'],
  ['KdsSessionsController', KdsSessionsController, 'restaurant_ops_kds'],
  ['KitchenFireController', KitchenFireController, 'restaurant_ops_kds'],
  ['FormulasController', FormulasController, 'manufacturing_formulas'],
  ['ManufacturingOrdersController', ManufacturingOrdersController, 'manufacturing_orders'],
  ['ManufacturingSettingsController', ManufacturingSettingsController, 'manufacturing_settings'],
  ['MembershipAccessController', MembershipAccessController, 'memberships_access'],
  ['MembershipPlansController', MembershipPlansController, 'memberships_plans'],
  ['MemberBulkScannerController', MemberBulkScannerController, 'memberships_members'],
  ['MemberProfilesController', MemberProfilesController, 'memberships_members'],
  ['MembershipsController', MembershipsController, 'memberships_members'],
  ['MenuAvailabilityController', MenuAvailabilityController, 'restaurant_ops_menus'],
  ['MenuEngineeringController', MenuEngineeringController, 'restaurant_ops_menus'],
  ['MenuSectionsController', MenuSectionsController, 'restaurant_ops_menus'],
  ['MenusController', MenusController, 'restaurant_ops_menus'],
  ['ProductionOrdersController', ProductionOrdersController, 'restaurant_ops_production'],
  ['RecipesController', RecipesController, 'restaurant_ops_recipes'],
  ['SplitOrderController', SplitOrderController, 'restaurant_ops_tables'],
  ['TableSessionsController', TableSessionsController, 'restaurant_ops_tables'],
  ['TablesController', TablesController, 'restaurant_ops_tables'],
];

describe('IndustryModule on admin controllers', () => {
  it.each(EXPECTED)('%s declares %s', (_name, controller, key) => {
    expect(Reflect.getMetadata(INDUSTRY_MODULE_KEY, controller)).toBe(key);
    expect(MODULE_INDUSTRIES).toHaveProperty(key);
    expect(Reflect.getMetadata('__guards__', controller)).toContain(
      IndustryModuleGuard,
    );
  });
});
