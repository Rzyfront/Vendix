import { IsIn, IsOptional } from 'class-validator';

/** Pending tickets auto-return ingredients. Later states require a choice. */
export class CancelKitchenTicketDto {
  @IsOptional()
  @IsIn(['reuse', 'waste'])
  disposition?: 'reuse' | 'waste';
}
