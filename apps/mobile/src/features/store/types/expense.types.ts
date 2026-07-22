// Tipos consumidos por la UI Store Admin del módulo Gastos.
// La UI habla de strings normalizados; el backend responde con ids numéricos
// y `expense_date` — ver `RawExpense` / `RawExpenseStats` más abajo para el
// shape crudo y la normalización en `expense.service.ts`.

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  category_id?: string;
  category_name?: string;
  state: 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled' | 'refunded';
  notes?: string;
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description?: string;
}

/** Resumen que la tarjeta `Total Gastos` / `Pendientes` necesita del backend. */
export interface ExpenseStats {
  total: number;
  totalAmount: number;
  pending: number;
  approved: number;
  paid: number;
}

export interface CreateExpenseDto {
  description: string;
  amount: number;
  date: string;
  category_id?: string;
  notes?: string;
}

// ─── Tipos crudos del backend (expenses.service.ts los mapea) ───────────────

/** Fila de `GET /store/expenses` — `id` es numérico y `expense_date` (no `date`). */
export interface RawExpense {
  id: number;
  description: string;
  amount: string | number;
  expense_date: string;
  state: Expense['state'];
  notes?: string | null;
  created_at: string;
  category_id?: number | null;
  expense_categories?: { id: number; name: string } | null;
}

/** Cuerpo de `GET /store/expenses/summary` — `total_amount` con snake_case. */
export interface RawExpenseStats {
  total_amount: number | string;
  total_count: number;
  counts_by_state?: Partial<Record<Expense['state'], number>>;
}

export interface RawExpenseCategory {
  id: number;
  name: string;
  description?: string | null;
}
