export { AIToolRegistry } from './ai-tool-registry';

// Every family is a factory now: tools are registered by the domain module
// that owns their services, so the arrays cannot be built at import time.
export { createSalesTools } from './domains/sales.tools';
export { createOrdersTools } from './domains/orders.tools';
export { createInventoryTools } from './domains/inventory.tools';
export { createAccountingTools } from './domains/accounting.tools';
export { createCustomerTools } from './domains/customers.tools';
export { createProductTools } from './domains/products.tools';
export { createSearchTools } from './domains/search.tools';
export { createBusinessTools } from './domains/business.tools';
export { createApiBridgeTools } from './bridge/api-bridge.tools';
export { ApiCatalogService } from './bridge/api-catalog.service';

// Las SEIS escrituras curadas. Van repartidas en cuatro fábricas —una por
// dominio dueño de los servicios— para que ningún módulo tenga que importar
// otro solo para registrar una herramienta. Ver el docblock de writes.tools.ts.
export {
  createInventoryWriteTools,
  createProductWriteTools,
  createCustomerWriteTools,
  createOrderWriteTools,
} from './domains/writes.tools';
export type {
  InventoryWriteToolDeps,
  ProductWriteToolDeps,
  CustomerWriteToolDeps,
  OrderWriteToolDeps,
} from './domains/writes.tools';

// Declaration-only: dispatched by the browser, never executed server-side.
export { uiTools } from './domains/ui.tools';

export * from './interfaces/tool.interface';
