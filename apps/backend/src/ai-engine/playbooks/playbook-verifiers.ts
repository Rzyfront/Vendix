import {
  PlaybookObservation,
  PlaybookVerifier,
  PlaybookVerificationResult,
} from './playbook.interface';

type Data = Record<string, unknown>;
const record = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const number = (value: unknown): number | null =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null;
const equalMoney = (a: unknown, b: unknown): boolean =>
  number(a) !== null &&
  number(b) !== null &&
  Math.abs(number(a)! - number(b)!) < 0.001;
const positive = (value: unknown): boolean =>
  number(value) !== null && number(value)! > 0;
const nonnegative = (value: unknown): boolean =>
  number(value) !== null && number(value)! >= 0;
const same = (a: unknown, b: unknown): boolean =>
  a !== null &&
  a !== undefined &&
  b !== null &&
  b !== undefined &&
  String(a) === String(b);
const hasId = (value: unknown): boolean =>
  (typeof value === 'string' && value.length > 0) ||
  (typeof value === 'number' && Number.isInteger(value) && value > 0);
function payload(observation: PlaybookObservation): Data {
  let data = record(observation.data);
  for (let i = 0; i < 3; i++) {
    if (data.success === false || data.error) return {};
    if (
      data.data &&
      !Array.isArray(data.data) &&
      (data.success === true ||
        Object.keys(data).every((k) =>
          ['data', 'message', 'statusCode'].includes(k),
        ))
    )
      data = record(data.data);
    else break;
  }
  return data;
}
function trusted(
  observation: PlaybookObservation | undefined,
): observation is PlaybookObservation {
  return (
    !!observation &&
    observation.status === 'ok' &&
    observation.fresh === true &&
    observation.complete === true &&
    observation.artifact !== true &&
    !record(observation.data).error &&
    record(observation.data).success !== false
  );
}
interface Rule {
  tool: string;
  id?: string;
  identity?: (data: Data, input: Data) => unknown;
  bridgePath?: (input: Data, final: PlaybookObservation) => string;
  preparation?: boolean;
  boundArguments?: string[];
  required: string[];
  effects?: Array<[step: string, tool: string]>;
  predicate: (
    data: Data,
    input: Data,
    observations: PlaybookObservation[],
  ) => boolean;
  failureReason?: (
    data: Data,
    input: Data,
    observations: PlaybookObservation[],
  ) => string;
}
function read(
  observations: PlaybookObservation[],
  step: string,
  tool: string,
): Data {
  const observation = observations.find(
    (o) => o.step_id === step && o.tool === tool,
  );
  return trusted(observation) ? payload(observation) : {};
}
function run(
  rule: Rule,
  input: Data,
  observations: PlaybookObservation[],
): PlaybookVerificationResult {
  const reasons: string[] = [];
  const evidence: string[] = [];
  for (const key of rule.required)
    if (input[key] === undefined || input[key] === null || input[key] === '')
      reasons.push(`missing_input:${key}`);
  const final = observations.find(
    (o) => o.step_id === 'verify' && o.tool === rule.tool,
  );
  if (!trusted(final)) reasons.push('fresh_complete_domain_read_required');
  if (rule.id && final) {
    if (!hasId(final.resource_ids[rule.id]))
      reasons.push(`resource_id_required:${rule.id}`);
    if (
      input[rule.id] !== undefined &&
      !same(final.resource_ids[rule.id], input[rule.id])
    )
      reasons.push('resource_identity_mismatch');
    if (
      rule.identity &&
      !same(rule.identity(payload(final), input), final.resource_ids[rule.id])
    )
      reasons.push('payload_identity_mismatch');
  }
  if (
    rule.bridgePath &&
    final &&
    (final.bridge?.method !== 'GET' ||
      final.bridge.path !== rule.bridgePath(input, final))
  )
    reasons.push('domain_endpoint_identity_mismatch');
  for (const key of rule.boundArguments ?? [])
    if (!final || !same(final.arguments?.[key], input[key]))
      reasons.push(`read_arguments_mismatch:${key}`);
  const effects = rule.effects ?? [];
  for (const [step, tool] of effects) {
    const effect = observations.find(
      (o) => o.step_id === step && o.tool === tool,
    );
    if (!trusted(effect))
      reasons.push(`successful_effect_receipt_required:${step}`);
    else {
      evidence.push(step);
      if (
        rule.id &&
        final &&
        !same(effect.resource_ids[rule.id], final.resource_ids[rule.id])
      )
        reasons.push(`effect_identity_mismatch:${step}`);
    }
  }
  if (effects.length && final?.after_step !== effects[effects.length - 1][0])
    reasons.push('post_write_read_required');
  if (trusted(final)) {
    evidence.push(final.step_id);
    try {
      if (!rule.predicate(payload(final), input, observations))
        reasons.push(
          rule.failureReason?.(payload(final), input, observations) ??
            'domain_postcondition_not_met',
        );
    } catch {
      reasons.push(
        rule.failureReason?.(payload(final), input, observations) ??
          'domain_postcondition_not_met',
      );
    }
  }
  return {
    verified: reasons.length === 0,
    scope: rule.preparation ? 'preparation' : 'domain',
    evidence_step_ids: reasons.length ? [] : evidence,
    reasons,
  };
}
const po = (d: Data): Data => record(d.orden);
const stockRowsValid = (d: Data): boolean =>
  array(d.data).length > 0 &&
  array(d.data).every((r) => {
    const row = record(r);
    return (
      nonnegative(row.on_hand) &&
      nonnegative(row.reserved) &&
      number(row.available) !== null &&
      equalMoney(Number(row.on_hand) - Number(row.reserved), row.available)
    );
  });
const financialPayment = (d: Data, i: Data, paymentArray: string): boolean =>
  hasId(d.id) &&
  nonnegative(d.balance) &&
  equalMoney(d.balance, i.expected_balance) &&
  array(d[paymentArray]).filter(
    (p) =>
      same(record(p).id, i.payment_id) &&
      equalMoney(record(p).amount, i.amount),
  ).length === 1;

/** Pure postcondition predicates only. No scheduling, DB, network, authorization or objective transitions. */
const RULES: Record<string, Rule> = {
  'reponer-inventario': {
    tool: 'get_sourcing_suggestion',
    boundArguments: ['product_id', 'quantity'],
    required: ['product_id', 'quantity'],
    predicate: (d, i, obs) =>
      positive(i.quantity) &&
      same(d.cantidad_solicitada, i.quantity) &&
      ['available', 'transfer', 'purchase'].includes(String(d.sugerencia)) &&
      stockRowsValid(read(obs, 'stock', 'get_stock_levels')) &&
      array(read(obs, 'stock', 'get_stock_levels').data).every((row) =>
        same(record(row).product_id, i.product_id),
      ) &&
      (d.sugerencia !== 'purchase' ||
        (array(read(obs, 'supplier', 'find_supplier').candidatos).length ===
          1 &&
          read(obs, 'supplier', 'find_supplier').hay_mas !== true)),
    failureReason: (d, _i, obs) =>
      d.sugerencia === 'purchase' &&
      array(read(obs, 'supplier', 'find_supplier').candidatos).length !== 1
        ? 'supplier_choice_required'
        : 'domain_postcondition_not_met',
  },
  'facturar-venta': {
    tool: 'get_invoice_status',
    id: 'invoice_id',
    identity: (d) => d.invoice_id,
    required: ['order_id'],
    effects: [
      ['create', 'create_invoice_from_order'],
      ['validate', 'validate_invoice'],
      ['emit', 'send_invoice_dian'],
    ],
    predicate: (d, i, obs) =>
      d.status === 'accepted' &&
      hasId(d.invoice_id) &&
      !!d.invoice_number &&
      !!d.cufe &&
      read(obs, 'preflight', 'get_emit_readiness').emittable === true &&
      same(
        read(obs, 'preflight', 'get_emit_readiness').invoice_id,
        d.invoice_id,
      ) &&
      same(
        obs.find(
          (o) =>
            o.step_id === 'create' && o.tool === 'create_invoice_from_order',
        )?.resource_ids.order_id,
        i.order_id,
      ) &&
      obs.find((o) => o.step_id === 'order-verify' && o.tool === 'get_order')
        ?.after_step === 'emit' &&
      same(
        record(read(obs, 'order-verify', 'get_order').orden).order_id,
        i.order_id,
      ) &&
      same(
        record(read(obs, 'order-verify', 'get_order').factura_electronica)
          .numero,
        d.invoice_number,
      ) &&
      same(
        record(read(obs, 'order-verify', 'get_order').factura_electronica).cufe,
        d.cufe,
      ),
  },
  'cerrar-caja': {
    tool: 'call_endpoint',
    id: 'session_id',
    identity: (d) => d.id,
    bridgePath: (i) => `store/cash-registers/sessions/${i.session_id}`,
    required: ['session_id', 'actual_closing_amount', 'currency'],
    effects: [['close', 'close_cash_session']],
    predicate: (d, i) =>
      same(d.id, i.session_id) &&
      d.status === 'closed' &&
      nonnegative(i.actual_closing_amount) &&
      equalMoney(d.actual_closing_amount, i.actual_closing_amount) &&
      number(d.expected_closing_amount) !== null &&
      equalMoney(
        d.difference,
        Number(i.actual_closing_amount) - Number(d.expected_closing_amount),
      ),
  },
  'crear-producto-inventario': {
    tool: 'get_inventory_locations',
    preparation: true,
    required: ['name', 'base_price', 'cost_price', 'quantity'],
    predicate: (d, i, obs) =>
      nonnegative(i.base_price) &&
      nonnegative(i.cost_price) &&
      positive(i.quantity) &&
      array(d.data).some((l) => record(l).is_active === true) &&
      array(read(obs, 'duplicate', 'find_product').products).length === 0 &&
      trusted(
        obs.find((o) => o.step_id === 'duplicate' && o.tool === 'find_product'),
      ),
  },
  'compra-proveedor': {
    tool: 'get_purchase_order',
    id: 'purchase_order_id',
    identity: (d) => po(d).purchase_order_id,
    required: ['supplier_id'],
    effects: [['draft', 'manage_purchase_orders']],
    predicate: (d, i) =>
      po(d).status === 'draft' &&
      same(po(d).supplier_id, i.supplier_id) &&
      nonnegative(po(d).total) &&
      array(po(d).lineas).length > 0 &&
      array(po(d).lineas).every(
        (l) => record(l).received === 0 && positive(record(l).ordered),
      ),
  },
  'recibir-compra': {
    tool: 'get_purchase_order',
    id: 'purchase_order_id',
    identity: (d) => po(d).purchase_order_id,
    required: ['purchase_order_id', 'received_quantity'],
    effects: [['receive', 'approve_receive_purchase_order']],
    predicate: (d, i, obs) =>
      ['partial', 'received'].includes(String(po(d).status)) &&
      array(po(d).lineas).length > 0 &&
      equalMoney(
        array(po(d).lineas).reduce<number>(
          (sum, l) => sum + Number(record(l).received),
          0,
        ),
        i.received_quantity,
      ) &&
      array(po(d).lineas).every((l) => nonnegative(record(l).pending)) &&
      stockRowsValid(read(obs, 'stock', 'get_stock_levels')),
  },
  'pagar-proveedor': {
    tool: 'get_payable',
    id: 'payable_id',
    identity: (d) => d.id,
    required: [
      'payable_id',
      'amount',
      'payment_id',
      'expected_balance',
      'payment_method',
    ],
    effects: [['pay', 'pay_payable']],
    predicate: (d, i) =>
      positive(i.amount) && financialPayment(d, i, 'ap_payments'),
  },
  'crear-cliente': {
    tool: 'lookup_customer',
    id: 'customer_id',
    identity: (d) => record(array(d.customers)[0]).customer_id,
    required: ['documento'],
    effects: [['upsert', 'upsert_customer']],
    predicate: (d, i) =>
      d.match_count === 1 &&
      d.ambiguous !== true &&
      array(d.customers).length === 1 &&
      String(record(array(d.customers)[0]).document ?? '').includes(
        String(i.documento),
      ),
  },
  'venta-cobro': {
    tool: 'get_order',
    id: 'order_id',
    identity: (d) => record(d.orden).order_id,
    required: ['amount', 'payment_method'],
    effects: [
      ['create', 'create_order'],
      ['items', 'manage_order_items'],
      ['pay', 'pay_order'],
    ],
    predicate: (d, i) =>
      record(d.orden).estado !== 'cancelled' &&
      positive(i.amount) &&
      equalMoney(record(d.totales).saldo_pendiente, 0) &&
      equalMoney(record(d.totales).pagado, i.amount) &&
      array(d.items).length > 0,
  },
  'cobrar-cartera': {
    tool: 'get_receivable',
    id: 'receivable_id',
    identity: (d) => d.id,
    required: [
      'receivable_id',
      'amount',
      'payment_id',
      'expected_balance',
      'payment_method',
    ],
    effects: [['collect', 'collect_receivable']],
    predicate: (d, i) =>
      positive(i.amount) && financialPayment(d, i, 'ar_payments'),
  },
  'trasladar-inventario': {
    tool: 'call_endpoint',
    id: 'transfer_id',
    identity: (d) => d.id,
    bridgePath: (_i, o) =>
      `store/stock-transfers/${o.resource_ids.transfer_id}`,
    required: ['from_location_id', 'to_location_id', 'expected_status'],
    effects: [['transfer', 'manage_stock_transfers']],
    predicate: (d, i, obs) =>
      !same(i.from_location_id, i.to_location_id) &&
      d.status === i.expected_status &&
      same(d.from_location_id, i.from_location_id) &&
      same(d.to_location_id, i.to_location_id) &&
      stockRowsValid(read(obs, 'stock', 'get_stock_levels')),
  },
  'devolucion-reembolso': {
    tool: 'call_endpoint',
    id: 'return_order_id',
    identity: (d) => d.id,
    bridgePath: (i) => `store/orders/return-orders/${i.return_order_id}`,
    required: ['return_order_id', 'order_id'],
    effects: [['return', 'manage_return_orders']],
    predicate: (d, i) =>
      d.status === 'processed' &&
      same(d.related_order_id, i.order_id) &&
      array(d.return_order_items).length > 0,
  },
  'registrar-gasto': {
    tool: 'get_expense',
    id: 'expense_id',
    identity: (d) => d.id,
    required: ['amount', 'document_key'],
    effects: [
      ['create', 'write_endpoint'],
      ['approve', 'approve_expense'],
    ],
    predicate: (d, i) =>
      d.state === 'approved' &&
      equalMoney(d.amount, i.amount) &&
      (same(d.receipt_url, i.document_key) ||
        same(d.attachment_url, i.document_key)),
  },
  'ruta-despacho': {
    tool: 'list_dispatch_routes',
    id: 'route_id',
    identity: (d) => record(d.planilla).route_id,
    required: ['route_id', 'expected_status'],
    effects: [
      ['route', 'manage_dispatch_route'],
      ['transition', 'transition_route_stop'],
    ],
    predicate: (d, i) =>
      record(d.planilla).status === i.expected_status &&
      same(record(d.planilla).route_id, i.route_id) &&
      array(record(d.planilla).paradas).length > 0 &&
      (i.expected_status !== 'closed' ||
        record(d.planilla).paradas_sin_liquidar === 0),
  },
  'reserva-servicio': {
    tool: 'get_booking',
    id: 'booking_id',
    identity: (d) => record(d.reserva).booking_id,
    required: ['date', 'start_time', 'product_id'],
    effects: [['book', 'manage_bookings']],
    predicate: (d, i) =>
      ['pending', 'confirmed'].includes(String(record(d.reserva).estado)) &&
      String(record(d.reserva).fecha).slice(0, 10) === i.date &&
      record(d.reserva).inicio === i.start_time &&
      same(record(d.servicio).product_id, i.product_id) &&
      (i.provider_id === undefined ||
        same(record(d.proveedor).provider_id, i.provider_id)) &&
      (i.customer_id === undefined ||
        same(record(d.cliente).customer_id, i.customer_id)),
  },
  'mesa-cocina-cobro': {
    // Preparation-only: typed payment does not carry table_session_id. No writes are validated.
    tool: 'list_tables',
    id: 'table_id',
    identity: (d) => record(d.mesa).table_id,
    preparation: true,
    required: ['table_id', 'order_id', 'amount'],
    predicate: (d, i, obs) =>
      same(record(d.mesa).table_id, i.table_id) &&
      record(d.mesa).status === 'occupied' &&
      hasId(record(record(d.mesa).active_session).id) &&
      read(obs, 'kitchen-preview', 'preview_kitchen_fire').blocked === false,
  },
  'cambio-precios': {
    tool: 'get_product_pricing',
    id: 'product_id',
    identity: (d) => record(d.product).product_id,
    required: ['product_id', 'net_price', 'currency'],
    effects: [['update', 'update_product']],
    predicate: (d, i) =>
      d.currency === i.currency &&
      same(record(d.product).product_id, i.product_id) &&
      equalMoney(record(d.price).net_price, i.net_price) &&
      nonnegative(record(d.price).unit_price) &&
      Array.isArray(d.taxes),
  },
  'cierre-contable': {
    tool: 'list_fiscal_periods',
    id: 'fiscal_period_id',
    identity: (d, i) =>
      record(
        array(d.periods).find((p) => same(record(p).id, i.fiscal_period_id)),
      ).id,
    required: ['fiscal_period_id'],
    effects: [['close', 'close_fiscal_period']],
    predicate: (d, i, obs) =>
      d.periods_omitted === 0 &&
      array(d.periods).some(
        (p) =>
          same(record(p).id, i.fiscal_period_id) &&
          record(p).status === 'closed',
      ) &&
      record(read(obs, 'balance', 'get_trial_balance').period_totals)
        .is_balanced === true &&
      !!record(d.accounting_entity).id,
  },
  'nomina-periodo': {
    tool: 'get_payroll_run',
    id: 'payroll_run_id',
    identity: (d) => d.id,
    required: ['payroll_run_id', 'period_start', 'period_end'],
    effects: [
      ['calculate', 'calculate_payroll'],
      ['approve', 'approve_payroll'],
    ],
    predicate: (d, i) =>
      d.status === 'approved' &&
      String(d.period_start).slice(0, 10) === i.period_start &&
      String(d.period_end).slice(0, 10) === i.period_end &&
      positive(d.employee_count) &&
      array(d.items).length === d.employee_count,
  },
  // Conteo físico: la relectura de ESA bodega debe mostrar exactamente lo
  // contado. Con varias filas (variantes en la misma bodega) la lectura no
  // distingue cuál se ajustó: no se verifica, se informa parcial.
  'ajustar-inventario-conteo': {
    tool: 'get_stock_levels',
    id: 'product_id',
    identity: (d) => record(array(d.data)[0]).product_id,
    boundArguments: ['product_id', 'location_id'],
    required: ['product_id', 'location_id', 'quantity_after'],
    effects: [['adjust', 'adjust_stock']],
    predicate: (d, i) =>
      nonnegative(i.quantity_after) &&
      array(d.data).length === 1 &&
      stockRowsValid(d) &&
      same(record(array(d.data)[0]).product_id, i.product_id) &&
      equalMoney(record(array(d.data)[0]).on_hand, i.quantity_after),
    failureReason: (d) =>
      array(d.data).length > 1
        ? 'variant_rows_not_distinguishable'
        : 'domain_postcondition_not_met',
  },
  // list_reconciliations devuelve un arreglo plano: se lee la observación
  // cruda de `verify` (ya validada como confiable por `run`).
  'conciliar-banco': {
    tool: 'list_reconciliations',
    id: 'reconciliation_id',
    boundArguments: ['bank_account_id'],
    required: ['bank_account_id', 'reconciliation_id'],
    effects: [['match', 'auto_match_bank']],
    predicate: (_d, i, obs) => {
      const rows = array(
        obs.find(
          (o) => o.step_id === 'verify' && o.tool === 'list_reconciliations',
        )?.data,
      ).filter((row) => same(record(row).id, i.reconciliation_id));
      const row = record(rows[0]);
      return (
        rows.length === 1 &&
        same(row.bank_account_id, i.bank_account_id) &&
        number(row.statement_balance) !== null &&
        number(row.reconciled_balance) !== null &&
        equalMoney(
          row.difference,
          Number(row.statement_balance) - Number(row.reconciled_balance),
        )
      );
    },
  },
  'reporte-ventas-margen': {
    tool: 'analyze_report',
    required: ['date_from', 'date_to', 'report_id'],
    predicate: (d, i, obs) =>
      same(d.report_id, i.report_id) &&
      record(d.range).date_from === i.date_from &&
      record(d.range).date_to === i.date_to &&
      d.truncated !== true &&
      ((objectPresent(d.summary) &&
        Object.keys(record(d.summary)).length > 0 &&
        !record(d.summary).error &&
        record(d.summary).success !== false) ||
        (Array.isArray(d.rows) &&
          d.offset === 0 &&
          d.row_count === d.rows.length)) &&
      (i.export_requested !== true ||
        (String(read(obs, 'export', 'export_report').file_name).endsWith(
          '.xlsx',
        ) &&
          !!read(obs, 'export', 'export_report').s3_key)),
  },
};
function objectPresent(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export const PLAYBOOK_VERIFIERS: Readonly<Record<string, PlaybookVerifier>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(RULES).map(([id, rule]) => [
        `${id}:v1`,
        (input: Data, observations: PlaybookObservation[]) =>
          run(rule, input, observations),
      ]),
    ),
  );
export function verifyPlaybook(
  id: string,
  input: Data,
  observations: PlaybookObservation[],
): PlaybookVerificationResult {
  const verifier = PLAYBOOK_VERIFIERS[id.includes(':') ? id : `${id}:v1`];
  return verifier
    ? verifier(input, observations)
    : {
        verified: false,
        scope: 'domain',
        evidence_step_ids: [],
        reasons: ['verifier_not_found'],
      };
}
