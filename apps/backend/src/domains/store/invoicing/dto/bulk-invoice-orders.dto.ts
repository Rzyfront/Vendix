import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MAX_BULK_ORDERS_IDS } from '../../orders/dto/bulk-orders.dto';
import { EmitOrderCreditDto } from './emit-order.dto';

/** Orders per execute request; the frontend sends chunks one after another. */
export const MAX_BULK_INVOICE_ITEMS = 5;

/** Body of `POST store/orders/bulk/invoice/preview`. */
export class BulkInvoicePreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_ORDERS_IDS)
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];
}

export class BulkInvoiceItemDto {
  @IsInt()
  @Type(() => Number)
  order_id: number;

  /** Holder document number shown in the preview (`222222222222` for CF). */
  @IsString()
  expected_holder_document: string;

  /** Explicit opt-in: emit to Consumidor final when the customer lacks data. */
  @IsOptional()
  @IsBoolean()
  allow_final_consumer?: boolean;
}

/** Body of `POST store/orders/bulk/invoice`. */
export class BulkInvoiceExecuteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_INVOICE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => BulkInvoiceItemDto)
  items: BulkInvoiceItemDto[];

  /** One credit data set for every `to_credit` order of the request. */
  @IsOptional()
  @ValidateNested()
  @Type(() => EmitOrderCreditDto)
  credit?: EmitOrderCreditDto;
}

export type BulkInvoiceBlockedCode =
  | 'partial_payment'
  | 'customer_required'
  | 'order_state'
  | 'already_invoiced'
  | 'split_active'
  | 'not_found'
  | 'in_process';

export interface BulkInvoicePreviewRow {
  id: number;
  order_number: string;
  grand_total: string;
  payment: 'paid' | 'credit_existing' | 'to_credit' | 'blocked';
  blocked_code: BulkInvoiceBlockedCode | null;
  holder: {
    rail: 'nominative' | 'final_consumer';
    source: 'customer' | 'guest_request' | 'none';
    name: string;
    document_type: string;
    document_number: string;
    verification_digit: string | null;
  };
  holder_issue: {
    code:
      | 'missing_document_number'
      | 'missing_name'
      | 'final_consumer_sentinel'
      | 'document_type_required';
    missing_fields: string[];
    message: string;
  } | null;
  cf_overridable: boolean;
  will_emit: boolean;
  skip_reason: string | null;
}

export interface BulkInvoicePreviewResult {
  store_eligible: boolean;
  store_blocker: string | null;
  summary: {
    total: number;
    paid: number;
    credit_existing: number;
    to_credit: number;
    final_consumer: number;
    blocked: number;
    cf_overridable: number;
    will_emit: number;
  };
  results: BulkInvoicePreviewRow[];
}

export interface BulkInvoiceResultItem {
  id: number;
  status: 'ok' | 'error';
  code?: string;
  message?: string;
  invoice_number?: string;
  invoice_status?: string;
}

export interface BulkInvoiceResult {
  total: number;
  successful: number;
  failed: number;
  results: BulkInvoiceResultItem[];
}
