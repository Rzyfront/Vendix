import { IsEnum, IsNotEmpty } from 'class-validator';
import { store_subscription_state_enum } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body DTO for `POST /superadmin/subscriptions/dunning/:id/preview-transition`.
 * Computes the side-effects of a hypothetical state transition without
 * mutating the subscription. Used by the super-admin Dunning UI to render a
 * confirmation modal before the actual force-transition is fired.
 */
export class PreviewTransitionDto {
  @ApiProperty({
    enum: [
      'draft',
      'pending_payment',
      'trial',
      'active',
      'grace_soft',
      'grace_hard',
      'suspended',
      'blocked',
      'cancelled',
      'expired',
    ],
    description: 'Target state to simulate the transition into.',
  })
  @IsNotEmpty()
  @IsEnum(
    {
      draft: 'draft',
      pending_payment: 'pending_payment',
      trial: 'trial',
      active: 'active',
      grace_soft: 'grace_soft',
      grace_hard: 'grace_hard',
      suspended: 'suspended',
      blocked: 'blocked',
      cancelled: 'cancelled',
      expired: 'expired',
    },
    { message: 'target_state must be a valid store_subscription_state_enum' },
  )
  target_state!: store_subscription_state_enum;
}
