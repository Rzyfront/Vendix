export interface StandardPrintParty {
  name: string;
  legal_name?: string;
  tax_id?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state_province?: string;
  country?: string;
  tax_regime?: string;
  fiscal_responsibilities?: string[];
  logo_url?: string;
}

export interface StandardPrintItem {
  index: number;
  product_name: string;
  variant_sku?: string;
  variant_attributes?: string;
  quantity: number;
  unit_price: number;
  unit_price_formatted?: string;
  discount_amount?: number;
  discount_formatted?: string;
  tax_rate?: number;
  tax_amount?: number;
  total_price: number;
  total_price_formatted?: string;
  notes?: string;
  modifiers?: string[];
}

export interface StandardPrintTaxRow {
  name: string;
  rate: number;
  base_amount: number;
  tax_amount: number;
  base_formatted?: string;
  tax_formatted?: string;
}

export interface StandardPrintDataModel {
  store: StandardPrintParty;
  organization?: StandardPrintParty;
  customer?: StandardPrintParty;
  supplier?: StandardPrintParty;
  document: {
    id: number | string;
    number: string;
    prefix?: string;
    date: string;
    time?: string;
    date_formatted: string;
    state: string;
    state_label: string;
    channel?: string;
    channel_label?: string;
    notes?: string;
    internal_notes?: string;
    cashier_name?: string;
    pos_terminal?: string;
    payment_method?: string;
    amount_received?: number;
    amount_received_formatted?: string;
    change_due?: number;
    change_due_formatted?: string;
    valid_until?: string;
    valid_until_formatted?: string;
    reference_document_number?: string;
    shipping_carrier?: string;
    shipping_tracking_number?: string;
    origin_location?: string;
    destination_location?: string;
    table_number?: string;
    waiter_name?: string;
    guests_count?: number;
  };
  fiscal?: {
    cufe?: string;
    cude?: string;
    qr_code_content?: string;
    qr_code_png_base64?: string;
    resolution_number?: string;
    resolution_prefix?: string;
    resolution_range_from?: number;
    resolution_range_to?: number;
    resolution_date?: string;
    resolution_valid_from?: string;
    resolution_valid_to?: string;
    technical_key?: string;
    environment?: 'production' | 'test';
  };
  items: StandardPrintItem[];
  taxes: StandardPrintTaxRow[];
  totals: {
    subtotal: number;
    subtotal_formatted: string;
    discount_total: number;
    discount_total_formatted: string;
    shipping_total: number;
    shipping_total_formatted: string;
    tax_total: number;
    tax_total_formatted: string;
    grand_total: number;
    grand_total_formatted: string;
    /**
     * Total en letras — la representación gráfica de un documento fiscal lo
     * imprime al lado del total en cifras.
     *
     * OPCIONAL A PROPÓSITO. Sólo el proveedor de la factura fiscal lo llena; los
     * otros nueve documentos del dominio (tiquete POS, remisión, cotización,
     * ticket de cocina…) no lo exigen, y `print-layout-composer` sólo pinta la
     * fila cuando el campo llega. Así añadir el requisito fiscal no cambia el
     * papel de nueve documentos que este plan no toca.
     *
     * Lo produce `amountToSpanishWords` (`@common/utils/amount-in-words.util`),
     * la única implementación de número a letras del repositorio, alimentada por
     * el MISMO `grand_total` que la fila en cifras.
     */
    grand_total_in_words?: string;
    tip_amount?: number;
    tip_amount_formatted?: string;
  };
  custom_variables?: Record<string, any>;
}
