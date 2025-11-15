export interface TicketItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount?: number;
  tax?: number;
}

export interface TicketData {
  id: string;
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
  };
  store?: {
    name: string;
    address: string;
    phone: string;
    email: string;
    taxId: string;
  };
  cashier?: string;
  transactionId?: string;
}

export interface PrinterConfig {
  name: string;
  type: 'thermal' | 'standard' | 'pdf';
  paperWidth: number;
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
