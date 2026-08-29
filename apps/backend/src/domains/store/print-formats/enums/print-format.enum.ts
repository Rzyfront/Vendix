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
  // CP-DTLP-20260827 (Phase B.3): 11th format_type. The DB enum accepts this
  // value after migration `20260827120000_add_dispatch_ticket_to_enum` runs;
  // schema.prisma is regenerated separately to keep this branch's diff minimal.
  dispatch_ticket = 'dispatch_ticket',
  // [print-editor-dsk P8] — Lote 12–15: planilla de ruta DSD + tres certificados
  // de retención (practicada, sufrida, laboral). La migración
  // 20260827_add_print_format_enum_values los agrega a Postgres; el cliente
  // @prisma/client se regenera después para tiparlos. Mientras tanto, los
  // providers hacen cast explícito (ver withholding-*.provider.ts).
  dispatch_route = 'dispatch_route',
  withholding_practiced = 'withholding_practiced',
  withholding_suffered = 'withholding_suffered',
  withholding_employee_certificate = 'withholding_employee_certificate',
}

export const PRINT_FORMAT_TYPES = Object.values(PrintFormatTypeEnum);