import { IsIn, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

import { RECEIVED_BUYER_EVENT_CODES } from './received-buyer-event-request.dto';

export class ReceivedBuyerEventCommandDto {
  @IsIn(RECEIVED_BUYER_EVENT_CODES)
  event_code!: (typeof RECEIVED_BUYER_EVENT_CODES)[number];

  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{1,120}$/)
  idempotency_key!: string;

  @ValidateIf((dto: ReceivedBuyerEventCommandDto) => dto.event_code === '031' || dto.description !== undefined)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ValidateIf((dto: ReceivedBuyerEventCommandDto) => dto.event_code === '031' || dto.claim_concept_code !== undefined)
  @IsIn(['01', '02', '03', '04'])
  claim_concept_code?: '01' | '02' | '03' | '04';
}
