import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from '../../domains/auth/guards/permissions.guard';
import { VendixHttpException } from '../errors';
import {
  HOUSEKEEPER_ROLE,
  LODGING_ROLE_PERMISSIONS,
  RECEPTIONIST_ROLE,
  applyRolePanelPreset,
} from './lodging-roles.constant';

/**
 * H0.5 — roles base de hotelería (D10). The seed syncs exactly these lists,
 * so a permission dropped from here breaks the role's workflow with a 403 and
 * one added here widens what the role can do. Both changes must be deliberate.
 */
describe('Hotel default roles (H0.5)', () => {
  describe('permission sets', () => {
    it('Recepcionista carries every permission of the front-desk workflow', () => {
      expect([...LODGING_ROLE_PERMISSIONS[RECEPTIONIST_ROLE]].sort()).toEqual(
        [
          'store:customers:create',
          'store:customers:read',
          'store:customers:update',
          'store:lodging:compliance:operate',
          'store:lodging:folio:charge',
          'store:lodging:folio:close',
          'store:lodging:front_desk:operate',
          'store:lodging:housekeeping:read',
          'store:lodging:inventory:read',
          'store:lodging:night_audit:close',
          'store:lodging:reservations:read',
          'store:lodging:reservations:write',
          'store:orders:create',
          'store:orders:order_flow:create',
          'store:orders:order_flow:read',
          'store:orders:read',
          'store:orders:update',
          'store:pos:access',
          'store:products:read',
          'store:products:read:one',
          'store:products:read:slug',
          'store:products:read:store',
        ],
      );
    });

    it('Camarera carries the housekeeping workflow and nothing with money', () => {
      expect([...LODGING_ROLE_PERMISSIONS[HOUSEKEEPER_ROLE]].sort()).toEqual([
        'store:lodging:housekeeping:operate',
        'store:lodging:housekeeping:read',
        'store:lodging:inventory:read',
      ]);
    });

    it.each([RECEPTIONIST_ROLE, HOUSEKEEPER_ROLE])(
      '%s has no rates, settings, channels or room-type editing',
      (role) => {
        const names = LODGING_ROLE_PERMISSIONS[role];
        expect(
          names.filter(
            (n) =>
              n.startsWith('store:lodging:rates:') ||
              n.startsWith('store:lodging:channels:') ||
              n.startsWith('store:settings:') ||
              n === 'store:lodging:inventory:write',
          ),
        ).toEqual([]);
      },
    );
  });

  describe('PermissionsGuard with the role sets', () => {
    let guard: PermissionsGuard;

    function attempt(role: string, required: string, method: string): boolean {
      jest
        .spyOn(Reflector.prototype, 'getAllAndOverride')
        .mockReturnValue([required]);

      // Distinct dummy paths: only the named match can authorize here.
      const holds = LODGING_ROLE_PERMISSIONS[role].map((name) => ({
        name,
        path: `/api/__test__/${name}`,
        method,
        status: 'active',
      }));
      const routePath = '/api/store/hospitality/rates';
      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            user: { roles: [role], permissions: holds },
            method,
            route: { path: routePath },
            url: routePath,
          }),
        }),
      } as unknown as ExecutionContext;

      return guard.canActivate(context);
    }

    beforeEach(() => {
      guard = new PermissionsGuard(new Reflector());
    });

    afterEach(() => jest.restoreAllMocks());

    it('a receptionist calling a rates endpoint is rejected (403)', () => {
      expect(() =>
        attempt(RECEPTIONIST_ROLE, 'store:lodging:rates:write', 'POST'),
      ).toThrow(VendixHttpException);
      expect(() =>
        attempt(RECEPTIONIST_ROLE, 'store:lodging:rates:read', 'GET'),
      ).toThrow(VendixHttpException);
    });

    it('a housekeeper creating a reservation is rejected (403)', () => {
      expect(() =>
        attempt(HOUSEKEEPER_ROLE, 'store:lodging:reservations:write', 'POST'),
      ).toThrow(VendixHttpException);
    });

    it('a receptionist creating a reservation passes', () => {
      expect(
        attempt(RECEPTIONIST_ROLE, 'store:lodging:reservations:write', 'POST'),
      ).toBe(true);
    });
  });

  describe('applyRolePanelPreset', () => {
    const config = {
      panel_ui: {
        STORE_ADMIN: {
          hospitality: true,
          hospitality_rooms: true,
          hospitality_reservations: true,
          pos: true,
          settings: true,
          settings_general: true,
          inventory: true,
        },
        ORG_ADMIN: { dashboard: true },
      },
      preferences: { language: 'es' },
    };

    it('a receptionist starts with only the front-desk modules visible', () => {
      const out = applyRolePanelPreset(config, RECEPTIONIST_ROLE);

      expect(out.panel_ui.STORE_ADMIN).toMatchObject({
        hospitality: true,
        hospitality_rooms: true,
        hospitality_reservations: true,
        pos: true,
        settings: false,
        settings_general: false,
        inventory: false,
      });
      expect(out.panel_ui.ORG_ADMIN).toEqual({ dashboard: true });
      expect(out.preferences).toEqual({ language: 'es' });
    });

    it('a housekeeper does not see POS', () => {
      const out = applyRolePanelPreset(config, HOUSEKEEPER_ROLE);
      expect(out.panel_ui.STORE_ADMIN.pos).toBe(false);
      expect(out.panel_ui.STORE_ADMIN.hospitality_rooms).toBe(true);
      expect(out.panel_ui.STORE_ADMIN.hospitality_reservations).toBe(false);
    });

    it('other roles keep the default panel untouched', () => {
      expect(applyRolePanelPreset(config, 'employee')).toBe(config);
      expect(applyRolePanelPreset(config, undefined)).toBe(config);
    });
  });
});
