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
 *   1. confirm_production === true
 *   2. environment-key alignment (prv_prod_/pub_prod_ ↔ production,
 *      prv_test_/pub_test_ ↔ sandbox)
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

    // 2. Cross-field rule: keys must match their declared environment.
    const isProductionEnv =
      dto.environment === PlatformGatewayEnvironmentEnum.PRODUCTION;
    const looksProdKey =
      dto.public_key.startsWith('pub_prod_') ||
      dto.private_key.startsWith('prv_prod_');
    const looksTestKey =
      dto.public_key.startsWith('pub_test_') ||
      dto.private_key.startsWith('prv_test_');

    if (isProductionEnv && looksTestKey) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_001,
        'Estás declarando ambiente production pero las credenciales son de prueba (pub_test_/prv_test_).',
      );
    }
    if (!isProductionEnv && looksProdKey) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_001,
        'Estás declarando ambiente sandbox pero las credenciales son de producción (pub_prod_/prv_prod_).',
      );
    }

    // 3. Production activation requires explicit confirmation.
    //    If is_active is being set to true while environment=production,
    //    the operator MUST send confirm_production=true.
    if (isProductionEnv && dto.is_active === true && dto.confirm_production !== true) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_001,
        'Activar credenciales de producción requiere confirm_production=true.',
      );
    }
  }
}
