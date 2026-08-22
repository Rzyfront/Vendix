export enum PrintFormatTypeEnum {
  pos_sale_ticket = 'pos_sale_ticket',
  sales_order_invoice = 'sales_order_invoice',
  dispatch_note = 'dispatch_note',
  quotation = 'quotation',
  credit_note = 'credit_note',
  purchase_order = 'purchase_order',
  transfer_note = 'transfer_note',
  fiscal_electronic_invoice = 'fiscal_electronic_invoice',
  fiscal_credit_note = 'fiscal_credit_note',
  kitchen_ticket = 'kitchen_ticket',
}

export const PRINT_FORMAT_TYPES = Object.values(PrintFormatTypeEnum);
