import { apiClient } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type { ApiResponse, PaginatedResponse } from '../types';
import type {
  Expense,
  ExpenseCategory,
  ExpenseStats,
  CreateExpenseDto,
  RawExpense,
  RawExpenseStats,
  RawExpenseCategory,
} from '../types/expense.types';

function unwrap<T>(response: { data: T | ApiResponse<T> }): T {
  const d = response.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** Convierte un amount de Prisma (string o number) a number seguro. */
function toNumber(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  if (typeof amount === 'number') return amount;
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Mapea una fila cruda del backend al shape que la UI espera. */
export function mapExpense(raw: RawExpense | null | undefined): Expense | null {
  if (!raw) return null;
  const categoryId = raw.category_id ?? raw.expense_categories?.id;
  return {
    id: String(raw.id),
    description: raw.description,
    amount: toNumber(raw.amount),
    date: raw.expense_date,
    state: raw.state,
    notes: raw.notes ?? undefined,
    created_at: raw.created_at,
    category_id: categoryId !== undefined && categoryId !== null ? String(categoryId) : undefined,
    category_name: raw.expense_categories?.name,
  };
}

/** Mapea el summary de backend al `ExpenseStats` consumido por la UI. */
export function mapExpenseStats(raw: RawExpenseStats | null | undefined): ExpenseStats {
  if (!raw) {
    return { total: 0, totalAmount: 0, pending: 0, approved: 0, paid: 0 };
  }
  const counts = raw.counts_by_state ?? {};
  return {
    total: raw.total_count ?? 0,
    totalAmount: toNumber(raw.total_amount),
    pending: counts.pending ?? 0,
    approved: counts.approved ?? 0,
    paid: counts.paid ?? 0,
  };
}

export function mapExpenseCategory(raw: RawExpenseCategory): ExpenseCategory {
  return {
    id: String(raw.id),
    name: raw.name,
    description: raw.description ?? undefined,
  };
}

/**
 * Convierte el DTO que arma la UI (con `date` y `category_id` string opcional)
 * al payload que espera el backend (`expense_date` + `category_id` numérico).
 */
export function buildCreateExpensePayload(
  dto: CreateExpenseDto,
): { description: string; amount: number; expense_date: string; category_id?: number; notes?: string } {
  const payload: {
    description: string;
    amount: number;
    expense_date: string;
    category_id?: number;
    notes?: string;
  } = {
    description: dto.description,
    amount: dto.amount,
    expense_date: dto.date,
  };
  if (dto.category_id !== undefined && dto.category_id !== null && dto.category_id !== '') {
    const asNumber = Number(dto.category_id);
    if (Number.isFinite(asNumber)) payload.category_id = asNumber;
  }
  if (dto.notes) payload.notes = dto.notes;
  return payload;
}

export const ExpenseService = {
  async getStats(): Promise<ExpenseStats> {
    const res = await apiClient.get('/store/expenses/summary');
    return mapExpenseStats(unwrap<RawExpenseStats>(res));
  },

  async list(params?: {
    search?: string;
    state?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Expense>> {
    const query = buildQuery({
      page: params?.page ?? 1,
      limit: params?.limit ?? 20,
      search: params?.search,
      state: params?.state,
    });
    const res = await apiClient.get(`/store/expenses${query}`);
    const paginated = unwrapPaginated<RawExpense>(res, {
      page: params?.page ?? 1,
      limit: params?.limit ?? 20,
    });
    const mapped = (paginated.data ?? [])
      .map(mapExpense)
      .filter((e): e is Expense => e !== null);
    return { ...paginated, data: mapped };
  },

  async getById(id: string): Promise<Expense> {
    const numericId = encodeURIComponent(id);
    const res = await apiClient.get(`/store/expenses/${numericId}`);
    const mapped = mapExpense(unwrap<RawExpense>(res));
    if (!mapped) throw new Error('Gasto no encontrado');
    return mapped;
  },

  async create(data: CreateExpenseDto): Promise<Expense> {
    const res = await apiClient.post('/store/expenses', buildCreateExpensePayload(data));
    const mapped = mapExpense(unwrap<RawExpense>(res));
    if (!mapped) throw new Error('Respuesta de creación vacía');
    return mapped;
  },

  async update(id: string, data: Partial<CreateExpenseDto>): Promise<Expense> {
    const numericId = encodeURIComponent(id);
    const res = await apiClient.put(
      `/store/expenses/${numericId}`,
      buildCreateExpensePayload(data as CreateExpenseDto),
    );
    const mapped = mapExpense(unwrap<RawExpense>(res));
    if (!mapped) throw new Error('Respuesta de actualización vacía');
    return mapped;
  },

  async delete(id: string): Promise<void> {
    const numericId = encodeURIComponent(id);
    await apiClient.delete(`/store/expenses/${numericId}`);
  },

  async getCategories(): Promise<ExpenseCategory[]> {
    const res = await apiClient.get('/store/expenses/categories');
    return unwrap<RawExpenseCategory[]>(res).map(mapExpenseCategory);
  },

  async createCategory(data: { name: string; description?: string }): Promise<ExpenseCategory> {
    const res = await apiClient.post('/store/expenses/categories', data);
    return mapExpenseCategory(unwrap<RawExpenseCategory>(res));
  },

  async deleteCategory(id: string): Promise<void> {
    const numericId = encodeURIComponent(id);
    await apiClient.delete(`/store/expenses/categories/${numericId}`);
  },
};
