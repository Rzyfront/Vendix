import {
  buildCreateExpensePayload,
  mapExpense,
  mapExpenseCategory,
  mapExpenseStats,
  ExpenseService,
} from './expense.service';
import { apiClient } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type { RawExpense, RawExpenseCategory, RawExpenseStats } from '../types/expense.types';

jest.mock('@/core/api', () => ({ apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock('@/core/api/pagination', () => ({ unwrapPaginated: jest.fn() }));

const mockClient = apiClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};
const mockUnwrap = unwrapPaginated as unknown as jest.Mock;

const rawExpense: RawExpense = {
  id: 42,
  description: 'Internet de la oficina',
  amount: '150000.50',
  expense_date: '2026-07-15T00:00:00.000Z',
  state: 'pending',
  notes: 'pago mensual',
  created_at: '2026-07-15T10:00:00.000Z',
  category_id: 7,
  expense_categories: { id: 7, name: 'Servicios' },
};

describe('mapExpense', () => {
  it('mapea una fila cruda completa con Decimal string', () => {
    const mapped = mapExpense(rawExpense);
    expect(mapped).toEqual({
      id: '42',
      description: 'Internet de la oficina',
      amount: 150000.5,
      date: '2026-07-15T00:00:00.000Z',
      state: 'pending',
      notes: 'pago mensual',
      created_at: '2026-07-15T10:00:00.000Z',
      category_id: '7',
      category_name: 'Servicios',
    });
  });

  it('acepta category_id en raíz sin relación expandida', () => {
    const mapped = mapExpense({ ...rawExpense, expense_categories: null });
    expect(mapped?.category_id).toBe('7');
    expect(mapped?.category_name).toBeUndefined();
  });

  it('maneja amount numérico y notas vacías', () => {
    const mapped = mapExpense({ ...rawExpense, amount: 999, notes: null });
    expect(mapped?.amount).toBe(999);
    expect(mapped?.notes).toBeUndefined();
  });

  it('devuelve null si la fila cruda es null o undefined', () => {
    expect(mapExpense(null)).toBeNull();
    expect(mapExpense(undefined)).toBeNull();
  });
});

describe('mapExpenseStats', () => {
  it('deriva totalAmount desde total_amount y cuenta por estado', () => {
    const raw: RawExpenseStats = {
      total_amount: '258000.10',
      total_count: 12,
      counts_by_state: { pending: 3, approved: 5, paid: 4 },
    };
    expect(mapExpenseStats(raw)).toEqual({
      total: 12,
      totalAmount: 258000.1,
      pending: 3,
      approved: 5,
      paid: 4,
    });
  });

  it('devuelve zeros si la respuesta es null o indefinida', () => {
    expect(mapExpenseStats(null)).toEqual({ total: 0, totalAmount: 0, pending: 0, approved: 0, paid: 0 });
    expect(mapExpenseStats(undefined)).toEqual({ total: 0, totalAmount: 0, pending: 0, approved: 0, paid: 0 });
  });

  it('tolera counts_by_state faltante', () => {
    expect(mapExpenseStats({ total_amount: 0, total_count: 0 })).toEqual({
      total: 0,
      totalAmount: 0,
      pending: 0,
      approved: 0,
      paid: 0,
    });
  });
});

describe('mapExpenseCategory', () => {
  it('normaliza el id a string y description opcional', () => {
    const cat = mapExpenseCategory({ id: 9, name: 'Transporte', description: 'taxis y buses' });
    expect(cat).toEqual({ id: '9', name: 'Transporte', description: 'taxis y buses' });
    const cat2 = mapExpenseCategory({ id: 9, name: 'Transporte', description: null });
    expect(cat2.description).toBeUndefined();
  });
});

describe('buildCreateExpensePayload', () => {
  it('mapea date a expense_date y convierte category_id a número', () => {
    expect(
      buildCreateExpensePayload({
        description: 'Café',
        amount: 12500,
        date: '2026-07-20',
        category_id: '3',
        notes: 'oficina',
      }),
    ).toEqual({
      description: 'Café',
      amount: 12500,
      expense_date: '2026-07-20',
      category_id: 3,
      notes: 'oficina',
    });
  });

  it('omite category_id si está vacío y omite notes si no hay', () => {
    expect(
      buildCreateExpensePayload({
        description: 'Sin categoría',
        amount: 10,
        date: '2026-07-20',
        category_id: '',
      }),
    ).toEqual({ description: 'Sin categoría', amount: 10, expense_date: '2026-07-20' });
  });

  it('ignora category_id no numérico en lugar de lanzar', () => {
    const result = buildCreateExpensePayload({
      description: 'Sin número',
      amount: 10,
      date: '2026-07-20',
      category_id: 'abc',
    });
    expect(result).toEqual({ description: 'Sin número', amount: 10, expense_date: '2026-07-20' });
  });
});

describe('ExpenseService.list', () => {
  it('mapea cada página de RawExpense a Expense y preserva paginación', async () => {
    mockClient.get.mockResolvedValueOnce({ data: { success: true, data: [rawExpense] } });
    mockUnwrap.mockReturnValueOnce({
      data: [rawExpense],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
    });
    const result = await ExpenseService.list({ page: 1, limit: 20 });
    expect(result.data[0].id).toBe('42');
    expect(result.data[0].category_name).toBe('Servicios');
    expect(result.pagination.total).toBe(1);
    expect(mockClient.get).toHaveBeenCalledWith('/store/expenses?page=1&limit=20');
  });
});

describe('ExpenseService.getStats', () => {
  it('apunta a /summary y mapea total_amount', async () => {
    mockClient.get.mockResolvedValueOnce({
      data: { success: true, data: { total_amount: '999.5', total_count: 4, counts_by_state: { pending: 4 } } },
    });
    const result = await ExpenseService.getStats();
    expect(result).toEqual({ total: 4, totalAmount: 999.5, pending: 4, approved: 0, paid: 0 });
    expect(mockClient.get).toHaveBeenCalledWith('/store/expenses/summary');
  });
});

describe('ExpenseService.getCategories', () => {
  it('apunta a /categories y mapea cada categoría', async () => {
    const raw: RawExpenseCategory[] = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
    mockClient.get.mockResolvedValueOnce({ data: { success: true, data: raw } });
    const result = await ExpenseService.getCategories();
    expect(result).toEqual([{ id: '1', name: 'A' }, { id: '2', name: 'B' }]);
    expect(mockClient.get).toHaveBeenCalledWith('/store/expenses/categories');
  });
});

describe('ExpenseService.create', () => {
  it('envía expense_date y category_id numérico', async () => {
    mockClient.post.mockResolvedValueOnce({ data: { success: true, data: rawExpense } });
    await ExpenseService.create({
      description: 'Internet',
      amount: 150000.5,
      date: '2026-07-15',
      category_id: '7',
      notes: 'mensual',
    });
    const [url, payload] = mockClient.post.mock.calls[0];
    expect(url).toBe('/store/expenses');
    expect(payload).toEqual({
      description: 'Internet',
      amount: 150000.5,
      expense_date: '2026-07-15',
      category_id: 7,
      notes: 'mensual',
    });
  });
});

describe('ExpenseService.update', () => {
  it('PUT con el payload normalizado', async () => {
    mockClient.put.mockResolvedValueOnce({ data: { success: true, data: rawExpense } });
    await ExpenseService.update('42', { description: 'Nuevo', amount: 1, date: '2026-07-15' });
    const [url, payload] = mockClient.put.mock.calls[0];
    expect(url).toBe('/store/expenses/42');
    expect(payload).toMatchObject({ description: 'Nuevo', amount: 1, expense_date: '2026-07-15' });
  });
});

describe('ExpenseService.delete', () => {
  it('usa la ruta numérica', async () => {
    mockClient.delete.mockResolvedValueOnce({});
    await ExpenseService.delete('42');
    expect(mockClient.delete).toHaveBeenCalledWith('/store/expenses/42');
  });
});

describe('ExpenseService.getById', () => {
  it('mapea la respuesta a Expense', async () => {
    mockClient.get.mockResolvedValueOnce({ data: { success: true, data: rawExpense } });
    const result = await ExpenseService.getById('42');
    expect(result.id).toBe('42');
    expect(mockClient.get).toHaveBeenCalledWith('/store/expenses/42');
  });
});

describe('ExpenseService.createCategory / deleteCategory', () => {
  it('POST a /categories', async () => {
    mockClient.post.mockResolvedValueOnce({
      data: { success: true, data: { id: 5, name: 'Otros' } },
    });
    await ExpenseService.createCategory({ name: 'Otros' });
    expect(mockClient.post).toHaveBeenCalledWith('/store/expenses/categories', { name: 'Otros' });
  });

  it('DELETE numérico', async () => {
    mockClient.delete.mockResolvedValueOnce({});
    await ExpenseService.deleteCategory('5');
    expect(mockClient.delete).toHaveBeenCalledWith('/store/expenses/categories/5');
  });
});
