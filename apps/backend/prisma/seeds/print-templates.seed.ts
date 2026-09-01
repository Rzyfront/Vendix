import { PrismaClient, print_format_type_enum } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface PrintFormatDefinitionSeed {
  paper: {
    format: 'thermal_80' | 'thermal_58' | 'a4' | 'letter' | 'half_letter';
    width_mm: number;
    is_roll: boolean;
    margin_mm: number;
    copies: number;
    orientation?: 'portrait' | 'landscape';
  };
  sections: Array<{
    id: string;
    type: string;
    title: string;
    enabled: boolean;
    order: number;
    fields?: Array<{
      id: string;
      key: string;
      label: string;
      enabled: boolean;
      position?: 'left' | 'center' | 'right' | 'full';
    }>;
  }>;
  columns?: Array<{
    id: string;
    key: string;
    label: string;
    enabled: boolean;
    width_percent: number;
    align: 'left' | 'center' | 'right';
    format?: 'text' | 'number' | 'currency' | 'percent';
  }>;
  styles?: {
    font_family?: string;
    font_size_base_pt?: number;
    primary_color?: string;
    header_alignment?: 'left' | 'center' | 'right';
    show_borders?: boolean;
    compact_mode?: boolean;
  };
  custom_template?: string;
}

export const SYSTEM_PRINT_TEMPLATES: Array<{
  format_type: print_format_type_enum;
  name: string;
  description: string;
  definition: PrintFormatDefinitionSeed;
}> = [
  {
    format_type: 'pos_sale_ticket',
    name: 'Ticket de Venta POS Estándar (80mm)',
    description: 'Plantilla térmica optimizada para recibos de caja en rollos de 80mm',
    definition: {
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        margin_mm: 0,
        copies: 1,
      },
      styles: {
        font_family: "'Courier New', Courier, monospace",
        font_size_base_pt: 9,
        primary_color: '#000000',
        header_alignment: 'center',
        compact_mode: true,
      },
      sections: [
        {
          id: 'sec_header',
          type: 'header',
          title: 'Encabezado',
          enabled: true,
          order: 1,
          fields: [
            { id: 'f_logo', key: 'store.logo_url', label: 'Logo', enabled: true, position: 'center' },
            { id: 'f_name', key: 'store.name', label: 'Nombre Comercial', enabled: true, position: 'center' },
            { id: 'f_legal', key: 'store.legal_name', label: 'Razón Social', enabled: true, position: 'center' },
            { id: 'f_nit', key: 'store.tax_id', label: 'NIT / RUT', enabled: true, position: 'center' },
            { id: 'f_addr', key: 'store.address', label: 'Dirección', enabled: true, position: 'center' },
            { id: 'f_phone', key: 'store.phone', label: 'Teléfono', enabled: true, position: 'center' },
          ],
        },
        {
          id: 'sec_doc_info',
          type: 'document_info',
          title: 'Datos del Ticket',
          enabled: true,
          order: 2,
          fields: [
            { id: 'f_num', key: 'order.order_number', label: 'Ticket #', enabled: true, position: 'left' },
            { id: 'f_date', key: 'order.created_at', label: 'Fecha y Hora', enabled: true, position: 'left' },
            { id: 'f_cashier', key: 'order.cashier_name', label: 'Cajero', enabled: true, position: 'left' },
            { id: 'f_terminal', key: 'order.pos_terminal', label: 'Caja / Terminal', enabled: true, position: 'right' },
          ],
        },
        {
          id: 'sec_customer',
          type: 'customer_info',
          title: 'Datos del Cliente',
          enabled: true,
          order: 3,
          fields: [
            { id: 'f_cname', key: 'customer.name', label: 'Cliente', enabled: true, position: 'left' },
            { id: 'f_cnit', key: 'customer.tax_id', label: 'NIT / CC', enabled: true, position: 'left' },
          ],
        },
        {
          id: 'sec_items',
          type: 'items_table',
          title: 'Detalle de Productos',
          enabled: true,
          order: 4,
        },
        {
          id: 'sec_totals',
          type: 'totals_summary',
          title: 'Totales y Medios de Pago',
          enabled: true,
          order: 5,
          fields: [
            { id: 'f_sub', key: 'order.subtotal_amount', label: 'Subtotal', enabled: true, position: 'right' },
            { id: 'f_disc', key: 'order.discount_amount', label: 'Descuento', enabled: true, position: 'right' },
            { id: 'f_tax', key: 'order.tax_amount', label: 'Impuestos', enabled: true, position: 'right' },
            { id: 'f_tot', key: 'order.grand_total', label: 'TOTAL A PAGAR', enabled: true, position: 'right' },
            { id: 'f_paym', key: 'order.payment_method', label: 'Método de Pago', enabled: true, position: 'right' },
            { id: 'f_recv', key: 'order.amount_received', label: 'Efectivo Recibido', enabled: true, position: 'right' },
            { id: 'f_chg', key: 'order.change_due', label: 'Cambio / Vuelto', enabled: true, position: 'right' },
          ],
        },
        {
          id: 'sec_footer',
          type: 'footer',
          title: 'Pie de Ticket',
          enabled: true,
          order: 6,
          fields: [
            { id: 'f_msg', key: 'receipts.receipt_footer', label: 'Mensaje de Despedida', enabled: true, position: 'center' },
            { id: 'f_powered', key: 'system.powered_by', label: 'Firma del Sistema', enabled: true, position: 'center' },
          ],
        },
      ],
      columns: [
        { id: 'col_desc', key: 'product_name', label: 'Descripción', enabled: true, width_percent: 50, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 15, align: 'center', format: 'number' },
        { id: 'col_price', key: 'unit_price', label: 'Precio', enabled: true, width_percent: 15, align: 'right', format: 'currency' },
        { id: 'col_tot', key: 'total_price', label: 'Total', enabled: true, width_percent: 20, align: 'right', format: 'currency' },
      ],
    },
  },
  {
    format_type: 'pos_electronic_invoice',
    name: 'Tiquete Factura Electrónica POS Térmica (80mm)',
    description: 'Tirilla física para caja POS con CUFE, código QR oficial de la DIAN, resolución e impuestos',
    definition: {
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        margin_mm: 0,
        copies: 1,
      },
      styles: {
        font_family: "'Courier New', Courier, monospace",
        font_size_base_pt: 8.5,
        primary_color: '#000000',
        header_alignment: 'center',
        compact_mode: true,
      },
      sections: [
        { id: 'sec_dian_header', type: 'fiscal_header', title: 'Cabecera Fiscal Emisor y Resolución', enabled: true, order: 1 },
        { id: 'sec_doc_info', type: 'document_info', title: 'Datos de la Venta', enabled: true, order: 2 },
        { id: 'sec_dian_buyer', type: 'fiscal_buyer_info', title: 'Datos del Adquirente', enabled: true, order: 3 },
        { id: 'sec_items', type: 'items_table', title: 'Detalle de Bienes / Servicios', enabled: true, order: 4 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Liquidación Total', enabled: true, order: 5 },
        { id: 'sec_dian_taxes', type: 'fiscal_tax_breakdown', title: 'Discriminación de Impuestos (IVA/INC)', enabled: true, order: 6 },
        { id: 'sec_dian_cufe', type: 'fiscal_cufe_box', title: 'CUFE y Validación DIAN', enabled: true, order: 7 },
        { id: 'sec_dian_qr', type: 'fiscal_qr_section', title: 'Código QR DIAN y Software Proveedor', enabled: true, order: 8 },
        { id: 'sec_footer', type: 'footer', title: 'Pie del Tiquete', enabled: true, order: 9 },
      ],
      columns: [
        { id: 'col_desc', key: 'product_name', label: 'Descripción', enabled: true, width_percent: 50, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 15, align: 'center', format: 'number' },
        { id: 'col_tot', key: 'total_price', label: 'Total', enabled: true, width_percent: 35, align: 'right', format: 'currency' },
      ],
    },
  },
  {
    format_type: 'sales_order_invoice',
    name: 'Factura de Venta / Orden Carta Estándar',
    description: 'Plantilla formal de orden y factura comercial en formato Carta / A4',
    definition: {
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 15,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        font_size_base_pt: 10,
        primary_color: '#4f46e5',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Cabecera Corporativa', enabled: true, order: 1 },
        { id: 'sec_parties', type: 'parties_info', title: 'Emisor y Cliente', enabled: true, order: 2 },
        { id: 'sec_items', type: 'items_table', title: 'Detalle de Ítems', enabled: true, order: 3 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Liquidación y Totales', enabled: true, order: 4 },
        { id: 'sec_notes', type: 'custom_notes', title: 'Términos y Notas', enabled: true, order: 5 },
        { id: 'sec_footer', type: 'footer', title: 'Pie de Página', enabled: true, order: 6 },
      ],
      columns: [
        { id: 'col_num', key: 'index', label: '#', enabled: true, width_percent: 5, align: 'center', format: 'number' },
        { id: 'col_sku', key: 'variant_sku', label: 'SKU / Código', enabled: true, width_percent: 15, align: 'left', format: 'text' },
        { id: 'col_desc', key: 'product_name', label: 'Descripción del Producto', enabled: true, width_percent: 40, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 10, align: 'center', format: 'number' },
        { id: 'col_price', key: 'unit_price', label: 'Precio Unitario', enabled: true, width_percent: 15, align: 'right', format: 'currency' },
        { id: 'col_tot', key: 'total_price', label: 'Total', enabled: true, width_percent: 15, align: 'right', format: 'currency' },
      ],
    },
  },
  {
    format_type: 'dispatch_note',
    name: 'Remisión y Guía de Despacho A4',
    description: 'Documento logístico de entrega con transportadora, firmas y control de bultos',
    definition: {
      paper: {
        format: 'a4',
        width_mm: 210,
        is_roll: false,
        margin_mm: 15,
        copies: 2,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Helvetica Neue', Arial, sans-serif",
        font_size_base_pt: 9.5,
        primary_color: '#0f766e',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Cabecera Logística', enabled: true, order: 1 },
        { id: 'sec_shipping', type: 'shipping_info', title: 'Datos de Envío y Destino', enabled: true, order: 2 },
        { id: 'sec_items', type: 'items_table', title: 'Ítems Despachados', enabled: true, order: 3 },
        { id: 'sec_signatures', type: 'signatures_box', title: 'Firmas de Entrega y Recibido', enabled: true, order: 4 },
      ],
      columns: [
        { id: 'col_idx', key: 'index', label: '#', enabled: true, width_percent: 8, align: 'center', format: 'number' },
        { id: 'col_sku', key: 'variant_sku', label: 'Código / SKU', enabled: true, width_percent: 22, align: 'left', format: 'text' },
        { id: 'col_desc', key: 'product_name', label: 'Producto / Descripción', enabled: true, width_percent: 50, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant. Despachada', enabled: true, width_percent: 20, align: 'center', format: 'number' },
      ],
    },
  },
  {
    format_type: 'quotation',
    name: 'Cotización Comercial Carta',
    description: 'Propuesta comercial con vigencia, condiciones de pago y presentación corporativa',
    definition: {
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 18,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        font_size_base_pt: 10,
        primary_color: '#2563eb',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Comercial', enabled: true, order: 1 },
        { id: 'sec_parties', type: 'parties_info', title: 'Datos de la Empresa y Prospecto', enabled: true, order: 2 },
        { id: 'sec_validity', type: 'validity_banner', title: 'Vigencia de la Oferta', enabled: true, order: 3 },
        { id: 'sec_items', type: 'items_table', title: 'Productos / Servicios Cotizados', enabled: true, order: 4 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Resumen Financiero', enabled: true, order: 5 },
        { id: 'sec_terms', type: 'custom_notes', title: 'Términos y Condiciones', enabled: true, order: 6 },
      ],
      columns: [
        { id: 'col_idx', key: 'index', label: '#', enabled: true, width_percent: 5, align: 'center', format: 'number' },
        { id: 'col_desc', key: 'product_name', label: 'Concepto / Producto', enabled: true, width_percent: 45, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 10, align: 'center', format: 'number' },
        { id: 'col_price', key: 'unit_price', label: 'Precio Unitario', enabled: true, width_percent: 20, align: 'right', format: 'currency' },
        { id: 'col_tot', key: 'total_price', label: 'Subtotal', enabled: true, width_percent: 20, align: 'right', format: 'currency' },
      ],
    },
  },
  {
    format_type: 'credit_note',
    name: 'Nota Crédito Comercial A4',
    description: 'Documento de ajuste contable o devolución sobre órdenes previas',
    definition: {
      paper: {
        format: 'a4',
        width_mm: 210,
        is_roll: false,
        margin_mm: 15,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Helvetica Neue', Arial, sans-serif",
        font_size_base_pt: 10,
        primary_color: '#dc2626',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Nota Crédito', enabled: true, order: 1 },
        { id: 'sec_ref', type: 'document_reference', title: 'Referencia a Factura/Orden Afectada', enabled: true, order: 2 },
        { id: 'sec_items', type: 'items_table', title: 'Ítems Afectados / Devueltos', enabled: true, order: 3 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Monto Total Acreditado', enabled: true, order: 4 },
      ],
      columns: [
        { id: 'col_desc', key: 'product_name', label: 'Concepto / Ítem', enabled: true, width_percent: 50, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 15, align: 'center', format: 'number' },
        { id: 'col_val', key: 'unit_price', label: 'Valor Devuelto', enabled: true, width_percent: 35, align: 'right', format: 'currency' },
      ],
    },
  },
  {
    format_type: 'purchase_order',
    name: 'Orden de Compra a Proveedor A4',
    description: 'Documento formal de aprovisionamiento emitido hacia proveedores',
    definition: {
      paper: {
        format: 'a4',
        width_mm: 210,
        is_roll: false,
        margin_mm: 15,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        font_size_base_pt: 9.5,
        primary_color: '#1e293b',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Cabecera Orden de Compra', enabled: true, order: 1 },
        { id: 'sec_supplier', type: 'parties_info', title: 'Datos del Proveedor y Entrega', enabled: true, order: 2 },
        { id: 'sec_items', type: 'items_table', title: 'Líneas de Compra Solicitadas', enabled: true, order: 3 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Total Compra Estimado', enabled: true, order: 4 },
      ],
      columns: [
        { id: 'col_sku', key: 'variant_sku', label: 'Código / SKU', enabled: true, width_percent: 20, align: 'left', format: 'text' },
        { id: 'col_name', key: 'product_name', label: 'Producto / Descripción', enabled: true, width_percent: 45, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant. Pedida', enabled: true, width_percent: 15, align: 'center', format: 'number' },
        { id: 'col_cost', key: 'unit_price', label: 'Costo Unitario', enabled: true, width_percent: 20, align: 'right', format: 'currency' },
      ],
    },
  },
  {
    format_type: 'transfer_note',
    name: 'Nota de Traslado de Inventario A4',
    description: 'Guía de movimiento entre bodegas o tiendas del mismo negocio',
    definition: {
      paper: {
        format: 'a4',
        width_mm: 210,
        is_roll: false,
        margin_mm: 15,
        copies: 2,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Helvetica Neue', Arial, sans-serif",
        font_size_base_pt: 9.5,
        primary_color: '#d97706',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado de Traslado', enabled: true, order: 1 },
        { id: 'sec_locs', type: 'locations_info', title: 'Origen y Destino', enabled: true, order: 2 },
        { id: 'sec_items', type: 'items_table', title: 'Ítems Transferidos', enabled: true, order: 3 },
        { id: 'sec_signatures', type: 'signatures_box', title: 'Firmas de Despacho y Recepción', enabled: true, order: 4 },
      ],
      columns: [
        { id: 'col_sku', key: 'variant_sku', label: 'SKU', enabled: true, width_percent: 20, align: 'left', format: 'text' },
        { id: 'col_name', key: 'product_name', label: 'Producto', enabled: true, width_percent: 60, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant. Movida', enabled: true, width_percent: 20, align: 'center', format: 'number' },
      ],
    },
  },
  {
    format_type: 'fiscal_electronic_invoice',
    name: 'Factura Electrónica DIAN Carta Oficial',
    description: 'Representación gráfica oficial con CUFE, código QR y resolución DIAN (Anexo 1.9)',
    definition: {
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 12,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Segoe UI', Arial, sans-serif",
        font_size_base_pt: 9,
        primary_color: '#1e3a8a',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_dian_header', type: 'fiscal_header', title: 'Cabecera Fiscal Emisor y Resolución', enabled: true, order: 1 },
        { id: 'sec_dian_cufe', type: 'fiscal_cufe_box', title: 'CUFE y Validación DIAN', enabled: true, order: 2 },
        { id: 'sec_dian_buyer', type: 'fiscal_buyer_info', title: 'Datos del Adquirente', enabled: true, order: 3 },
        { id: 'sec_items', type: 'items_table', title: 'Detalle de Bienes / Servicios', enabled: true, order: 4 },
        { id: 'sec_dian_taxes', type: 'fiscal_tax_breakdown', title: 'Discriminación de Impuestos (IVA/INC)', enabled: true, order: 5 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Liquidación Total', enabled: true, order: 6 },
        { id: 'sec_dian_qr', type: 'fiscal_qr_section', title: 'Código QR DIAN y Software Proveedor', enabled: true, order: 7 },
      ],
      columns: [
        { id: 'col_sku', key: 'variant_sku', label: 'Código', enabled: true, width_percent: 12, align: 'left', format: 'text' },
        { id: 'col_desc', key: 'product_name', label: 'Descripción / Servicio', enabled: true, width_percent: 38, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 8, align: 'center', format: 'number' },
        { id: 'col_unit', key: 'unit_price', label: 'Valor Unit.', enabled: true, width_percent: 14, align: 'right', format: 'currency' },
        { id: 'col_tax_rate', key: 'tax_rate', label: '% IVA', enabled: true, width_percent: 10, align: 'center', format: 'percent' },
        { id: 'col_tot', key: 'total_price', label: 'Total Línea', enabled: true, width_percent: 18, align: 'right', format: 'currency' },
      ],
    },
  },
  {
    format_type: 'fiscal_credit_note',
    name: 'Nota Crédito Electrónica DIAN Carta Oficial',
    description: 'Representación gráfica oficial de nota crédito electrónica con CUDE y QR DIAN',
    definition: {
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 12,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Segoe UI', Arial, sans-serif",
        font_size_base_pt: 9,
        primary_color: '#991b1b',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_dian_header', type: 'fiscal_header', title: 'Cabecera Fiscal Emisor', enabled: true, order: 1 },
        { id: 'sec_dian_cude', type: 'fiscal_cufe_box', title: 'CUDE y Factura Afectada', enabled: true, order: 2 },
        { id: 'sec_dian_buyer', type: 'fiscal_buyer_info', title: 'Datos del Adquirente', enabled: true, order: 3 },
        { id: 'sec_items', type: 'items_table', title: 'Líneas Afectadas', enabled: true, order: 4 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Totales Ajustados', enabled: true, order: 5 },
        { id: 'sec_dian_qr', type: 'fiscal_qr_section', title: 'Código QR DIAN', enabled: true, order: 6 },
      ],
      columns: [
        { id: 'col_desc', key: 'product_name', label: 'Concepto / Ítem', enabled: true, width_percent: 50, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 15, align: 'center', format: 'number' },
        { id: 'col_val', key: 'total_price', label: 'Total Afectado', enabled: true, width_percent: 35, align: 'right', format: 'currency' },
      ],
    },
  },
  {
    format_type: 'kitchen_ticket',
    name: 'Comanda de Cocina Térmica (80mm KDS)',
    description: 'Ticket para cocina/bar con modificadores, notas de preparación y mesa',
    definition: {
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        margin_mm: 0,
        copies: 1,
      },
      styles: {
        font_family: "'Courier New', Courier, monospace",
        font_size_base_pt: 11,
        primary_color: '#000000',
        header_alignment: 'center',
        compact_mode: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Comanda', enabled: true, order: 1 },
        { id: 'sec_table_info', type: 'table_info', title: 'Mesa, Mesero y Turno', enabled: true, order: 2 },
        { id: 'sec_items', type: 'kitchen_items', title: 'Platos y Modificadores', enabled: true, order: 3 },
        { id: 'sec_notes', type: 'custom_notes', title: 'Observaciones de Cocina', enabled: true, order: 4 },
      ],
      columns: [
        { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 25, align: 'center', format: 'number' },
        { id: 'col_desc', key: 'product_name', label: 'Plato / Preparación', enabled: true, width_percent: 75, align: 'left', format: 'text' },
      ],
    },
  },
  // CP-DTLP-20260827 (Phase B.2) — Tiquete de Despacho. Logística térmica 80mm
  // courier mono 9pt; cliente, dirección, productos por línea con cantidades
  // pedida/despachada. Sin totales fiscales, sin QR, sin firma (la firma de
  // recibido se reserva al despacho remisión que ya existe). ADR-1 Enlace
  // Universal: este es el undécimo formato del Hub enriquecido y debe reusar
  // el mismo motor HTML que el resto.
  // El cast es necesario porque schema.prisma todavía no lista
  // `dispatch_ticket`; el valor entra a Postgres con la migración
  // 20260827120000_add_dispatch_ticket_to_enum y `prisma generate` lo
  // materializará en @prisma/client más adelante.
  {
    format_type: 'dispatch_ticket' as unknown as print_format_type_enum,
    name: 'Tiquete de Despacho Térmico (80mm)',
    description: 'Ticket logístico con cliente, dirección y cantidades pedida/despachada por línea; rollo 80mm courier mono',
    definition: {
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        margin_mm: 0,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Courier New', Courier, monospace",
        font_size_base_pt: 9,
        primary_color: '#000000',
        header_alignment: 'center',
        show_borders: true,
        compact_mode: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Despacho', enabled: true, order: 1 },
        { id: 'sec_doc_info', type: 'document_info', title: 'Datos de la Orden', enabled: true, order: 2 },
        { id: 'sec_customer', type: 'customer_info', title: 'Cliente y Dirección de Entrega', enabled: true, order: 3 },
        { id: 'sec_items', type: 'items_table', title: 'Productos a Despachar', enabled: true, order: 4 },
        { id: 'sec_footer', type: 'footer', title: 'Despachado por', enabled: true, order: 5 },
      ],
      columns: [
        // [print-editor-dsk P1.5] Las claves deben coincidir con los campos del
        // StandardPrintItem que `dispatch-ticket.provider.ts` rellena:
        //   - `variant_sku` (no `sku` — el compositor despacha items[].variant_sku)
        //   - `quantity`   (cant. pedida — items[].quantity, ya rellenado por el provider)
        //   - `dispatched_qty` (cant. despachada — items[].dispatched_qty, directo)
        // Antes P1.5 estas claves leían undefined y la tabla salía vacía.
        { id: 'col_idx', key: 'index', label: '#', enabled: true, width_percent: 8, align: 'center', format: 'number' },
        { id: 'col_sku', key: 'variant_sku', label: 'SKU / Código', enabled: true, width_percent: 30, align: 'left', format: 'text' },
        { id: 'col_desc', key: 'product_name', label: 'Descripción', enabled: true, width_percent: 32, align: 'left', format: 'text' },
        { id: 'col_qty', key: 'quantity', label: 'Cant. Pedida', enabled: true, width_percent: 15, align: 'center', format: 'number' },
        { id: 'col_disp', key: 'dispatched_qty', label: 'Cant. Despachada', enabled: true, width_percent: 15, align: 'center', format: 'number' },
      ],
    },
  },
  // [print-editor-dsk P8] — Plantilla del lote 12: planilla de ruta DSD.
  // Carta vertical, 1 copia, secciones para vehículo, conductor, transportista
  // externo (si lo hay) y la secuencia de paradas. Las paradas se pintan en
  // el cuerpo desde `custom_variables.stops[]` (NO desde `items[]`, porque
  // una planilla no factura productos — factura paradas).
  {
    format_type: 'dispatch_route' as unknown as print_format_type_enum,
    name: 'Planilla de Ruta DSD Carta',
    description: 'Documento operativo de ruta de despacho DSD con vehículo, conductor, transportista y secuencia de paradas',
    definition: {
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 15,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Helvetica Neue', Arial, sans-serif",
        font_size_base_pt: 10,
        primary_color: '#0f766e',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Planilla', enabled: true, order: 1 },
        { id: 'sec_route_meta', type: 'document_info', title: 'Datos de la Ruta', enabled: true, order: 2 },
        { id: 'sec_vehicle', type: 'custom_notes', title: 'Vehículo y Conductor', enabled: true, order: 3 },
        { id: 'sec_stops', type: 'items_table', title: 'Paradas', enabled: true, order: 4 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Recaudo Total', enabled: true, order: 5 },
        { id: 'sec_signatures', type: 'signatures_box', title: 'Firmas', enabled: true, order: 6 },
      ],
      columns: [
        { id: 'col_seq', key: 'sequence', label: '#', enabled: true, width_percent: 8, align: 'center', format: 'number' },
        { id: 'col_dnum', key: 'dispatch_number', label: 'Remisión', enabled: true, width_percent: 22, align: 'left', format: 'text' },
        { id: 'col_cust', key: 'customer', label: 'Cliente', enabled: true, width_percent: 30, align: 'left', format: 'text' },
        { id: 'col_addr', key: 'address', label: 'Dirección', enabled: true, width_percent: 30, align: 'left', format: 'text' },
        { id: 'col_status', key: 'status', label: 'Estado', enabled: true, width_percent: 10, align: 'center', format: 'text' },
      ],
    },
  },
  // [print-editor-dsk P8] — Lote 13: certificado de retención practicada.
  {
    format_type: 'withholding_practiced' as unknown as print_format_type_enum,
    name: 'Certificado de Retención Practicada Carta',
    description: 'Comprobante de retención en la fuente que la empresa practica a un tercero',
    definition: {
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 15,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Helvetica Neue', Arial, sans-serif",
        font_size_base_pt: 10,
        primary_color: '#1e3a8a',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Certificado', enabled: true, order: 1 },
        { id: 'sec_counterparty', type: 'parties_info', title: 'Tercero Retenido', enabled: true, order: 2 },
        { id: 'sec_concept', type: 'custom_notes', title: 'Concepto y Base', enabled: true, order: 3 },
        { id: 'sec_tax', type: 'fiscal_tax_breakdown', title: 'Detalle de Retención', enabled: true, order: 4 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Valor Retenido', enabled: true, order: 5 },
      ],
      columns: [
        { id: 'col_concept', key: 'name', label: 'Concepto', enabled: true, width_percent: 60, align: 'left', format: 'text' },
        { id: 'col_rate', key: 'rate', label: 'Tarifa %', enabled: true, width_percent: 15, align: 'center', format: 'percent' },
        { id: 'col_base', key: 'base_amount', label: 'Base', enabled: true, width_percent: 25, align: 'right', format: 'currency' },
      ],
    },
  },
  // [print-editor-dsk P8] — Lote 14: certificado de retención sufrida.
  {
    format_type: 'withholding_suffered' as unknown as print_format_type_enum,
    name: 'Certificado de Retención Sufrida Carta',
    description: 'Comprobante de retención en la fuente que un tercero practicó a la empresa',
    definition: {
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 15,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Helvetica Neue', Arial, sans-serif",
        font_size_base_pt: 10,
        primary_color: '#7c2d12',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Certificado', enabled: true, order: 1 },
        { id: 'sec_counterparty', type: 'parties_info', title: 'Tercero que Retuvo', enabled: true, order: 2 },
        { id: 'sec_concept', type: 'custom_notes', title: 'Concepto y Base', enabled: true, order: 3 },
        { id: 'sec_tax', type: 'fiscal_tax_breakdown', title: 'Detalle de Retención', enabled: true, order: 4 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Valor Sufrido', enabled: true, order: 5 },
      ],
      columns: [
        { id: 'col_concept', key: 'name', label: 'Concepto', enabled: true, width_percent: 60, align: 'left', format: 'text' },
        { id: 'col_rate', key: 'rate', label: 'Tarifa %', enabled: true, width_percent: 15, align: 'center', format: 'percent' },
        { id: 'col_base', key: 'base_amount', label: 'Base', enabled: true, width_percent: 25, align: 'right', format: 'currency' },
      ],
    },
  },
  // [print-editor-dsk P8] — Lote 15: certificado laboral al empleado.
  {
    format_type: 'withholding_employee_certificate' as unknown as print_format_type_enum,
    name: 'Certificado Laboral de Retención al Empleado',
    description: 'Comprobante anual de retención en la fuente sobre ingresos laborales',
    definition: {
      paper: {
        format: 'letter',
        width_mm: 216,
        is_roll: false,
        margin_mm: 15,
        copies: 1,
        orientation: 'portrait',
      },
      styles: {
        font_family: "'Helvetica Neue', Arial, sans-serif",
        font_size_base_pt: 10,
        primary_color: '#365314',
        header_alignment: 'left',
        show_borders: true,
      },
      sections: [
        { id: 'sec_header', type: 'header', title: 'Encabezado Certificado Laboral', enabled: true, order: 1 },
        { id: 'sec_employee', type: 'parties_info', title: 'Datos del Empleado', enabled: true, order: 2 },
        { id: 'sec_period', type: 'custom_notes', title: 'Periodo Gravable', enabled: true, order: 3 },
        { id: 'sec_tax', type: 'fiscal_tax_breakdown', title: 'Detalle de Retención', enabled: true, order: 4 },
        { id: 'sec_totals', type: 'totals_summary', title: 'Total Retenido al Empleado', enabled: true, order: 5 },
      ],
      columns: [
        { id: 'col_concept', key: 'name', label: 'Concepto', enabled: true, width_percent: 60, align: 'left', format: 'text' },
        { id: 'col_rate', key: 'rate', label: 'Tarifa %', enabled: true, width_percent: 15, align: 'center', format: 'percent' },
        { id: 'col_base', key: 'base_amount', label: 'Base', enabled: true, width_percent: 25, align: 'right', format: 'currency' },
      ],
    },
  },
];

export async function seedPrintTemplates(prisma?: PrismaClient) {
  const client = prisma || getPrismaClient();
  console.log('🌱 Seeding master system print templates (Hub de Formatos)...');

  for (const tpl of SYSTEM_PRINT_TEMPLATES) {
    const existing = await client.print_templates.findFirst({
      where: {
        is_system: true,
        format_type: tpl.format_type,
      },
    });

    if (existing) {
      await client.print_templates.update({
        where: { id: existing.id },
        data: {
          name: tpl.name,
          description: tpl.description,
          definition: tpl.definition as any,
          is_shared: false,
          updated_at: new Date(),
        },
      });
    } else {
      await client.print_templates.create({
        data: {
          format_type: tpl.format_type,
          name: tpl.name,
          description: tpl.description,
          definition: tpl.definition as any,
          is_system: true,
          is_shared: false,
          organization_id: null,
          created_by: null,
        },
      });
    }
  }

  console.log(`✅ ${SYSTEM_PRINT_TEMPLATES.length} master system print templates seeded successfully.`);
}
