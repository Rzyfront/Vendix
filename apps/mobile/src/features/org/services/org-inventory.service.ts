import { apiGet, apiPost, apiPut, apiDelete, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  StockLevel,
  InventoryLocation,
  InventoryMovement,
  InventorySupplier,
  StockTransfer,
  StockAdjustment,
  SerialNumber,
  InventoryBatch,
  InventoryStats,
  StockLevelAlert,
} from '@/core/models/org-admin/inventory.types';

export const OrgInventoryService = {
  // Stock levels
  listStockLevels: async (params?: ListParams) =>
    apiGet<StockLevel[]>(Endpoints.ORGANIZATION.INVENTORY.STOCK_LEVELS.LIST, params),
  getStockStats: async () =>
    apiGet<InventoryStats>(Endpoints.ORGANIZATION.INVENTORY.STOCK_LEVELS.STATS),
  getStockAlerts: async () =>
    apiGet<StockLevelAlert[]>(Endpoints.ORGANIZATION.INVENTORY.STOCK_LEVELS.ALERTS),
  getLowStock: async () =>
    apiGet<StockLevelAlert[]>(Endpoints.ORGANIZATION.INVENTORY.STOCK_LEVELS.LOW_STOCK),
  getStockByStore: async (storeId: string) =>
    apiGet<StockLevel[]>(Endpoints.ORGANIZATION.INVENTORY.STOCK_LEVELS.BY_STORE.replace(':storeId', storeId)),
  getStockByProduct: async (productId: string) =>
    apiGet<StockLevel[]>(Endpoints.ORGANIZATION.INVENTORY.STOCK_LEVELS.BY_PRODUCT.replace(':productId', productId)),
  updateStockLevels: async (body: unknown) =>
    apiPut(Endpoints.ORGANIZATION.INVENTORY.STOCK_LEVELS.UPDATE, body),
  // Locations
  listLocations: async (params?: ListParams) =>
    apiGet<InventoryLocation[]>(Endpoints.ORGANIZATION.INVENTORY.LOCATIONS.LIST, params),
  getLocation: async (id: string) =>
    apiGet<InventoryLocation>(Endpoints.ORGANIZATION.INVENTORY.LOCATIONS.GET.replace(':id', id)),
  createLocation: async (body: Partial<InventoryLocation>) =>
    apiPost<InventoryLocation>(Endpoints.ORGANIZATION.INVENTORY.LOCATIONS.CREATE, body),
  updateLocation: async (id: string, body: Partial<InventoryLocation>) =>
    apiPut<InventoryLocation>(Endpoints.ORGANIZATION.INVENTORY.LOCATIONS.UPDATE.replace(':id', id), body),
  deleteLocation: async (id: string) =>
    apiDelete(Endpoints.ORGANIZATION.INVENTORY.LOCATIONS.DELETE.replace(':id', id)),
  ensureCentralWarehouse: async () =>
    apiPost<InventoryLocation>(Endpoints.ORGANIZATION.INVENTORY.LOCATIONS.CENTRAL_WAREHOUSE),
  // Movements
  listMovements: async (params?: ListParams) =>
    apiGet<InventoryMovement[]>(Endpoints.ORGANIZATION.INVENTORY.MOVEMENTS.LIST, params),
  getMovement: async (id: string) =>
    apiGet<InventoryMovement>(Endpoints.ORGANIZATION.INVENTORY.MOVEMENTS.GET.replace(':id', id)),
  getRecentMovements: async () =>
    apiGet<InventoryMovement[]>(Endpoints.ORGANIZATION.INVENTORY.MOVEMENTS.RECENT),
  // Suppliers
  listSuppliers: async (params?: ListParams) =>
    apiGet<InventorySupplier[]>(Endpoints.ORGANIZATION.INVENTORY.SUPPLIERS.LIST, params),
  getSupplier: async (id: string) =>
    apiGet<InventorySupplier>(Endpoints.ORGANIZATION.INVENTORY.SUPPLIERS.GET.replace(':id', id)),
  createSupplier: async (body: Partial<InventorySupplier>) =>
    apiPost<InventorySupplier>(Endpoints.ORGANIZATION.INVENTORY.SUPPLIERS.CREATE, body),
  updateSupplier: async (id: string, body: Partial<InventorySupplier>) =>
    apiPut<InventorySupplier>(Endpoints.ORGANIZATION.INVENTORY.SUPPLIERS.UPDATE.replace(':id', id), body),
  deleteSupplier: async (id: string) =>
    apiDelete(Endpoints.ORGANIZATION.INVENTORY.SUPPLIERS.DELETE.replace(':id', id)),
  // Transfers
  listTransfers: async (params?: ListParams) =>
    apiGet<StockTransfer[]>(Endpoints.ORGANIZATION.INVENTORY.TRANSFERS.LIST, params),
  getTransfer: async (id: string) =>
    apiGet<StockTransfer>(Endpoints.ORGANIZATION.INVENTORY.TRANSFERS.GET.replace(':id', id)),
  createTransfer: async (body: Partial<StockTransfer>) =>
    apiPost<StockTransfer>(Endpoints.ORGANIZATION.INVENTORY.TRANSFERS.CREATE, body),
  dispatchTransfer: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.INVENTORY.TRANSFERS.DISPATCH.replace(':id', id)),
  cancelTransfer: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.INVENTORY.TRANSFERS.CANCEL.replace(':id', id)),
  // Adjustments
  listAdjustments: async (params?: ListParams) =>
    apiGet<StockAdjustment[]>(Endpoints.ORGANIZATION.INVENTORY.ADJUSTMENTS.LIST, params),
  getAdjustment: async (id: string) =>
    apiGet<StockAdjustment>(Endpoints.ORGANIZATION.INVENTORY.ADJUSTMENTS.GET.replace(':id', id)),
  createAdjustment: async (body: Partial<StockAdjustment>) =>
    apiPost<StockAdjustment>(Endpoints.ORGANIZATION.INVENTORY.ADJUSTMENTS.CREATE, body),
  approveAdjustment: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.INVENTORY.ADJUSTMENTS.APPROVE.replace(':id', id)),
  // Serial numbers
  listSerialNumbers: async (params?: ListParams) =>
    apiGet<SerialNumber[]>(Endpoints.ORGANIZATION.INVENTORY.SERIAL_NUMBERS.LIST, params),
  getSerialNumber: async (id: string) =>
    apiGet<SerialNumber>(Endpoints.ORGANIZATION.INVENTORY.SERIAL_NUMBERS.GET.replace(':id', id)),
  createSerialNumber: async (body: Partial<SerialNumber>) =>
    apiPost<SerialNumber>(Endpoints.ORGANIZATION.INVENTORY.SERIAL_NUMBERS.CREATE, body),
  // Batches
  listBatches: async (params?: ListParams) =>
    apiGet<InventoryBatch[]>(Endpoints.ORGANIZATION.INVENTORY.BATCHES.LIST, params),
  getBatch: async (id: string) =>
    apiGet<InventoryBatch>(Endpoints.ORGANIZATION.INVENTORY.BATCHES.GET.replace(':id', id)),
  getExpiringBatches: async () =>
    apiGet<InventoryBatch[]>(Endpoints.ORGANIZATION.INVENTORY.BATCHES.EXPIRING_SOON),
  // Transactions (audit of stock changes)
  listTransactions: async (params?: ListParams) =>
    apiGet<InventoryMovement[]>(Endpoints.ORGANIZATION.INVENTORY.TRANSACTIONS.LIST, params),
};
