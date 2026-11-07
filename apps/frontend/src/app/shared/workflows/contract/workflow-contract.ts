/**
 * vendix.workflow/v1 — types, limits, JSON Schema and a reference example.
 *
 * Copied byte for byte into libs/shared-types/workflows/ (canonical),
 * apps/backend/src/common/workflows/contract/ and
 * apps/frontend/src/app/shared/workflows/contract/. Parity is enforced by
 * workflow-contract.parity.spec.ts (backend). Pure TypeScript, no imports.
 */

export const WORKFLOW_SCHEMA_V1 = "vendix.workflow/v1";

export const WORKFLOW_LIMITS = {
  maxStages: 60,
  maxFields: 150,
  maxTransitionsPerStage: 20,
  maxJsonBytes: 262144,
  maxConditionDepth: 3,
  maxConditionRules: 30,
  maxActionsPerHook: 10,
  maxRequirementsPerStage: 20,
  maxSelectOptions: 100,
  /** P2: parallel branches per stage, children per subflow stage, guards. */
  maxBranches: 10,
  maxSubflows: 10,
  maxGuards: 10,
  /** P2.4: hard cap of `loop.max_iterations`. */
  maxLoopIterations: 100,
  /** P2.9: characters of a `compute` expression. */
  maxExpressionLength: 500,
  /** P2.2: nesting of subflows (a child of a child…). */
  maxSubflowDepth: 5,
  /** P2.7: retries an action may ask for before its error policy applies. */
  maxActionRetries: 5,
  /** P2.10: schedule triggers per flow. */
  maxSchedules: 5,
} as const;

/** Keys of fields, stages, requirements and the definition itself. */
export const WORKFLOW_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;

export type WorkflowFieldType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "boolean"
  | "select"
  | "multiselect"
  | "email"
  | "phone"
  | "file"
  | "user";

export const WORKFLOW_FIELD_TYPES: readonly WorkflowFieldType[] = [
  "text",
  "textarea",
  "number",
  "money",
  "date",
  "boolean",
  "select",
  "multiselect",
  "email",
  "phone",
  "file",
  "user",
];

export type WorkflowConditionOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "contains"
  | "is_empty"
  | "is_not_empty"
  | "is_true"
  | "is_false";

export const WORKFLOW_CONDITION_OPS: readonly WorkflowConditionOp[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "contains",
  "is_empty",
  "is_not_empty",
  "is_true",
  "is_false",
];

/** Operators that take no `value`. */
export const VALUELESS_OPS: readonly WorkflowConditionOp[] = [
  "is_empty",
  "is_not_empty",
  "is_true",
  "is_false",
];

export const OPS_BY_FIELD_TYPE: Record<
  WorkflowFieldType,
  readonly WorkflowConditionOp[]
> = {
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  money: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  text: ["eq", "neq", "contains", "in", "not_in", "is_empty", "is_not_empty"],
  textarea: [
    "eq",
    "neq",
    "contains",
    "in",
    "not_in",
    "is_empty",
    "is_not_empty",
  ],
  email: ["eq", "neq", "contains", "in", "not_in", "is_empty", "is_not_empty"],
  phone: ["eq", "neq", "contains", "in", "not_in", "is_empty", "is_not_empty"],
  select: ["eq", "neq", "in", "not_in", "is_empty", "is_not_empty"],
  multiselect: ["contains", "is_empty", "is_not_empty"],
  boolean: ["is_true", "is_false"],
  file: ["is_empty", "is_not_empty"],
  user: ["eq", "neq", "is_empty", "is_not_empty"],
};

export interface WorkflowConditionRule {
  field: string;
  op: WorkflowConditionOp;
  value?: string | number | boolean | (string | number)[];
}

export type WorkflowConditionNode =
  | WorkflowConditionRule
  | WorkflowConditionGroup;

export type WorkflowConditionGroup =
  | { all: WorkflowConditionNode[] }
  | { any: WorkflowConditionNode[] };

export interface WorkflowFieldDef {
  key: string;
  type: WorkflowFieldType;
  label: string;
  required?: boolean;
  help?: string;
  /** select / multiselect only (required there). */
  options?: { value: string; label: string }[];
  /** file only: mime types or `type/*`. */
  accept?: string[];
  /** file only: 1..25. */
  max_size_mb?: number;
  visible_when?: WorkflowConditionGroup;
  /**
   * P2.9: calculated field. A closed, safe expression (see
   * `evaluateExpression` in workflow-expression.ts): arithmetic, comparisons,
   * text and date functions over other fields. Read-only in forms; the engine
   * recomputes it on every write. Types number, money, text and date only.
   */
  compute?: string;
}

export type WorkflowStageType =
  | "form"
  | "approval"
  | "review"
  | "automatic"
  | "parallel"
  | "subflow"
  | "wait"
  | "loop"
  | "end";

export const WORKFLOW_STAGE_TYPES: readonly WorkflowStageType[] = [
  "form",
  "approval",
  "review",
  "automatic",
  "parallel",
  "subflow",
  "wait",
  "loop",
  "end",
];

/**
 * Outcomes each stage type resolves with (the `on` of its transitions).
 * parallel → `joined` when its join rule is met; subflow → `completed` when
 * every child completed (or at once when it does not wait), `rejected` when a
 * child was rejected, cancelled or failed; wait → `elapsed`; loop →
 * `continue` (another lap) or `done` (condition false or limit reached).
 */
export const STAGE_OUTCOMES: Record<WorkflowStageType, readonly string[]> = {
  form: ["submit"],
  approval: ["approve", "reject"],
  review: ["approve", "reject", "return"],
  automatic: ["auto"],
  parallel: ["joined"],
  subflow: ["completed", "rejected"],
  wait: ["elapsed"],
  loop: ["continue", "done"],
  end: [],
};

/** Stages the engine resolves by itself (no task of their own). */
export const SYSTEM_STAGE_TYPES: readonly WorkflowStageType[] = [
  "automatic",
  "subflow",
  "wait",
  "loop",
];

export const HUMAN_STAGE_TYPES: readonly WorkflowStageType[] = [
  "form",
  "approval",
  "review",
];

export type WorkflowEndOutcome = "completed" | "rejected" | "cancelled";

export const WORKFLOW_END_OUTCOMES: readonly WorkflowEndOutcome[] = [
  "completed",
  "rejected",
  "cancelled",
];

export type WorkflowAssigneeDef =
  | { kind: "initiator" }
  | { kind: "role"; role_key: string }
  | {
      kind: "group";
      group_key: string;
      /** Default 'any': any member may claim the task. */
      strategy?: "any" | "round_robin" | "least_load";
    }
  | { kind: "user"; user_id: number }
  /** `field` must be declared with type 'user'. */
  | { kind: "field"; field: string };

/** Approval stages only: N approvals from distinct people; one reject rejects. */
export interface WorkflowQuorumDef {
  required: number;
}

export interface WorkflowDueDef {
  /** 1..8760 */
  hours: number;
  on_overdue?: {
    /** 1..720 */
    remind_every_hours?: number;
    escalate_to?: WorkflowAssigneeDef;
  };
}

/** P2.1: one branch of a parallel stage = one human task, all at once. */
export interface WorkflowBranchDef {
  key: string;
  name: string;
  assignee: WorkflowAssigneeDef;
  /** Fields the branch fills when it submits (declared fields). */
  form?: { fields: string[] };
}

export type WorkflowJoinRule = "all" | "any" | "n_of_m";

export interface WorkflowParallelDef {
  /** 2..maxBranches */
  branches: WorkflowBranchDef[];
  /** all: every branch; any: the first; n_of_m: `required` branches. */
  join: WorkflowJoinRule;
  /** n_of_m only: 1..branches.length. */
  required?: number;
}

/** P2.2: a child request of another published flow of the store. */
export interface WorkflowSubflowChildDef {
  /** Key of the child flow definition. */
  flow_key: string;
  /** Child field ← template with `{{fields.*}}` / `{{instance.*}}` of the parent. */
  map?: Record<string, string>;
}

export interface WorkflowSubflowDef {
  /** 1..maxSubflows children started together. */
  flows: WorkflowSubflowChildDef[];
  /** Default true: the stage waits until every child closes. */
  wait?: boolean;
  /**
   * Waiting only: parent field ← `"<flow_key>.<child field>"`, copied when the
   * children complete.
   */
  output?: Record<string, string>;
}

/** P2.3: when a wait stage resumes. Times are HH:mm in the store's time zone. */
export type WorkflowWaitDef =
  | { kind: "duration"; days?: number; hours?: number; minutes?: number }
  | { kind: "date"; date: string; time?: string }
  /** A date field of the request, plus `offset_days` (may be negative). */
  | { kind: "field"; field: string; offset_days?: number; time?: string }
  /** N business days (Mon–Fri, Colombian holidays excluded). */
  | { kind: "business_days"; days: number; time?: string }
  /** Next occurrence of day `day` (1..28) of a month. */
  | { kind: "day_of_month"; day: number; time?: string };

export const WORKFLOW_WAIT_KINDS = [
  "duration",
  "date",
  "field",
  "business_days",
  "day_of_month",
] as const;

/** P2.4: repeats while `while` holds, never more than `max_iterations` laps. */
export interface WorkflowLoopDef {
  while: WorkflowConditionGroup;
  /** Required hard limit: 1..maxLoopIterations. */
  max_iterations: number;
}

/**
 * P2.5: checked before the stage resolves with a forward outcome. When `when`
 * holds the guard fires: it blocks with `message` or, with `redirect_to`,
 * sends the request to that stage instead.
 */
export interface WorkflowGuardDef {
  when: WorkflowConditionGroup;
  message: string;
  redirect_to?: string;
}

/** P2.7: what happens when a `vendix.*` action fails. */
export interface WorkflowActionErrorPolicy {
  /** Retries with exponential backoff before giving up: 0..maxActionRetries. Default maxActionRetries. */
  retries?: number;
  /**
   * After the last retry: `continue` (record and alert, default), `route` (go
   * to `route_to`) or `fail` (the request ends as failed). Always alerts the
   * flow owner and can be retried by hand.
   */
  then?: "continue" | "route" | "fail";
  route_to?: string;
}

export const WORKFLOW_ERROR_THEN = ["continue", "route", "fail"] as const;

export interface WorkflowTransitionDef {
  to: string;
  on: string;
  /** Absent = default branch. */
  when?: WorkflowConditionGroup;
  require_comment?: boolean;
  label?: string;
}

export type WorkflowRequirementDef =
  | {
      kind: "upload";
      key: string;
      label: string;
      accept?: string[];
      max_size_mb?: number;
      /** Default true. */
      blocks_exit?: boolean;
    }
  | { kind: "file_field"; key: string; label: string; field: string }
  | {
      kind: "issued_document";
      key: string;
      label: string;
      template_key: string;
      auto_issue_on_enter?: boolean;
    }
  | {
      kind: "signature";
      key: string;
      label: string;
      /** Key of an issued_document requirement in the same stage. */
      of: string;
      accept?: string[];
      /** Default true. */
      blocks_exit?: boolean;
    };

export const WORKFLOW_REQUIREMENT_KINDS = [
  "upload",
  "file_field",
  "issued_document",
  "signature",
] as const;

/**
 * Type of a catalog token or action input. `id` is a positive integer that
 * names a Vendix record; `money` and `number` are decimals; `date` is
 * YYYY-MM-DD; `enum` takes one of `values`; `assignee` is an assignee def.
 */
export type WorkflowValueType =
  | "id"
  | "int"
  | "number"
  | "money"
  | "text"
  | "date"
  | "boolean"
  | "enum"
  | "assignee";

/** One `{{event.<key>}}` variable of a business event (or a gated operation). */
export interface WorkflowCatalogToken {
  key: string;
  label: string;
  type: WorkflowValueType;
}

/** Declarative entry of the business event registry (P1.1). */
export interface WorkflowEventSpec {
  label: string;
  /** Vendix module that emits it (groups the editor list). */
  module: string;
  /** Record the instance is about when the definition's subject matches. */
  subject?: { type: WorkflowSubjectType; key: string };
  tokens: readonly WorkflowCatalogToken[];
}

const tok = (
  key: string,
  label: string,
  type: WorkflowValueType = "text",
): WorkflowCatalogToken => ({ key, label, type });

/**
 * Business event registry (P1.1). Adding an event is declaring it here and
 * emitting it with `recordTriggerEvent(tx, '<name>', payload)` inside the
 * domain transaction; the editor lists it with its variables on its own.
 * Every event carries a store id; the payload is read through `tokens` only.
 */
export const WORKFLOW_EVENT_CATALOG = {
  "order.created": {
    label: "Venta creada",
    module: "Ventas",
    subject: { type: "order", key: "order_id" },
    tokens: [
      tok("order_id", "Id de la venta", "id"),
      tok("order_number", "Número de la venta"),
      tok("grand_total", "Total", "money"),
      tok("currency", "Moneda"),
      tok("channel", "Canal"),
    ],
  },
  "order.paid": {
    label: "Venta pagada",
    module: "Ventas",
    subject: { type: "order", key: "order_id" },
    tokens: [
      tok("order_id", "Id de la venta", "id"),
      tok("payment_id", "Id del pago", "id"),
      tok("grand_total", "Total", "money"),
      tok("currency", "Moneda"),
    ],
  },
  "order.status_changed": {
    label: "Venta cambió de estado",
    module: "Ventas",
    subject: { type: "order", key: "order_id" },
    tokens: [
      tok("order_id", "Id de la venta", "id"),
      tok("order_number", "Número de la venta"),
      tok("from_state", "Estado anterior"),
      tok("to_state", "Estado nuevo"),
      tok("grand_total", "Total", "money"),
    ],
  },
  "invoice.created": {
    label: "Factura creada",
    module: "Facturación",
    subject: { type: "invoice", key: "invoice_id" },
    tokens: [
      tok("invoice_id", "Id de la factura", "id"),
      tok("invoice_number", "Número de la factura"),
      tok("invoice_type", "Tipo de documento"),
      tok("customer_name", "Cliente"),
      tok("total_amount", "Total", "money"),
    ],
  },
  "invoice.voided": {
    label: "Factura anulada",
    module: "Facturación",
    subject: { type: "invoice", key: "invoice_id" },
    tokens: [
      tok("invoice_id", "Id de la factura", "id"),
      tok("invoice_number", "Número de la factura"),
      tok("total_amount", "Total", "money"),
      tok("reason", "Motivo"),
    ],
  },
  "credit_note.created": {
    label: "Nota crédito creada",
    module: "Facturación",
    subject: { type: "invoice", key: "credit_note_id" },
    tokens: [
      tok("credit_note_id", "Id de la nota crédito", "id"),
      tok("invoice_number", "Número de la nota"),
      tok("related_invoice_id", "Id de la factura origen", "id"),
      tok("total_amount", "Total", "money"),
      tok("reason", "Motivo"),
    ],
  },
  "supplier_payment.registered": {
    label: "Pago a proveedor registrado",
    module: "Pagos",
    subject: { type: "purchase_order", key: "purchase_order_id" },
    tokens: [
      tok("payment_id", "Id del pago", "id"),
      tok("purchase_order_id", "Id de la orden de compra", "id"),
      tok("supplier_id", "Id del proveedor", "id"),
      tok("amount", "Monto", "money"),
      tok("payment_method", "Medio de pago"),
    ],
  },
  "payable.payment_registered": {
    label: "Abono a cuenta por pagar",
    module: "Pagos",
    tokens: [
      tok("payable_id", "Id de la cuenta por pagar", "id"),
      tok("payment_id", "Id del abono", "id"),
      tok("supplier_id", "Id del proveedor", "id"),
      tok("amount", "Monto", "money"),
      tok("status", "Estado de la cuenta"),
    ],
  },
  "purchase_order.created": {
    label: "Orden de compra creada",
    module: "Compras",
    subject: { type: "purchase_order", key: "purchase_order_id" },
    tokens: [
      tok("purchase_order_id", "Id de la orden de compra", "id"),
      tok("order_number", "Número de la orden"),
      tok("supplier_id", "Id del proveedor", "id"),
      tok("total_amount", "Total", "money"),
    ],
  },
  "purchase_order.approved": {
    label: "Orden de compra aprobada",
    module: "Compras",
    subject: { type: "purchase_order", key: "purchase_order_id" },
    tokens: [
      tok("purchase_order_id", "Id de la orden de compra", "id"),
      tok("order_number", "Número de la orden"),
      tok("supplier_id", "Id del proveedor", "id"),
      tok("total_amount", "Total", "money"),
    ],
  },
  "purchase_order.received": {
    label: "Orden de compra recibida",
    module: "Recepciones",
    subject: { type: "purchase_order", key: "purchase_order_id" },
    tokens: [
      tok("purchase_order_id", "Id de la orden de compra", "id"),
      tok("supplier_id", "Id del proveedor", "id"),
      tok("total_amount", "Valor recibido", "money"),
    ],
  },
  "expense.created": {
    label: "Gasto registrado",
    module: "Gastos",
    subject: { type: "expense", key: "expense_id" },
    tokens: [
      tok("expense_id", "Id del gasto", "id"),
      tok("amount", "Monto", "money"),
      tok("category_id", "Id de la categoría", "id"),
      tok("description", "Descripción"),
    ],
  },
  "expense.approved": {
    label: "Gasto aprobado",
    module: "Gastos",
    subject: { type: "expense", key: "expense_id" },
    tokens: [
      tok("expense_id", "Id del gasto", "id"),
      tok("amount", "Monto", "money"),
      tok("category_id", "Id de la categoría", "id"),
    ],
  },
  "expense.paid": {
    label: "Gasto pagado",
    module: "Gastos",
    subject: { type: "expense", key: "expense_id" },
    tokens: [
      tok("expense_id", "Id del gasto", "id"),
      tok("amount", "Monto", "money"),
      tok("category_id", "Id de la categoría", "id"),
    ],
  },
  "payroll_run.approved": {
    label: "Nómina aprobada",
    module: "Nómina",
    subject: { type: "payroll_run", key: "payroll_run_id" },
    tokens: [
      tok("payroll_run_id", "Id de la nómina", "id"),
      tok("payroll_number", "Número de la nómina"),
      tok("total_net", "Neto a pagar", "money"),
      tok("period_start", "Inicio del periodo", "date"),
      tok("period_end", "Fin del periodo", "date"),
    ],
  },
  "payroll_run.paid": {
    label: "Nómina pagada",
    module: "Nómina",
    subject: { type: "payroll_run", key: "payroll_run_id" },
    tokens: [
      tok("payroll_run_id", "Id de la nómina", "id"),
      tok("payroll_number", "Número de la nómina"),
      tok("total_net", "Neto pagado", "money"),
    ],
  },
  "inventory.adjusted": {
    label: "Ajuste de inventario",
    module: "Inventario",
    tokens: [
      tok("adjustment_id", "Id del ajuste", "id"),
      tok("product_id", "Id del producto", "id"),
      tok("location_id", "Id de la bodega", "id"),
      tok("quantity_change", "Cambio de cantidad", "number"),
      tok("adjustment_type", "Tipo de ajuste"),
    ],
  },
  "inventory.transferred": {
    label: "Traslado de inventario completado",
    module: "Inventario",
    tokens: [
      tok("transfer_id", "Id del traslado", "id"),
      tok("transfer_number", "Número del traslado"),
      tok("from_location_id", "Id de la bodega origen", "id"),
      tok("to_location_id", "Id de la bodega destino", "id"),
    ],
  },
  "stock.low": {
    label: "Stock bajo",
    module: "Inventario",
    tokens: [
      tok("product_id", "Id del producto", "id"),
      tok("product_name", "Producto"),
      tok("location_id", "Id de la bodega", "id"),
      tok("quantity_available", "Disponible", "number"),
      tok("reorder_point", "Punto de reorden", "number"),
    ],
  },
  "journal_entry.posted": {
    label: "Asiento contable contabilizado",
    module: "Contabilidad",
    tokens: [
      tok("journal_entry_id", "Id del asiento", "id"),
      tok("entry_number", "Número del asiento"),
      tok("entry_type", "Tipo de asiento"),
      tok("total_debit", "Total débito", "money"),
    ],
  },
  "fiscal_period.closed": {
    label: "Periodo contable cerrado",
    module: "Contabilidad",
    tokens: [
      tok("fiscal_period_id", "Id del periodo", "id"),
      tok("name", "Periodo"),
      tok("end_date", "Fecha de cierre", "date"),
    ],
  },
  "cash_session.opened": {
    label: "Caja abierta",
    module: "Caja",
    tokens: [
      tok("session_id", "Id de la sesión", "id"),
      tok("register_id", "Id de la caja", "id"),
      tok("user_id", "Id del cajero", "id"),
      tok("opening_amount", "Base de apertura", "money"),
    ],
  },
  "cash_session.closed": {
    label: "Caja cerrada",
    module: "Caja",
    tokens: [
      tok("session_id", "Id de la sesión", "id"),
      tok("register_id", "Id de la caja", "id"),
      tok("user_id", "Id del cajero", "id"),
      tok("closing_amount", "Monto contado", "money"),
      tok("difference", "Diferencia", "money"),
    ],
  },
  "customer.created": {
    label: "Cliente creado",
    module: "Clientes",
    subject: { type: "customer", key: "customer_id" },
    tokens: [
      tok("customer_id", "Id del cliente", "id"),
      tok("first_name", "Nombre"),
      tok("last_name", "Apellido"),
      tok("email", "Correo"),
    ],
  },
  "supplier.created": {
    label: "Proveedor creado",
    module: "Proveedores",
    subject: { type: "supplier", key: "supplier_id" },
    tokens: [
      tok("supplier_id", "Id del proveedor", "id"),
      tok("name", "Nombre"),
      tok("tax_id", "NIT"),
      tok("email", "Correo"),
    ],
  },
  "employee.created": {
    label: "Empleado creado",
    module: "Empleados",
    subject: { type: "employee", key: "employee_id" },
    tokens: [
      tok("employee_id", "Id del empleado", "id"),
      tok("first_name", "Nombre"),
      tok("last_name", "Apellido"),
      tok("document_number", "Documento"),
      tok("position", "Cargo"),
    ],
  },
  "booking.created": {
    label: "Reserva creada",
    module: "Reservas",
    tokens: [
      tok("booking_id", "Id de la reserva", "id"),
      tok("booking_number", "Número de la reserva"),
      tok("customer_id", "Id del cliente", "id"),
      tok("date", "Fecha", "date"),
      tok("start_time", "Hora de inicio"),
    ],
  },
  "pqr.created": {
    label: "PQR recibida",
    module: "PQR",
    tokens: [
      tok("ticket_id", "Id del ticket", "id"),
      tok("ticket_number", "Número del ticket"),
      tok("title", "Asunto"),
      tok("description", "Descripción"),
      tok("category", "Categoría"),
      tok("contact_name", "Nombre del contacto"),
      tok("contact_email", "Correo del contacto"),
    ],
  },
} as const satisfies Record<string, WorkflowEventSpec>;

export type WorkflowTriggerEvent = keyof typeof WORKFLOW_EVENT_CATALOG;

/** Every registered business event (order of the registry). */
export const WORKFLOW_TRIGGER_EVENTS = Object.keys(
  WORKFLOW_EVENT_CATALOG,
) as readonly WorkflowTriggerEvent[];

/**
 * Closed catalog of `{{event.<key>}}` tokens per event. The producer builds a
 * flat context with exactly these keys, so nothing else of the payload is ever
 * reachable from a definition.
 */
export const WORKFLOW_EVENT_TOKENS = Object.fromEntries(
  WORKFLOW_TRIGGER_EVENTS.map((e) => [
    e,
    (WORKFLOW_EVENT_CATALOG[e].tokens as readonly WorkflowCatalogToken[]).map(
      (t) => t.key,
    ),
  ]),
) as unknown as Record<WorkflowTriggerEvent, readonly string[]>;

/** One input of a Vendix action. */
export interface WorkflowActionInputSpec {
  label: string;
  type: WorkflowValueType;
  required?: boolean;
  /** `int` / `number` / `money`: minimum literal value. */
  min?: number;
  /** `enum` only. */
  values?: readonly string[];
}

/** Declarative entry of the Vendix action registry (P1.2). */
export interface WorkflowActionSpec {
  label: string;
  module: string;
  /** Store permission the publisher must hold (the same as the UI route). */
  permission: string;
  /**
   * What a retry may do (P1.2). `replay_safe`: running it again leaves the
   * same result (field updates, tags). `at_most_once`: it creates a record,
   * moves money or stock, sends something or changes a state; the executor
   * marks it started before the effect, and a run interrupted after that mark
   * fails on the timeline instead of repeating the effect.
   */
  idempotency: WorkflowActionIdempotency;
  inputs: Record<string, WorkflowActionInputSpec>;
}

export type WorkflowActionIdempotency = "replay_safe" | "at_most_once";

const inId = (label: string, required = true): WorkflowActionInputSpec => ({
  label,
  type: "id",
  required,
});
const inText = (label: string, required = false): WorkflowActionInputSpec => ({
  label,
  type: "text",
  required,
});
const inMoney = (label: string, required = true): WorkflowActionInputSpec => ({
  label,
  type: "money",
  required,
  min: 0,
});

/**
 * Vendix action registry (P1.2). Each action runs through the SAME domain
 * service the UI uses, acting as the publisher of the flow version, who must
 * hold `permission`. The engine writes it to the outbox; the executor stores
 * the result so a retry never repeats the effect. An action declared here
 * without an executor fails the registry spec (R1).
 */
export const WORKFLOW_ACTION_CATALOG = {
  "vendix.customer.create": {
    label: "Crear cliente",
    module: "Clientes",
    permission: "store:customers:create",
    idempotency: "at_most_once",
    inputs: {
      first_name: inText("Nombre", true),
      last_name: inText("Apellido", true),
      email: inText("Correo", true),
      phone: inText("Teléfono"),
      document_type: inText("Tipo de documento"),
      document_number: inText("Número de documento"),
    },
  },
  "vendix.customer.update": {
    label: "Actualizar cliente",
    module: "Clientes",
    permission: "store:customers:update",
    idempotency: "replay_safe",
    inputs: {
      customer_id: inId("Cliente"),
      first_name: inText("Nombre"),
      last_name: inText("Apellido"),
      phone: inText("Teléfono"),
    },
  },
  "vendix.customer.add_tag": {
    label: "Asignar etiqueta al cliente",
    module: "Clientes",
    permission: "store:customers:update",
    idempotency: "replay_safe",
    inputs: {
      customer_id: inId("Cliente"),
      tag_id: inId("Etiqueta"),
    },
  },
  "vendix.supplier.create": {
    label: "Crear proveedor",
    module: "Proveedores",
    permission: "store:inventory:suppliers:create",
    idempotency: "at_most_once",
    inputs: {
      name: inText("Nombre", true),
      tax_id: inText("NIT"),
      email: inText("Correo"),
      phone: inText("Teléfono"),
      contact_person: inText("Persona de contacto"),
    },
  },
  "vendix.supplier.update": {
    label: "Actualizar proveedor",
    module: "Proveedores",
    permission: "store:inventory:suppliers:update",
    idempotency: "replay_safe",
    inputs: {
      supplier_id: inId("Proveedor"),
      name: inText("Nombre"),
      email: inText("Correo"),
      phone: inText("Teléfono"),
      contact_person: inText("Persona de contacto"),
    },
  },
  "vendix.employee.create": {
    label: "Crear empleado",
    module: "Empleados",
    permission: "store:payroll:employees:create",
    idempotency: "at_most_once",
    inputs: {
      first_name: inText("Nombre", true),
      last_name: inText("Apellido", true),
      document_type: inText("Tipo de documento", true),
      document_number: inText("Número de documento", true),
      hire_date: { label: "Fecha de ingreso", type: "date", required: true },
      base_salary: inMoney("Salario base"),
      position: inText("Cargo"),
      email: inText("Correo"),
    },
  },
  "vendix.employee.update": {
    label: "Actualizar empleado",
    module: "Empleados",
    permission: "store:payroll:employees:update",
    idempotency: "replay_safe",
    inputs: {
      employee_id: inId("Empleado"),
      position: inText("Cargo"),
      base_salary: inMoney("Salario base", false),
      email: inText("Correo"),
      phone: inText("Teléfono"),
    },
  },
  "vendix.expense.create": {
    label: "Crear gasto",
    module: "Gastos",
    permission: "store:expenses:create",
    idempotency: "at_most_once",
    inputs: {
      amount: inMoney("Monto"),
      category_id: inId("Categoría", false),
      description: inText("Descripción", true),
      expense_date: { label: "Fecha del gasto", type: "date" },
    },
  },
  "vendix.expense.approve": {
    label: "Aprobar gasto",
    module: "Gastos",
    permission: "store:expenses:approve",
    idempotency: "at_most_once",
    inputs: { expense_id: inId("Gasto") },
  },
  "vendix.expense.pay": {
    label: "Marcar gasto como pagado",
    module: "Gastos",
    permission: "store:expenses:pay",
    idempotency: "at_most_once",
    inputs: { expense_id: inId("Gasto") },
  },
  "vendix.purchase_order.create_draft": {
    label: "Crear orden de compra (borrador)",
    module: "Compras",
    permission: "store:orders:purchase_orders:create",
    idempotency: "at_most_once",
    inputs: {
      supplier_id: inId("Proveedor"),
      location_id: inId("Bodega"),
      product_id: inId("Producto"),
      quantity: { label: "Cantidad", type: "int", required: true, min: 1 },
      unit_price: inMoney("Precio unitario"),
      notes: inText("Notas"),
      expected_date: { label: "Fecha esperada", type: "date" },
    },
  },
  "vendix.purchase_order.approve": {
    label: "Aprobar orden de compra",
    module: "Compras",
    permission: "store:orders:purchase_orders:approve",
    idempotency: "at_most_once",
    inputs: { purchase_order_id: inId("Orden de compra") },
  },
  "vendix.purchase_order.cancel": {
    label: "Anular orden de compra",
    module: "Compras",
    permission: "store:orders:purchase_orders:cancel",
    idempotency: "at_most_once",
    inputs: {
      purchase_order_id: inId("Orden de compra"),
      reason: inText("Motivo"),
    },
  },
  "vendix.purchase_order.register_payment": {
    label: "Registrar pago a proveedor",
    module: "Pagos",
    permission: "store:orders:purchase_orders:pay",
    idempotency: "at_most_once",
    inputs: {
      purchase_order_id: inId("Orden de compra"),
      amount: inMoney("Monto"),
      payment_method: inText("Medio de pago", true),
      reference: inText("Referencia"),
    },
  },
  "vendix.payable.register_payment": {
    label: "Abonar a cuenta por pagar",
    module: "Pagos",
    permission: "store:accounts_payable:payment",
    idempotency: "at_most_once",
    inputs: {
      payable_id: inId("Cuenta por pagar"),
      amount: inMoney("Monto"),
      payment_method: inText("Medio de pago", true),
      reference: inText("Referencia"),
    },
  },
  "vendix.inventory.adjust": {
    label: "Ajuste de inventario",
    module: "Inventario",
    permission: "store:inventory:adjustments:create",
    idempotency: "at_most_once",
    inputs: {
      product_id: inId("Producto"),
      location_id: inId("Bodega"),
      quantity_after: {
        label: "Cantidad final",
        type: "int",
        required: true,
        min: 0,
      },
      adjustment_type: {
        label: "Tipo de ajuste",
        type: "enum",
        required: true,
        values: [
          "damage",
          "loss",
          "theft",
          "expiration",
          "count_variance",
          "manual_correction",
        ],
      },
      reason: inText("Motivo"),
    },
  },
  "vendix.inventory.transfer": {
    label: "Traslado de inventario (borrador)",
    module: "Inventario",
    permission: "store:stock-transfers:create",
    idempotency: "at_most_once",
    inputs: {
      from_location_id: inId("Bodega origen"),
      to_location_id: inId("Bodega destino"),
      product_id: inId("Producto"),
      quantity: { label: "Cantidad", type: "int", required: true, min: 1 },
      notes: inText("Notas"),
    },
  },
  "vendix.invoice.create_from_order": {
    label: "Crear factura desde una venta",
    module: "Facturación",
    permission: "invoicing:write",
    idempotency: "at_most_once",
    inputs: { order_id: inId("Venta") },
  },
  "vendix.credit_note.create": {
    label: "Crear nota crédito (total)",
    module: "Facturación",
    permission: "invoicing:write",
    idempotency: "at_most_once",
    inputs: {
      invoice_id: inId("Factura"),
      reason: inText("Motivo", true),
    },
  },
  "vendix.invoice.send_email": {
    label: "Enviar factura por correo",
    module: "Facturación",
    permission: "invoicing:write",
    idempotency: "at_most_once",
    inputs: {
      invoice_id: inId("Factura"),
      email: inText("Correo (opcional: el del cliente)"),
    },
  },
  "vendix.order.register_payment": {
    label: "Registrar pago de una venta",
    module: "Pagos",
    permission: "store:orders:order_flow:create",
    idempotency: "at_most_once",
    inputs: {
      order_id: inId("Venta"),
      store_payment_method_id: inId("Medio de pago de la tienda"),
      amount: inMoney("Monto"),
      reference: inText("Referencia"),
    },
  },
  "vendix.order.change_status": {
    label: "Cambiar estado de una venta",
    module: "Ventas",
    permission: "store:orders:order_flow:create",
    idempotency: "at_most_once",
    inputs: {
      order_id: inId("Venta"),
      to_state: {
        label: "Estado nuevo",
        type: "enum",
        required: true,
        values: ["shipped", "delivered", "cancelled"],
      },
      reason: inText("Motivo (anulación)"),
    },
  },
  "vendix.booking.confirm": {
    label: "Confirmar reserva",
    module: "Reservas",
    permission: "store:reservations:update",
    idempotency: "at_most_once",
    inputs: { booking_id: inId("Reserva") },
  },
  "vendix.crm_task.create": {
    label: "Crear tarea CRM",
    module: "CRM",
    permission: "store:crm_tasks:manage",
    idempotency: "at_most_once",
    inputs: {
      title: inText("Título", true),
      description: inText("Descripción"),
      due_in_days: { label: "Vence en (días)", type: "int", min: 0 },
      assignee: { label: "Responsable", type: "assignee" },
    },
  },
} as const satisfies Record<string, WorkflowActionSpec>;

/** Actions the engine writes to the outbox instead of running inline. */
export type WorkflowVendixActionName = keyof typeof WORKFLOW_ACTION_CATALOG;

export const WORKFLOW_VENDIX_ACTIONS = Object.keys(
  WORKFLOW_ACTION_CATALOG,
) as readonly WorkflowVendixActionName[];

export const WORKFLOW_ACTIONS = [
  "notify",
  "set_field",
  ...WORKFLOW_VENDIX_ACTIONS,
] as const;

/** Required and optional `map` keys of each Vendix action (from the registry). */
export const WORKFLOW_VENDIX_ACTION_MAP_KEYS = Object.fromEntries(
  WORKFLOW_VENDIX_ACTIONS.map((name) => {
    const inputs = WORKFLOW_ACTION_CATALOG[name].inputs as Record<
      string,
      WorkflowActionInputSpec
    >;
    const keys = Object.keys(inputs);
    return [
      name,
      {
        required: keys.filter((k) => inputs[k].required === true),
        optional: keys.filter((k) => inputs[k].required !== true),
      },
    ];
  }),
) as unknown as Record<
  WorkflowVendixActionName,
  { required: readonly string[]; optional: readonly string[] }
>;

/**
 * `map` of a Vendix action: a literal (string, number, boolean) or a string
 * with `{{tokens}}` of the closed catalog (`{{fields.<field>}}` and
 * WORKFLOW_INSTANCE_TOKENS); an `assignee` input is an assignee definition.
 */
export type WorkflowActionMapValue =
  | string
  | number
  | boolean
  | WorkflowAssigneeDef;

export type WorkflowActionDef =
  | { action: "notify"; to: WorkflowAssigneeDef; message: string }
  | {
      action: "set_field";
      field: string;
      value: string | number | boolean | null;
    }
  | {
      action: WorkflowVendixActionName;
      map: Record<string, WorkflowActionMapValue>;
      on_error?: WorkflowActionErrorPolicy;
    };

/** P2.6: every hook point of a stage, in the order they run. */
export const WORKFLOW_HOOK_POINTS = [
  "on_submit",
  "on_complete",
  "on_exit",
  "on_enter",
] as const;
export type WorkflowHookPoint = (typeof WORKFLOW_HOOK_POINTS)[number];

/**
 * Tokens usable in action maps: `{{fields.<declared field>}}` plus these.
 * `instance.subject_id` is the id of the record the request is about (the
 * gated purchase order, the customer of the event…), empty when there is none.
 */
export const WORKFLOW_INSTANCE_TOKENS: readonly string[] = [
  "instance.reference",
  "instance.title",
  "instance.subject_id",
];

/** Declarative entry of the governable operations (approval gate, P1.3). */
export interface WorkflowGateOperationSpec {
  label: string;
  module: string;
  /** What `min_amount` is compared with. */
  amount_label: string;
  /**
   * `hold`: the record exists and the operation waits (approve a purchase
   * order); a rejection voids the record. `defer`: nothing is created until
   * the request is approved, then the operation runs as the requester.
   */
  mode: "hold" | "defer";
  subject: WorkflowSubjectType;
  tokens: readonly WorkflowCatalogToken[];
}

/**
 * Governable operations (P1.3). A definition with `governs` holds the
 * operation while its request is open; the domain service enforces it, so no
 * route (UI, API, AI, another flow) can run a pending operation.
 */
export const WORKFLOW_GATE_OPERATIONS = {
  "purchase_order.approve": {
    label: "Compras: aprobar orden de compra",
    module: "Compras",
    amount_label: "Total de la orden",
    mode: "hold",
    subject: "purchase_order",
    tokens: [
      tok("purchase_order_id", "Id de la orden de compra", "id"),
      tok("order_number", "Número de la orden"),
      tok("supplier_id", "Id del proveedor", "id"),
      tok("supplier_name", "Proveedor"),
      tok("total_amount", "Total", "money"),
      tok("products", "Productos"),
      tok("requested_by", "Solicitado por"),
    ],
  },
  "expense.approve": {
    label: "Gastos: aprobar gasto",
    module: "Gastos",
    amount_label: "Monto del gasto",
    mode: "hold",
    subject: "expense",
    tokens: [
      tok("expense_id", "Id del gasto", "id"),
      tok("amount", "Monto", "money"),
      tok("category_name", "Categoría"),
      tok("description", "Descripción"),
      tok("requested_by", "Solicitado por"),
    ],
  },
  "inventory_adjustment.create": {
    label: "Inventario: ajuste de inventario",
    module: "Inventario",
    amount_label: "Unidades ajustadas (valor absoluto)",
    mode: "defer",
    subject: "none",
    tokens: [
      tok("product_id", "Id del producto", "id"),
      tok("product_name", "Producto"),
      tok("location_id", "Id de la bodega", "id"),
      tok("quantity_change", "Cambio de cantidad", "number"),
      tok("quantity_after", "Cantidad final", "number"),
      tok("adjustment_type", "Tipo de ajuste"),
      tok("reason", "Motivo"),
      tok("requested_by", "Solicitado por"),
    ],
  },
  "credit_note.create": {
    label: "Facturación: nota crédito",
    module: "Facturación",
    amount_label: "Total de la nota",
    mode: "defer",
    subject: "invoice",
    tokens: [
      tok("invoice_id", "Id de la factura", "id"),
      tok("invoice_number", "Número de la factura"),
      tok("total_amount", "Total de la nota", "money"),
      tok("reason", "Motivo"),
      tok("requested_by", "Solicitado por"),
    ],
  },
  "invoice.void": {
    label: "Facturación: anular factura",
    module: "Facturación",
    amount_label: "Total de la factura",
    mode: "defer",
    subject: "invoice",
    tokens: [
      tok("invoice_id", "Id de la factura", "id"),
      tok("invoice_number", "Número de la factura"),
      tok("total_amount", "Total", "money"),
      tok("reason", "Motivo"),
      tok("requested_by", "Solicitado por"),
    ],
  },
  "order.discount": {
    label: "Ventas: descuento sobre el umbral",
    module: "Ventas",
    amount_label: "Valor del descuento",
    mode: "defer",
    subject: "order",
    tokens: [
      tok("order_id", "Id de la venta", "id"),
      tok("order_number", "Número de la venta"),
      tok("discount_amount", "Descuento", "money"),
      tok("grand_total", "Total", "money"),
      tok("requested_by", "Solicitado por"),
    ],
  },
  "supplier_payment.register": {
    label: "Pagos: pago a proveedor",
    module: "Pagos",
    amount_label: "Monto del pago",
    mode: "defer",
    subject: "purchase_order",
    tokens: [
      tok("purchase_order_id", "Id de la orden de compra", "id"),
      tok("payable_id", "Id de la cuenta por pagar", "id"),
      tok("supplier_id", "Id del proveedor", "id"),
      tok("amount", "Monto", "money"),
      tok("payment_method", "Medio de pago"),
      tok("requested_by", "Solicitado por"),
    ],
  },
  "payroll_run.approve": {
    label: "Nómina: aprobar liquidación de nómina",
    module: "Nómina",
    amount_label: "Neto de la nómina",
    mode: "hold",
    subject: "payroll_run",
    tokens: [
      tok("payroll_run_id", "Id de la nómina", "id"),
      tok("payroll_number", "Número de la nómina"),
      tok("total_net", "Neto a pagar", "money"),
      tok("period_start", "Inicio del periodo", "date"),
      tok("period_end", "Fin del periodo", "date"),
      tok("requested_by", "Solicitado por"),
    ],
  },
} as const satisfies Record<string, WorkflowGateOperationSpec>;

export type WorkflowGateOperation = keyof typeof WORKFLOW_GATE_OPERATIONS;

export const WORKFLOW_GATE_OPERATION_KEYS = Object.keys(
  WORKFLOW_GATE_OPERATIONS,
) as readonly WorkflowGateOperation[];

/** `{{event.<key>}}` tokens of a governed operation. */
export function gateOperationTokens(op: WorkflowGateOperation): string[] {
  return (
    WORKFLOW_GATE_OPERATIONS[op].tokens as readonly WorkflowCatalogToken[]
  ).map((t) => t.key);
}

/**
 * "This flow governs: <operation> from <min_amount>". The request starts as
 * actor `system` with `map` filling declared fields from `{{event.<key>}}`
 * tokens of the operation; an end stage `completed` releases the operation,
 * `rejected` voids it (hold) or drops it (defer).
 */
export interface WorkflowGovernsDef {
  operation: WorkflowGateOperation;
  /** Operations with an amount below this are not held. Default 0. */
  min_amount?: number;
  map?: Record<string, string>;
}

export interface WorkflowStageDef {
  key: string;
  name: string;
  type: WorkflowStageType;
  description?: string;
  start?: boolean;
  /** End stages only (required there). */
  outcome?: WorkflowEndOutcome;
  assignee?: WorkflowAssigneeDef;
  quorum?: WorkflowQuorumDef;
  form?: { fields: string[] };
  requirements?: WorkflowRequirementDef[];
  transitions?: WorkflowTransitionDef[];
  due?: WorkflowDueDef;
  /** Runs when the request enters the stage. */
  on_enter?: WorkflowActionDef[];
  /** P2.6: runs when a person submits the stage (outcome submit / approve). */
  on_submit?: WorkflowActionDef[];
  /** P2.6: runs when the stage resolves, whatever the outcome. */
  on_complete?: WorkflowActionDef[];
  /** Runs when the request leaves the stage (not on a forced move). */
  on_exit?: WorkflowActionDef[];
  /** P2.5 */
  guards?: WorkflowGuardDef[];
  /** P2.1: `parallel` stages only (required there). */
  parallel?: WorkflowParallelDef;
  /** P2.2: `subflow` stages only (required there). */
  subflow?: WorkflowSubflowDef;
  /** P2.3: `wait` stages only (required there). */
  wait?: WorkflowWaitDef;
  /** P2.4: `loop` stages only (required there). */
  loop?: WorkflowLoopDef;
}

export type WorkflowTriggerDef =
  | { kind: "manual" }
  /** Public form by link: `stage`, when present, must be the start stage. */
  | { kind: "public_form"; stage?: string }
  /**
   * A business event starts the flow as actor `system`. `map` fills declared
   * fields from `{{event.<path>}}` tokens (or literals). The start form is not
   * auto-submitted, so the start stage cannot be assigned to the `initiator`.
   */
  | {
      kind: "event";
      event: WorkflowTriggerEvent;
      map?: Record<string, string>;
    }
  /**
   * P2.10: starts the flow as actor `system` on a 5-field cron expression
   * (minute hour day-of-month month day-of-week) in the store's time zone.
   */
  | { kind: "schedule"; cron: string };

export type WorkflowSubjectType =
  | "none"
  | "customer"
  | "supplier"
  | "employee"
  | "order"
  | "purchase_order"
  | "expense"
  | "invoice"
  | "payroll_run";

export const WORKFLOW_SUBJECT_TYPES: readonly WorkflowSubjectType[] = [
  "none",
  "customer",
  "supplier",
  "employee",
  "order",
  "purchase_order",
  "expense",
  "invoice",
  "payroll_run",
];

export interface WorkflowDefinitionV1 {
  schema: typeof WORKFLOW_SCHEMA_V1;
  key: string;
  name: string;
  description?: string;
  subject?: { type: WorkflowSubjectType };
  fields: WorkflowFieldDef[];
  stages: WorkflowStageDef[];
  triggers?: WorkflowTriggerDef[];
  /** Approval gate (P1.3): the operation this flow governs. */
  governs?: WorkflowGovernsDef;
  start_roles?: string[];
}

/** JSON Schema (draft 2020-12). Documents the structure; the validator is the authority. */
export const WORKFLOW_V1_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://vendix.com/schemas/vendix.workflow/v1.json",
  title: "vendix.workflow/v1",
  type: "object",
  additionalProperties: false,
  required: ["schema", "key", "name", "fields", "stages"],
  properties: {
    schema: { const: WORKFLOW_SCHEMA_V1 },
    key: { $ref: "#/$defs/key" },
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 2000 },
    subject: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: { type: { enum: [...WORKFLOW_SUBJECT_TYPES] } },
    },
    fields: {
      type: "array",
      maxItems: WORKFLOW_LIMITS.maxFields,
      items: { $ref: "#/$defs/field" },
    },
    stages: {
      type: "array",
      minItems: 2,
      maxItems: WORKFLOW_LIMITS.maxStages,
      items: { $ref: "#/$defs/stage" },
    },
    triggers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        oneOf: [
          {
            additionalProperties: false,
            required: ["kind"],
            properties: { kind: { const: "manual" } },
          },
          {
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: { const: "public_form" },
              stage: { $ref: "#/$defs/key" },
            },
          },
          {
            additionalProperties: false,
            required: ["kind", "event"],
            properties: {
              kind: { const: "event" },
              event: { enum: [...WORKFLOW_TRIGGER_EVENTS] },
              map: {
                type: "object",
                additionalProperties: { type: "string", maxLength: 500 },
              },
            },
          },
          {
            additionalProperties: false,
            required: ["kind", "cron"],
            properties: {
              kind: { const: "schedule" },
              cron: { type: "string", minLength: 9, maxLength: 120 },
            },
          },
        ],
      },
    },
    governs: {
      type: "object",
      additionalProperties: false,
      required: ["operation"],
      properties: {
        operation: { enum: [...WORKFLOW_GATE_OPERATION_KEYS] },
        min_amount: { type: "number", minimum: 0 },
        map: {
          type: "object",
          additionalProperties: { type: "string", maxLength: 500 },
        },
      },
    },
    start_roles: { type: "array", items: { $ref: "#/$defs/key" } },
  },
  $defs: {
    key: { type: "string", pattern: WORKFLOW_KEY_PATTERN.source },
    scalar: { type: ["string", "number", "boolean"] },
    field: {
      type: "object",
      additionalProperties: false,
      required: ["key", "type", "label"],
      properties: {
        key: { $ref: "#/$defs/key" },
        type: { enum: [...WORKFLOW_FIELD_TYPES] },
        label: { type: "string", minLength: 1, maxLength: 200 },
        required: { type: "boolean" },
        help: { type: "string", maxLength: 500 },
        options: {
          type: "array",
          minItems: 1,
          maxItems: WORKFLOW_LIMITS.maxSelectOptions,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["value", "label"],
            properties: {
              value: { type: "string", minLength: 1 },
              label: { type: "string", minLength: 1 },
            },
          },
        },
        accept: { type: "array", items: { type: "string" } },
        max_size_mb: { type: "number", minimum: 1, maximum: 25 },
        visible_when: { $ref: "#/$defs/conditionGroup" },
        compute: {
          type: "string",
          minLength: 1,
          maxLength: WORKFLOW_LIMITS.maxExpressionLength,
        },
      },
    },
    conditionRule: {
      type: "object",
      additionalProperties: false,
      required: ["field", "op"],
      properties: {
        field: { $ref: "#/$defs/key" },
        op: { enum: [...WORKFLOW_CONDITION_OPS] },
        value: {
          oneOf: [
            { $ref: "#/$defs/scalar" },
            {
              type: "array",
              items: { type: ["string", "number"] },
            },
          ],
        },
      },
    },
    conditionNode: {
      oneOf: [
        { $ref: "#/$defs/conditionRule" },
        { $ref: "#/$defs/conditionGroup" },
      ],
    },
    conditionGroup: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["all"],
          properties: {
            all: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/conditionNode" },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["any"],
          properties: {
            any: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/conditionNode" },
            },
          },
        },
      ],
    },
    assignee: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { const: "initiator" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "role_key"],
          properties: {
            kind: { const: "role" },
            role_key: { type: "string", minLength: 1 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "group_key"],
          properties: {
            kind: { const: "group" },
            group_key: { type: "string", minLength: 1 },
            strategy: { enum: ["any", "round_robin", "least_load"] },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "user_id"],
          properties: {
            kind: { const: "user" },
            user_id: { type: "integer", minimum: 1 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "field"],
          properties: {
            kind: { const: "field" },
            field: { $ref: "#/$defs/key" },
          },
        },
      ],
    },
    transition: {
      type: "object",
      additionalProperties: false,
      required: ["to", "on"],
      properties: {
        to: { $ref: "#/$defs/key" },
        on: {
          enum: [
            "submit",
            "approve",
            "reject",
            "return",
            "auto",
            "joined",
            "completed",
            "rejected",
            "elapsed",
            "continue",
            "done",
          ],
        },
        when: { $ref: "#/$defs/conditionGroup" },
        require_comment: { type: "boolean" },
        label: { type: "string", maxLength: 200 },
      },
    },
    requirement: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "key", "label"],
          properties: {
            kind: { const: "upload" },
            key: { $ref: "#/$defs/key" },
            label: { type: "string", minLength: 1 },
            accept: { type: "array", items: { type: "string" } },
            max_size_mb: { type: "number", minimum: 1, maximum: 25 },
            blocks_exit: { type: "boolean" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "key", "label", "field"],
          properties: {
            kind: { const: "file_field" },
            key: { $ref: "#/$defs/key" },
            label: { type: "string", minLength: 1 },
            field: { $ref: "#/$defs/key" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "key", "label", "template_key"],
          properties: {
            kind: { const: "issued_document" },
            key: { $ref: "#/$defs/key" },
            label: { type: "string", minLength: 1 },
            template_key: { type: "string", minLength: 1 },
            auto_issue_on_enter: { type: "boolean" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "key", "label", "of"],
          properties: {
            kind: { const: "signature" },
            key: { $ref: "#/$defs/key" },
            label: { type: "string", minLength: 1 },
            of: { $ref: "#/$defs/key" },
            accept: { type: "array", items: { type: "string" } },
            blocks_exit: { type: "boolean" },
          },
        },
      ],
    },
    action: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "to", "message"],
          properties: {
            action: { const: "notify" },
            to: { $ref: "#/$defs/assignee" },
            message: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "field", "value"],
          properties: {
            action: { const: "set_field" },
            field: { $ref: "#/$defs/key" },
            value: { type: ["string", "number", "boolean", "null"] },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "map"],
          properties: {
            action: { enum: [...WORKFLOW_VENDIX_ACTIONS] },
            map: {
              type: "object",
              additionalProperties: {
                oneOf: [
                  { type: ["string", "number", "boolean"] },
                  { $ref: "#/$defs/assignee" },
                ],
              },
            },
            on_error: {
              type: "object",
              additionalProperties: false,
              properties: {
                retries: {
                  type: "integer",
                  minimum: 0,
                  maximum: WORKFLOW_LIMITS.maxActionRetries,
                },
                then: { enum: [...WORKFLOW_ERROR_THEN] },
                route_to: { $ref: "#/$defs/key" },
              },
            },
          },
        },
      ],
    },
    stage: {
      type: "object",
      additionalProperties: false,
      required: ["key", "name", "type"],
      properties: {
        key: { $ref: "#/$defs/key" },
        name: { type: "string", minLength: 1, maxLength: 200 },
        type: { enum: [...WORKFLOW_STAGE_TYPES] },
        description: { type: "string", maxLength: 2000 },
        start: { type: "boolean" },
        outcome: { enum: [...WORKFLOW_END_OUTCOMES] },
        assignee: { $ref: "#/$defs/assignee" },
        quorum: {
          type: "object",
          additionalProperties: false,
          required: ["required"],
          properties: { required: { type: "integer", minimum: 1 } },
        },
        form: {
          type: "object",
          additionalProperties: false,
          required: ["fields"],
          properties: {
            fields: { type: "array", items: { $ref: "#/$defs/key" } },
          },
        },
        requirements: {
          type: "array",
          maxItems: WORKFLOW_LIMITS.maxRequirementsPerStage,
          items: { $ref: "#/$defs/requirement" },
        },
        transitions: {
          type: "array",
          maxItems: WORKFLOW_LIMITS.maxTransitionsPerStage,
          items: { $ref: "#/$defs/transition" },
        },
        due: {
          type: "object",
          additionalProperties: false,
          required: ["hours"],
          properties: {
            hours: { type: "integer", minimum: 1, maximum: 8760 },
            on_overdue: {
              type: "object",
              additionalProperties: false,
              properties: {
                remind_every_hours: {
                  type: "integer",
                  minimum: 1,
                  maximum: 720,
                },
                escalate_to: { $ref: "#/$defs/assignee" },
              },
            },
          },
        },
        on_enter: {
          type: "array",
          maxItems: WORKFLOW_LIMITS.maxActionsPerHook,
          items: { $ref: "#/$defs/action" },
        },
        on_submit: {
          type: "array",
          maxItems: WORKFLOW_LIMITS.maxActionsPerHook,
          items: { $ref: "#/$defs/action" },
        },
        on_complete: {
          type: "array",
          maxItems: WORKFLOW_LIMITS.maxActionsPerHook,
          items: { $ref: "#/$defs/action" },
        },
        on_exit: {
          type: "array",
          maxItems: WORKFLOW_LIMITS.maxActionsPerHook,
          items: { $ref: "#/$defs/action" },
        },
        guards: {
          type: "array",
          maxItems: WORKFLOW_LIMITS.maxGuards,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["when", "message"],
            properties: {
              when: { $ref: "#/$defs/conditionGroup" },
              message: { type: "string", minLength: 1, maxLength: 300 },
              redirect_to: { $ref: "#/$defs/key" },
            },
          },
        },
        parallel: {
          type: "object",
          additionalProperties: false,
          required: ["branches", "join"],
          properties: {
            branches: {
              type: "array",
              minItems: 2,
              maxItems: WORKFLOW_LIMITS.maxBranches,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "name", "assignee"],
                properties: {
                  key: { $ref: "#/$defs/key" },
                  name: { type: "string", minLength: 1, maxLength: 200 },
                  assignee: { $ref: "#/$defs/assignee" },
                  form: {
                    type: "object",
                    additionalProperties: false,
                    required: ["fields"],
                    properties: {
                      fields: { type: "array", items: { $ref: "#/$defs/key" } },
                    },
                  },
                },
              },
            },
            join: { enum: ["all", "any", "n_of_m"] },
            required: { type: "integer", minimum: 1 },
          },
        },
        subflow: {
          type: "object",
          additionalProperties: false,
          required: ["flows"],
          properties: {
            flows: {
              type: "array",
              minItems: 1,
              maxItems: WORKFLOW_LIMITS.maxSubflows,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["flow_key"],
                properties: {
                  flow_key: { $ref: "#/$defs/key" },
                  map: {
                    type: "object",
                    additionalProperties: { type: "string", maxLength: 500 },
                  },
                },
              },
            },
            wait: { type: "boolean" },
            output: {
              type: "object",
              additionalProperties: { type: "string", maxLength: 170 },
            },
          },
        },
        wait: {
          type: "object",
          required: ["kind"],
          properties: { kind: { enum: [...WORKFLOW_WAIT_KINDS] } },
        },
        loop: {
          type: "object",
          additionalProperties: false,
          required: ["while", "max_iterations"],
          properties: {
            while: { $ref: "#/$defs/conditionGroup" },
            max_iterations: {
              type: "integer",
              minimum: 1,
              maximum: WORKFLOW_LIMITS.maxLoopIterations,
            },
          },
        },
      },
    },
  },
} as const;

export const WORKFLOW_EXAMPLE_PURCHASE_APPROVAL: WorkflowDefinitionV1 = {
  schema: WORKFLOW_SCHEMA_V1,
  key: "aprobacion-compras",
  name: "Aprobación de compras",
  description: "Solicitud de compra con aprobación del jefe y de gerencia.",
  subject: { type: "purchase_order" },
  fields: [
    {
      key: "monto",
      type: "money",
      label: "Monto estimado",
      required: true,
    },
    { key: "proveedor", type: "text", label: "Proveedor" },
    {
      key: "cotizacion",
      type: "file",
      label: "Cotización",
      accept: ["application/pdf", "image/*"],
      max_size_mb: 10,
    },
  ],
  stages: [
    {
      key: "solicitud",
      name: "Solicitud",
      type: "form",
      start: true,
      assignee: { kind: "initiator" },
      form: { fields: ["monto", "proveedor", "cotizacion"] },
      transitions: [{ to: "jefe", on: "submit" }],
    },
    {
      key: "jefe",
      name: "Aprobación jefe de tienda",
      type: "approval",
      assignee: { kind: "role", role_key: "store_manager" },
      due: { hours: 24, on_overdue: { remind_every_hours: 8 } },
      transitions: [
        {
          to: "gerente",
          on: "approve",
          when: { all: [{ field: "monto", op: "gt", value: 2000000 }] },
        },
        { to: "aprobada", on: "approve" },
        { to: "rechazada", on: "reject", require_comment: true },
      ],
    },
    {
      key: "gerente",
      name: "Aprobación gerencia",
      type: "approval",
      assignee: { kind: "group", group_key: "gerencia" },
      quorum: { required: 1 },
      requirements: [
        {
          kind: "file_field",
          key: "cotizacion_adjunta",
          label: "Cotización adjunta",
          field: "cotizacion",
        },
      ],
      transitions: [
        { to: "aprobada", on: "approve" },
        { to: "rechazada", on: "reject" },
      ],
    },
    { key: "aprobada", name: "Aprobada", type: "end", outcome: "completed" },
    {
      key: "rechazada",
      name: "Rechazada",
      type: "end",
      outcome: "rejected",
      on_enter: [
        {
          action: "notify",
          to: { kind: "initiator" },
          message: "Tu solicitud de compra fue rechazada.",
        },
      ],
    },
  ],
  triggers: [{ kind: "manual" }],
};

/**
 * Outgoing webhook event types a store endpoint can subscribe to (design
 * §5.7). Shared so the backend emitter and the frontend panel never drift.
 */
export const WORKFLOW_WEBHOOK_EVENTS = [
  'workflow.instance.started',
  'workflow.instance.transitioned',
  'workflow.instance.completed',
  'workflow.instance.rejected',
  'workflow.task.created',
  'workflow.task.completed',
  'workflow.task.overdue',
] as const;

export type WorkflowWebhookEvent = (typeof WORKFLOW_WEBHOOK_EVENTS)[number];
