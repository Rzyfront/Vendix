import { Injectable } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VendixHttpException, ErrorCodes } from '../../../../../common/errors';
import {
  UpsertGatewayDto,
  PlatformGatewayEnvironmentEnum,
} from '../dto/upsert-gateway.dto';

/**
 * Mirror of the per-store WompiConfigValidator but enforced at the
 * platform level (superadmin/subscriptions/gateway).
 *
 * Adds explicit production confirmation rules: switching to production
 * is destructive (real money flows) so we require:
 *   1. confirm_production === true when activating production
 *
 * NOTE: The cross-field rule "keys must match the declared environment"
 * is intentionally NOT enforced here. With partial-PATCH semantics, the
 * effective credentials are only known AFTER merging the DTO with the
 * stored secrets. That check now lives in
 * `PlatformGatewayService.upsertCredentials` once the effective
 * credentials are known.
 */
@Injectable()
export class PlatformWompiConfigValidator {
  async validate(dto: UpsertGatewayDto): Promise<void> {
    // 1. Run class-validator on the DTO instance to surface decorator
    //    constraints in the standard 422 response shape.
    const instance = plainToInstance(UpsertGatewayDto, dto);
    const errors = await validate(instance);
    if (errors.length > 0) {
      const messages = errors
        .flatMap((e) => Object.values(e.constraints ?? {}))
        .filter(Boolean);
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_001,
        messages.join(' | ') || 'Credenciales de pasarela inválidas',
      );
    }

    // 2. Production activation requires explicit confirmation.
    //    If is_active is being set to true while environment=production,
    //    the operator MUST send confirm_production=true.
    const isProductionEnv =
      dto.environment === PlatformGatewayEnvironmentEnum.PRODUCTION;
    if (
      isProductionEnv &&
      dto.is_active === true &&
      dto.confirm_production !== true
    ) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_001,
        'Activar credenciales de producción requiere confirm_production=true.',
      );
    }
  }
}
