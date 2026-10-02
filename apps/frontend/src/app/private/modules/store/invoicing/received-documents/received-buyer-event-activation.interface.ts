export type ReceivedBuyerEventCode = '030' | '031' | '032' | '033';
export type BuyerEventActivationStatus = 'not_started' | 'testing' | 'verified' | 'suspended';

export interface BuyerEventActivationStatusView {
  status: BuyerEventActivationStatus;
  version: number;
  event_codes: string[];
  dian_configuration_id: number | null;
  evidence_id: number | null;
  verified_at: string | null;
}

export interface BuyerEventReadinessView {
  status: BuyerEventActivationStatus;
  ready: boolean;
  blockers: string[];
  event_codes: string[];
}

export interface BuyerEventOptionsView {
  dian_configurations: Array<{
    id: number;
    name: string;
    environment: string;
    enablement_status: string;
    has_certificate: boolean;
    has_software_id: boolean;
  }>;
  configurations_truncated: boolean;
  evidence: Array<{
    id: number;
    evidence_type: string;
    created_at: string | null;
    has_artifact: boolean;
  }>;
  total: number;
  page: number;
  limit: number;
}

export interface RequestBuyerEventActivationInput {
  expected_version: number;
  dian_configuration_id: number;
  evidence_id: number;
  event_codes: ReceivedBuyerEventCode[];
}

export interface BuyerEventActivationCodeState {
  code: ReceivedBuyerEventCode;
  readiness: BuyerEventReadinessView;
}

export interface BuyerEventActivationSnapshot {
  status: BuyerEventActivationStatusView;
  readiness: BuyerEventActivationCodeState[];
}
