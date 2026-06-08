import type { ISODateString } from './common.types';

export type DomainStatus = 'PENDING' | 'VERIFYING' | 'ACTIVE' | 'FAILED' | 'EXPIRED';

export interface Domain {
  id: string;
  hostname: string;
  root_domain: string;
  subdomain?: string | null;
  status: DomainStatus;
  is_primary: boolean;
  is_verified: boolean;
  ssl_status?: 'PENDING' | 'PROVISIONING' | 'ACTIVE' | 'FAILED';
  cloudfront_status?: 'PENDING' | 'PROVISIONING' | 'ACTIVE' | 'FAILED';
  certificate_id?: string;
  organization_id: string;
  store_ids?: string[];
  verification_records?: DnsRecord[];
  dns_instructions?: DnsRecord[];
  created_at: ISODateString;
  updated_at: ISODateString;
  verified_at?: ISODateString | null;
  expires_at?: ISODateString | null;
}

export interface DnsRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'SRV';
  host: string;
  value: string;
  ttl?: number;
  priority?: number;
  status?: 'PENDING' | 'VERIFIED' | 'FAILED';
}

export interface DomainRoot {
  id: string;
  root_domain: string;
  status: DomainStatus;
  certificate_id?: string;
  cloudfront_domain?: string;
  verified_at?: ISODateString | null;
  subdomains: Domain[];
  dns_instructions: DnsRecord[];
  created_at: ISODateString;
  updated_at: ISODateString;
}
