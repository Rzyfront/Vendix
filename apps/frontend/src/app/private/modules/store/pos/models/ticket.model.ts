import { PrintFormat } from '../../../../../core/models/store-settings.interface';

export interface TicketItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount?: number;
  tax?: number;
  appliedPriceTierName?: string | null;
  isPackageUnit?: boolean;
  unitsPerPackage?: number | null;
  /**
   * QUI-648 — el tiquete muestra la MISMA escala que el cajero capturó: "3 m",
   * no "3000". La conversión a milímetros o gramos es interna y no aparece en
   * ningún papel que vea el cliente. Ausentes = línea por pieza (lo histórico).
   */
  saleUnitCode?: string | null;
  saleQuantity?: number | null;
  serials?: string[];
  /**
   * QUI-653 — la línea se empaca y el cliente se la lleva, aunque pertenezca al
   * pedido de una mesa. El tiquete la marca porque es lo que el cliente revisa
   * al pagar y lo que el mesero usa para saber qué entregar empacado.
   *
   * Opcional: un tiquete de venta retail normal no lleva esta dimensión, y
   * `undefined` se comporta como "consumo en el lugar".
   */
  isTakeaway?: boolean;
}

export interface TicketData {
  id: string;
  orderId?: number;
  date: Date;
  items: TicketItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  cashReceived?: number;
  change?: number;
  customer?: {
    name: string;
    email?: string;
    phone?: string;
    taxId?: string;
    /**
     * Optional delivery address line for orders that ship/deliver. Built from
     * the order's shipping address. Omitted for counter POS sales (no address).
     */
    shippingAddress?: string;
  };
  store?: {
    name: string;
    address: string;
    phone: string;
    email: string;
    taxId: string;
    id: number;
    logo?: string;
  };
  organization?: {
    name: string;
    taxId: string;
  };
  cashier?: string;
  transactionId?: string;
  invoiceDataToken?: string;
  invoiceDataQrUrl?: string;
  /**
   * Set when the sale already produced a validated electronic invoice. Turns the
   * ticket into an informative copy: it points at the invoice instead of
   * repeating its tax breakdown, and the footer stops claiming the document is
   * not DIAN-validated.
   */
  electronicInvoice?: {
    number: string;
    cufe?: string;
  };
}

export interface PrinterConfig {
  name: string;
  type: 'thermal' | 'standard' | 'pdf';
  paperWidth: number;
  /**
   * Configured paper format (`store_settings.receipts.pos_ticket_format`).
   * `paperWidth` is derived from it; kept because the `@page size` rule needs
   * the format, not just the width.
   */
  format?: PrintFormat;
  copies: number;
  autoPrint: boolean;
  printHeader: boolean;
  printFooter: boolean;
  printBarcode: boolean;
}

export interface PrintOptions {
  printer?: string;
  copies?: number;
  openCashDrawer?: boolean;
  printReceipt?: boolean;
  emailReceipt?: boolean;
  smsReceipt?: boolean;
}
