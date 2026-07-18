import { IsIn } from 'class-validator';

/**
 * Body of `PATCH /store/users/management/:id/app-type` (Vendix Repartos).
 *
 * Manually sets which app a store user lands in: the store admin panel
 * (`STORE_ADMIN`) or the delivery app (`STORE_DELIVERY`). Assigning the
 * `carrier` role NO LONGER moves a user into the delivery app automatically —
 * that decision is now explicit through this endpoint. The service enforces
 * that `STORE_DELIVERY` can only be set for users that already hold the
 * `carrier` role.
 */
export class SetAppTypeDto {
  @IsIn(['STORE_ADMIN', 'STORE_DELIVERY'], {
    message: 'app_type debe ser: STORE_ADMIN o STORE_DELIVERY',
  })
  app_type: 'STORE_ADMIN' | 'STORE_DELIVERY';
}
