export enum PrintFormatTypeEnum {
  pos_sale_ticket = 'pos_sale_ticket',
  pos_electronic_invoice = 'pos_electronic_invoice',
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

/**
 * Universo cerrado de `PrintSectionDefinition.type` que
 * `print-layout-composer.service.ts` reconoce en el `switch (section.type)`
 * de `renderSection()`.
 *
 * 16 de estos 21 valores tienen un `case` con renderer dedicado (`header`,
 * `fiscal_header`, `document_info`, `customer_info`, `fiscal_buyer_info`,
 * `parties_info`, `items_table`, `kitchen_items`, `totals_summary`,
 * `fiscal_cufe_box`, `fiscal_tax_breakdown`, `fiscal_qr_section`,
 * `signatures_box`, `footer`, `dispatch_ticket`, `table_info`). Los otros 5
 * (`custom_notes`, `document_reference`, `locations_info`, `shipping_info`,
 * `validity_banner`) también tienen su propio `case`, pero delegan en
 * `renderGenericFieldsSection()` — el mismo renderer genérico que antes
 * atendía el `default`.
 *
 * Los 5 genéricos se nombran EXPLÍCITAMENTE en vez de dejarlos caer al
 * `default` a propósito: un `type` que el compositor ignora en silencio es
 * pérdida de datos, no tolerancia — la plantilla puede declarar campos
 * reales (`fields` con `key`/`label`) y el papel impreso los omitiría sin
 * que nadie lo note. Nombrarlos en el switch documenta el universo real de
 * tipos aunque el cuerpo siga siendo el renderer genérico, y el `default`
 * se conserva como red de seguridad para tipos aún no catalogados.
 *
 * Fuente: introspección de `print_templates.definition->'sections'` en la
 * base de datos de desarrollo (20 `section.type` sembrados; 6 caían al
 * `default` antes de este cierre — uno de ellos, `table_info`, ya había
 * ganado su propio renderer por QUI-733 antes de este cambio).
 *
 * `services/__tests__/section-type-exhaustiveness.spec.ts` afirma que este
 * arreglo coincide EXACTAMENTE con los `case` extraídos por introspección
 * de fuente del compositor — un `case` nuevo sin su entrada aquí (o
 * viceversa) rompe el test.
 */
export enum PrintSectionTypeEnum {
  header = 'header',
  fiscal_header = 'fiscal_header',
  document_info = 'document_info',
  customer_info = 'customer_info',
  fiscal_buyer_info = 'fiscal_buyer_info',
  parties_info = 'parties_info',
  items_table = 'items_table',
  kitchen_items = 'kitchen_items',
  totals_summary = 'totals_summary',
  fiscal_cufe_box = 'fiscal_cufe_box',
  fiscal_tax_breakdown = 'fiscal_tax_breakdown',
  fiscal_qr_section = 'fiscal_qr_section',
  signatures_box = 'signatures_box',
  footer = 'footer',
  dispatch_ticket = 'dispatch_ticket',
  table_info = 'table_info',
  // Genéricos — case explícito delegando en renderGenericFieldsSection().
  custom_notes = 'custom_notes',
  document_reference = 'document_reference',
  locations_info = 'locations_info',
  shipping_info = 'shipping_info',
  validity_banner = 'validity_banner',
}

export const PRINT_SECTION_TYPES = Object.values(PrintSectionTypeEnum);