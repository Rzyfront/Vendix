export interface SalesStats {
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
}

export interface DailySales {
  date: string;
  sales: number;
  orders: number;
  customers: number;
}

export interface TopProduct {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  revenue: number;
  percentage: number;
}

export interface PaymentMethodStats {
  method: string;
  count: number;
  amount: number;
  percentage: number;
}

export interface HourlySales {
  hour: number;
  sales: number;
  orders: number;
}

export interface CategoryStats {
  category: string;
  sales: number;
  quantity: number;
  percentage: number;
}

export interface DashboardData {
  todayStats: SalesStats;
  weeklyStats: SalesStats;
  monthlyStats: SalesStats;
  dailySales: DailySales[];
  topProducts: TopProduct[];
  paymentMethods: PaymentMethodStats[];
  hourlySales: HourlySales[];
  categoryStats: CategoryStats[];
  lastUpdated: Date;
}

export interface DashboardFilters {
  dateRange: 'today' | 'week' | 'month' | 'year' | 'custom';
  startDate?: Date;
  endDate?: Date;
  storeId?: string;
  cashierId?: string;
}
