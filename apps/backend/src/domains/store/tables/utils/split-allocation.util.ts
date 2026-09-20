import { Decimal } from '@common/money-kernel';

export type SplitDecimalInput = string | number | { toString(): string };

export interface SplitAllocationTaxInput {
  tax_rate_id: number | null;
  tax_name: string;
  tax_rate: SplitDecimalInput;
  tax_type: string | null;
  is_compound: boolean | null;
  is_inclusive: boolean;
  tax_amount: SplitDecimalInput;
}

export interface SplitAllocationTaxOutput extends Omit<
  SplitAllocationTaxInput,
  'tax_rate' | 'tax_amount'
> {
  tax_rate: string;
  tax_amount: string;
}

export interface FinancialSplitSource {
  subtotal_amount: SplitDecimalInput;
  discount_amount: SplitDecimalInput;
  tax_amount: SplitDecimalInput;
  shipping_cost: SplitDecimalInput;
  tip_amount: SplitDecimalInput;
  grand_total: SplitDecimalInput;
  paid_total: SplitDecimalInput;
  items: Array<{
    id: number;
    subtotal_amount: SplitDecimalInput;
    taxes: SplitAllocationTaxInput[];
  }>;
}

export interface FinancialSplitRequest {
  mode: 'equal' | 'custom' | 'items';
  n_splits?: number;
  amounts?: SplitDecimalInput[];
  item_groups?: Array<{ order_item_ids: number[] }>;
}

export interface FinancialSplitLine {
  kind: 'item' | 'shipping' | 'tip';
  source_order_item_id?: number;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  taxes: SplitAllocationTaxOutput[];
}

export interface FinancialSplitAllocation {
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  shipping_cost: string;
  tip_amount: string;
  grand_total: string;
  lines: FinancialSplitLine[];
}

export interface FinancialSplitAllocationResult {
  original_total: string;
  preserved_paid: string;
  pending_to_split: string;
  retained_account: FinancialSplitAllocation | null;
  accounts: FinancialSplitAllocation[];
}

export class SplitAllocationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_MONEY'
      | 'INVALID_SOURCE'
      | 'INVALID_REQUEST'
      | 'EMPTY_ACCOUNT',
    message: string,
  ) {
    super(message);
    this.name = 'SplitAllocationError';
  }
}

/** Parse exactly, never silently round away a fraction of a cent. */
export function getCents(value: SplitDecimalInput, label = 'amount'): bigint {
  try {
    if (value === null || value === undefined || typeof value === 'boolean') {
      throw new Error('Missing amount');
    }
    const decimal = new Decimal(value.toString());
    if (
      !decimal.isFinite() ||
      decimal.decimalPlaces() > 2 ||
      decimal.abs().greaterThan('9999999999.99')
    ) {
      throw new Error('Amount must be finite with at most two decimal places');
    }
    // No Decimal multiplication: its global precision must not truncate large
    // inputs before they enter the exact bigint arithmetic below.
    return BigInt(decimal.toFixed(2).replace('.', ''));
  } catch {
    throw new SplitAllocationError(
      'INVALID_MONEY',
      `${label} must be exact money`,
    );
  }
}

export function formatCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);
const MAX_MONEY_CENTS = 999999999999n; // Decimal(12, 2), not a UI-specific cap.

function sourceMoney(value: SplitDecimalInput, label: string): bigint {
  const cents = getCents(value, label);
  if (cents < 0n || cents > MAX_MONEY_CENTS) {
    throw new SplitAllocationError(
      'INVALID_SOURCE',
      `${label} is outside Decimal(12,2)`,
    );
  }
  return cents;
}

/** Largest remainder for a single total; weights and products stay bigint. */
function proportional(total: bigint, weights: readonly bigint[]): bigint[] {
  const denominator = sum(weights);
  if (total === 0n) return weights.map(() => 0n);
  if (denominator <= 0n)
    throw new Error('Split allocation requires positive weights');
  const result = weights.map((weight) => (total * weight) / denominator);
  const residual = Number(total - sum(result)); // Strictly less than weights.length.
  const order = weights
    .map((weight, index) => ({
      index,
      remainder: (total * weight) % denominator,
    }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  for (let i = 0; i < residual; i += 1) result[order[i].index] += 1n;
  return result;
}

interface FlowEdge {
  to: number;
  reverse: number;
  capacity: number;
}

/**
 * Exact row AND column margins. Floors alone leave at most N-1 cents per row.
 * A bipartite residual flow rounds selected fractional cells up by ONE cent.
 * The fractional matrix itself is a feasible flow, hence its integral network
 * has a solution. Independent largest-remainder rounds do not preserve columns.
 * Number capacities here count residual CENTS (bounded by cell count), never money.
 */
function allocateMatrix(
  rows: readonly bigint[],
  columns: readonly bigint[],
): bigint[][] {
  const total = sum(rows);
  if (total !== sum(columns))
    throw new Error('Split allocation margins disagree');
  const result = rows.map(() => columns.map(() => 0n));
  if (total === 0n) return result;

  const rowDeficits: number[] = [];
  const columnDeficits = columns.slice();
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < columns.length; j += 1) {
      result[i][j] = (rows[i] * columns[j]) / total;
      columnDeficits[j] -= result[i][j];
    }
    rowDeficits[i] = Number(rows[i] - sum(result[i]));
  }

  const source = rows.length + columns.length;
  const sink = source + 1;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from: number, to: number, capacity: number): FlowEdge => {
    const forward = { to, reverse: graph[to].length, capacity };
    graph[from].push(forward);
    graph[to].push({ to: from, reverse: graph[from].length - 1, capacity: 0 });
    return forward;
  };
  const cells: Array<{ row: number; column: number; edge: FlowEdge }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    addEdge(source, i, rowDeficits[i]);
    const candidates = columns
      .map((amount, column) => ({
        column,
        remainder: (rows[i] * amount) % total,
      }))
      .filter((cell) => cell.remainder > 0n)
      .sort((a, b) =>
        a.remainder === b.remainder
          ? a.column - b.column
          : a.remainder > b.remainder
            ? -1
            : 1,
      );
    for (const cell of candidates) {
      cells.push({
        row: i,
        column: cell.column,
        edge: addEdge(i, rows.length + cell.column, 1),
      });
    }
  }
  for (let j = 0; j < columns.length; j += 1) {
    addEdge(rows.length + j, sink, Number(columnDeficits[j]));
  }

  let remaining = rowDeficits.reduce((a, b) => a + b, 0);
  while (remaining > 0) {
    const levels = Array<number>(graph.length).fill(-1);
    levels[source] = 0;
    const queue = [source];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const edge of graph[queue[cursor]]) {
        if (edge.capacity > 0 && levels[edge.to] < 0) {
          levels[edge.to] = levels[queue[cursor]] + 1;
          queue.push(edge.to);
        }
      }
    }
    if (levels[sink] < 0)
      throw new Error('Split allocation residual flow is infeasible');
    const next = Array<number>(graph.length).fill(0);
    const push = (node: number, limit: number): number => {
      if (node === sink) return limit;
      for (; next[node] < graph[node].length; next[node] += 1) {
        const edge = graph[node][next[node]];
        if (edge.capacity <= 0 || levels[edge.to] !== levels[node] + 1)
          continue;
        const sent = push(edge.to, Math.min(limit, edge.capacity));
        if (sent > 0) {
          edge.capacity -= sent;
          graph[edge.to][edge.reverse].capacity += sent;
          return sent;
        }
      }
      return 0;
    };
    let sent: number;
    while ((sent = push(source, remaining)) > 0) remaining -= sent;
  }
  for (const cell of cells)
    if (cell.edge.capacity === 0) result[cell.row][cell.column] += 1n;
  return result;
}

interface NormalizedItem {
  id: number;
  base: bigint;
  taxes: Array<{ snapshot: SplitAllocationTaxOutput; amount: bigint }>;
}
interface ComponentRow {
  itemIndex?: number;
  taxIndex?: number;
  kind: 'net' | 'tax' | 'shipping' | 'tip';
  amount: bigint;
}

function normalizeTax(
  tax: SplitAllocationTaxInput,
): NormalizedItem['taxes'][number] {
  let rate: string;
  try {
    const decimal = new Decimal(tax.tax_rate.toString());
    if (!decimal.isFinite() || decimal.isNegative())
      throw new Error('Invalid rate');
    rate = decimal.toString();
  } catch {
    throw new SplitAllocationError(
      'INVALID_SOURCE',
      'Tax rate must be a non-negative finite snapshot',
    );
  }
  const amount = sourceMoney(tax.tax_amount, 'item.tax_amount');
  return {
    amount,
    snapshot: { ...tax, tax_rate: rate, tax_amount: formatCents(amount) },
  };
}

/**
 * Pure financial projection: never changes physical quantities, catalog prices,
 * inventory flags or payments. The paid account is an economic snapshot only.
 * Source rows must be active lines and authoritative tax snapshots from the caller.
 */
export function allocateFinancialSplit(
  source: FinancialSplitSource,
  request: FinancialSplitRequest,
): FinancialSplitAllocationResult {
  const subtotal = sourceMoney(source.subtotal_amount, 'subtotal_amount');
  const discount = sourceMoney(source.discount_amount, 'discount_amount');
  const tax = sourceMoney(source.tax_amount, 'tax_amount');
  const shipping = sourceMoney(source.shipping_cost, 'shipping_cost');
  const tip = sourceMoney(source.tip_amount, 'tip_amount');
  const original = sourceMoney(source.grand_total, 'grand_total');
  const paid = sourceMoney(source.paid_total, 'paid_total');
  if (
    discount > subtotal ||
    original !== subtotal - discount + tax + shipping + tip
  ) {
    throw new SplitAllocationError(
      'INVALID_SOURCE',
      'Source header amounts do not reconcile',
    );
  }
  if (paid >= original) {
    throw new SplitAllocationError(
      'INVALID_SOURCE',
      'Source has no positive unpaid balance',
    );
  }
  const pending = original - paid;
  const ids = new Set<number>();
  const items: NormalizedItem[] = source.items
    .map((item) => {
      if (!Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)) {
        throw new SplitAllocationError(
          'INVALID_SOURCE',
          'Source item IDs must be positive and unique',
        );
      }
      ids.add(item.id);
      const taxes = item.taxes.map(normalizeTax).sort((a, b) => {
        const key = (row: SplitAllocationTaxOutput) =>
          JSON.stringify([
            row.tax_rate_id,
            row.tax_name,
            row.tax_type,
            row.tax_rate,
            row.is_compound,
            row.is_inclusive,
            row.tax_amount,
          ]);
        const keyA = key(a.snapshot);
        const keyB = key(b.snapshot);
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
      });
      return {
        id: item.id,
        base: sourceMoney(item.subtotal_amount, 'item.subtotal_amount'),
        taxes,
      };
    })
    .sort((a, b) => a.id - b.id);
  if (
    sum(items.map((item) => item.base)) !== subtotal ||
    sum(items.flatMap((item) => item.taxes.map((row) => row.amount))) !== tax
  ) {
    throw new SplitAllocationError(
      'INVALID_SOURCE',
      'Source line bases/taxes do not match the header',
    );
  }

  const itemDiscounts = proportional(
    discount,
    items.map((item) => item.base),
  );
  const rows: ComponentRow[] = [];
  const netRows: number[] = [];
  items.forEach((item, itemIndex) => {
    netRows[itemIndex] = rows.length;
    rows.push({
      itemIndex,
      kind: 'net',
      amount: item.base - itemDiscounts[itemIndex],
    });
    item.taxes.forEach((entry, taxIndex) =>
      rows.push({ itemIndex, taxIndex, kind: 'tax', amount: entry.amount }),
    );
  });
  rows.push(
    { kind: 'shipping', amount: shipping },
    { kind: 'tip', amount: tip },
  );

  // First partition P/R in isolation: changing N or mode cannot rewrite the
  // components already covered by real, unchanged payments.
  const paidMatrix = allocateMatrix(
    rows.map((row) => row.amount),
    [paid, pending],
  );
  const discountMatrix = items.map((_item, index) => {
    const netParts = paidMatrix[netRows[index]];
    return proportional(
      itemDiscounts[index],
      sum(netParts) > 0n ? netParts : [paid, pending],
    );
  });
  const pendingRows = paidMatrix.map((parts) => parts[1]);
  const pendingDiscounts = discountMatrix.map((parts) => parts[1]);

  const n =
    request.mode === 'items' ? request.item_groups?.length : request.n_splits;
  if (!Number.isSafeInteger(n) || n! < 2 || n! > 20) {
    throw new SplitAllocationError(
      'INVALID_REQUEST',
      'The number of accounts must be between 2 and 20',
    );
  }
  const count = n!;
  let accountRows: bigint[][];
  let accountDiscounts: bigint[][];

  if (request.mode === 'items') {
    const ownerById = new Map<number, number>();
    request.item_groups!.forEach((group, index) => {
      if (
        !Array.isArray(group.order_item_ids) ||
        group.order_item_ids.length === 0
      ) {
        throw new SplitAllocationError(
          'INVALID_REQUEST',
          'Each item group must contain source items',
        );
      }
      for (const id of group.order_item_ids) {
        if (!ids.has(id) || ownerById.has(id)) {
          throw new SplitAllocationError(
            'INVALID_REQUEST',
            'Item groups contain foreign or duplicate IDs',
          );
        }
        ownerById.set(id, index);
      }
    });
    if (ownerById.size !== items.length) {
      throw new SplitAllocationError(
        'INVALID_REQUEST',
        'Item groups must cover every source line exactly once',
      );
    }
    accountRows = rows.map(() => Array<bigint>(count).fill(0n));
    accountDiscounts = items.map(() => Array<bigint>(count).fill(0n));
    const weights = Array<bigint>(count).fill(0n);
    rows.forEach((row, index) => {
      if (row.itemIndex === undefined) return;
      const owner = ownerById.get(items[row.itemIndex].id)!;
      accountRows[index][owner] = pendingRows[index];
      weights[owner] += pendingRows[index];
    });
    items.forEach((item, index) => {
      accountDiscounts[index][ownerById.get(item.id)!] =
        pendingDiscounts[index];
    });
    // All consumption can legitimately be fully discounted; use the original
    // base in that exceptional case to distribute actual shipping/tip charges.
    if (sum(weights) === 0n)
      items.forEach((item) => {
        weights[ownerById.get(item.id)!] += item.base;
      });
    rows.forEach((row, index) => {
      if (row.kind === 'shipping' || row.kind === 'tip') {
        if (pendingRows[index] > 0n && sum(weights) === 0n) {
          throw new SplitAllocationError(
            'INVALID_REQUEST',
            'Item groups have no basis for shipping/tip allocation',
          );
        }
        accountRows[index] = proportional(pendingRows[index], weights);
      }
    });
  } else {
    let targets: bigint[];
    if (request.mode === 'equal') {
      const base = pending / BigInt(count);
      const residual = Number(pending % BigInt(count));
      targets = Array.from(
        { length: count },
        (_, index) => base + (index < residual ? 1n : 0n),
      );
    } else if (request.mode === 'custom') {
      if (!Array.isArray(request.amounts) || request.amounts.length !== count) {
        throw new SplitAllocationError(
          'INVALID_REQUEST',
          'Custom amounts must match the account count',
        );
      }
      targets = request.amounts.map((amount) =>
        getCents(amount, 'custom amount'),
      );
      if (sum(targets) !== pending) {
        throw new SplitAllocationError(
          'INVALID_REQUEST',
          'Custom amounts must sum exactly to the unpaid balance',
        );
      }
    } else {
      throw new SplitAllocationError(
        'INVALID_REQUEST',
        'Unknown financial split mode',
      );
    }
    if (targets.some((amount) => amount <= 0n)) {
      throw new SplitAllocationError(
        'EMPTY_ACCOUNT',
        'Each new account must have a positive amount',
      );
    }
    accountRows = allocateMatrix(pendingRows, targets);
    accountDiscounts = pendingDiscounts.map((amount, index) => {
      const weights = accountRows[netRows[index]];
      return proportional(amount, sum(weights) > 0n ? weights : targets);
    });
  }

  const buildAccount = (
    amounts: bigint[],
    discounts: bigint[],
  ): FinancialSplitAllocation => {
    const lines: FinancialSplitLine[] = [];
    let accountSubtotal = 0n;
    let accountTax = 0n;
    items.forEach((item, itemIndex) => {
      const net = amounts[netRows[itemIndex]];
      const base = net + discounts[itemIndex];
      const allocatedTaxes = item.taxes.map((entry, taxIndex) => {
        const rowIndex = netRows[itemIndex] + 1 + taxIndex;
        return {
          ...entry.snapshot,
          tax_amount: formatCents(amounts[rowIndex]),
        };
      });
      const lineTax = sum(
        allocatedTaxes.map((entry) => getCents(entry.tax_amount)),
      );
      accountSubtotal += base;
      accountTax += lineTax;
      if (base !== 0n || lineTax !== 0n)
        lines.push({
          kind: 'item',
          source_order_item_id: item.id,
          subtotal_amount: formatCents(base),
          discount_amount: formatCents(discounts[itemIndex]),
          tax_amount: formatCents(lineTax),
          total_amount: formatCents(net + lineTax),
          taxes: allocatedTaxes,
        });
    });
    const accountShipping = amounts[rows.length - 2];
    const accountTip = amounts[rows.length - 1];
    for (const [kind, value] of [
      ['shipping', accountShipping],
      ['tip', accountTip],
    ] as const) {
      if (value !== 0n)
        lines.push({
          kind,
          subtotal_amount: formatCents(value),
          discount_amount: '0.00',
          tax_amount: '0.00',
          total_amount: formatCents(value),
          taxes: [],
        });
    }
    const accountDiscount = sum(discounts);
    return {
      subtotal_amount: formatCents(accountSubtotal),
      discount_amount: formatCents(accountDiscount),
      tax_amount: formatCents(accountTax),
      shipping_cost: formatCents(accountShipping),
      tip_amount: formatCents(accountTip),
      grand_total: formatCents(
        accountSubtotal -
          accountDiscount +
          accountTax +
          accountShipping +
          accountTip,
      ),
      lines,
    };
  };

  const accounts = Array.from({ length: count }, (_, index) =>
    buildAccount(
      accountRows.map((parts) => parts[index]),
      accountDiscounts.map((parts) => parts[index]),
    ),
  );
  if (accounts.some((account) => getCents(account.grand_total) <= 0n)) {
    throw new SplitAllocationError(
      'EMPTY_ACCOUNT',
      'Each new account must have a positive unpaid amount',
    );
  }
  return {
    original_total: formatCents(original),
    preserved_paid: formatCents(paid),
    pending_to_split: formatCents(pending),
    retained_account:
      paid > 0n
        ? buildAccount(
            paidMatrix.map((parts) => parts[0]),
            discountMatrix.map((parts) => parts[0]),
          )
        : null,
    accounts,
  };
}
