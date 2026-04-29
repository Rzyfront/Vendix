import apiClient from '@/core/api/client';
import type { ApiResponse, PaginatedResponse } from '../types';
import type {
  Expense,
  ExpenseCategory,
  ExpenseStats,
  CreateExpenseDto,
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

export const ExpenseService = {
  async getStats(): Promise<ExpenseStats> {
    const res = await apiClient.get('/store/expenses/stats');
    return unwrap<ExpenseStats>(res);
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
    return unwrap<PaginatedResponse<Expense>>(res);
  },

  async getById(id: string): Promise<Expense> {
    const res = await apiClient.get(`/store/expenses/${id}`);
    return unwrap<Expense>(res);
  },

  async create(data: CreateExpenseDto): Promise<Expense> {
    const res = await apiClient.post('/store/expenses', data);
    return unwrap<Expense>(res);
  },

  async update(id: string, data: Partial<CreateExpenseDto>): Promise<Expense> {
    const res = await apiClient.put(`/store/expenses/${id}`, data);
    return unwrap<Expense>(res);
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/store/expenses/${id}`);
  },

  async getCategories(): Promise<ExpenseCategory[]> {
    const res = await apiClient.get('/store/expense-categories');
    return unwrap<ExpenseCategory[]>(res);
  },

  async createCategory(data: { name: string; description?: string }): Promise<ExpenseCategory> {
    const res = await apiClient.post('/store/expense-categories', data);
    return unwrap<ExpenseCategory>(res);
  },

  async deleteCategory(id: string): Promise<void> {
    await apiClient.delete(`/store/expense-categories/${id}`);
  },
};
