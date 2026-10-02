export type BuyerCommandCode = '030' | '031' | '032' | '033';
export type BuyerClaimConcept = '01' | '02' | '03' | '04';
export interface BuyerEventCommandInput {
  event_code: BuyerCommandCode;
  idempotency_key: string;
  description?: string;
  claim_concept_code?: BuyerClaimConcept;
}
export interface BuyerEventCommandResult {
  status: string;
  duplicate: boolean;
  event_id: number;
  event_number: string | null;
  cude?: string | null;
  created_at?: string | null;
}
