export interface DispatchTicketItem {
  sku: string;
  productName: string;
  orderedQty: number;
  dispatchedQty: number;
}

export interface DispatchTicketCustomer {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city?: string;
}

export interface DispatchTicketData {
  orderId: number | string;
  orderNumber: string;
  dateFormatted: string;
  storeName: string;
  customer: DispatchTicketCustomer;
  items: DispatchTicketItem[];
  /** Domiciliario de la entrega rápida (última remisión no anulada). Ausente = sin línea. */
  courierName?: string;
}
