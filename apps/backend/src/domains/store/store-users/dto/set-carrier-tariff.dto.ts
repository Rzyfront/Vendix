import { IsIn, IsString, Matches } from 'class-validator';

/**
 * Body of `PATCH /store/users/management/:id/carrier-tariff` (Vendix Repartos
 * Fase B8). Sets the per-carrier tariff persisted under
 * `user_settings.config.carrier_tariff`.
 *
 * Money is ALWAYS a Decimal string (never a float): `amount` is validated as a
 * non-negative decimal with up to 2 fraction digits. `currency` is fixed to
 * 'COP' by the service (not accepted from the client in v1).
 */
export class SetCarrierTariffDto {
  @IsIn(['per_stop', 'per_route'], {
    message: 'mode debe ser: per_stop o per_route',
  })
  mode: 'per_stop' | 'per_route';

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message:
      'amount debe ser un decimal no negativo (string) con hasta 2 decimales',
  })
  amount: string;
}
