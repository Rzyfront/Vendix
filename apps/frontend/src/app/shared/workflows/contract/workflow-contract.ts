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
}

export type WorkflowStageType =
  | "form"
  | "approval"
  | "review"
  | "automatic"
  | "end";

export const WORKFLOW_STAGE_TYPES: readonly WorkflowStageType[] = [
  "form",
  "approval",
  "review",
  "automatic",
  "end",
];

export const STAGE_OUTCOMES: Record<WorkflowStageType, readonly string[]> = {
  form: ["submit"],
  approval: ["approve", "reject"],
  review: ["approve", "reject", "return"],
  automatic: ["auto"],
  end: [],
};

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

export const WORKFLOW_ACTIONS = [
  "notify",
  "set_field",
  "vendix.purchase_order.create_draft",
  "vendix.crm_task.create",
] as const;

/** Actions the engine writes to the outbox instead of running inline. */
export const WORKFLOW_VENDIX_ACTIONS = [
  "vendix.purchase_order.create_draft",
  "vendix.crm_task.create",
] as const;

export type WorkflowVendixActionName = (typeof WORKFLOW_VENDIX_ACTIONS)[number];

/**
 * `map` of a Vendix action: a literal (string, number, boolean) or a string
 * with `{{tokens}}` of the closed catalog (see WORKFLOW_ACTION_TOKEN_PREFIXES);
 * `assignee` (CRM task only) is an assignee definition.
 */
export type WorkflowActionMapValue =
  | string
  | number
  | boolean
  | WorkflowAssigneeDef;

/**
 * Keys accepted by each Vendix action. The purchase order is a one-line DRAFT:
 * the purchase-order service needs a supplier, a receiving location and a line
 * (product, quantity, unit price), so those are required.
 */
export const WORKFLOW_VENDIX_ACTION_MAP_KEYS: Record<
  WorkflowVendixActionName,
  { required: readonly string[]; optional: readonly string[] }
> = {
  "vendix.purchase_order.create_draft": {
    required: [
      "supplier_id",
      "location_id",
      "product_id",
      "quantity",
      "unit_price",
    ],
    optional: ["notes", "expected_date"],
  },
  "vendix.crm_task.create": {
    required: ["title"],
    optional: ["description", "due_in_days", "assignee"],
  },
};

export type WorkflowActionDef =
  | { action: "notify"; to: WorkflowAssigneeDef; message: string }
  | {
      action: "set_field";
      field: string;
      value: string | number | boolean | null;
    }
  | {
      action: "vendix.purchase_order.create_draft";
      map: Record<string, WorkflowActionMapValue>;
    }
  | {
      action: "vendix.crm_task.create";
      map: Record<string, WorkflowActionMapValue>;
    };

/** Tokens usable in action maps: `{{fields.<declared field>}}` plus these. */
export const WORKFLOW_INSTANCE_TOKENS: readonly string[] = [
  "instance.reference",
  "instance.title",
];

/** Business events that can start a flow (6 of them, all carry a store id). */
export const WORKFLOW_TRIGGER_EVENTS = [
  "order.created",
  "order.paid",
  "purchase_order.received",
  "expense.approved",
  "customer.created",
  "pqr.created",
] as const;

export type WorkflowTriggerEvent = (typeof WORKFLOW_TRIGGER_EVENTS)[number];

/**
 * Closed catalog of `{{event.<path>}}` tokens per event. The listener builds a
 * flat context with exactly these keys, so nothing else of the payload is ever
 * reachable from a definition.
 */
export const WORKFLOW_EVENT_TOKENS: Record<
  WorkflowTriggerEvent,
  readonly string[]
> = {
  "order.created": [
    "order_id",
    "order_number",
    "grand_total",
    "currency",
    "channel",
  ],
  "order.paid": ["order_id", "payment_id", "grand_total", "currency"],
  "purchase_order.received": [
    "purchase_order_id",
    "supplier_id",
    "total_amount",
  ],
  "expense.approved": ["expense_id", "amount", "category_id"],
  "customer.created": [
    "customer_id",
    "first_name",
    "last_name",
    "email",
  ],
  "pqr.created": [
    "ticket_id",
    "ticket_number",
    "title",
    "description",
    "category",
    "contact_name",
    "contact_email",
  ],
};

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
  on_enter?: WorkflowActionDef[];
  on_exit?: WorkflowActionDef[];
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
    };

export type WorkflowSubjectType =
  | "none"
  | "customer"
  | "supplier"
  | "employee"
  | "order"
  | "purchase_order";

export const WORKFLOW_SUBJECT_TYPES: readonly WorkflowSubjectType[] = [
  "none",
  "customer",
  "supplier",
  "employee",
  "order",
  "purchase_order",
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
        ],
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
        on: { enum: ["submit", "approve", "reject", "return", "auto"] },
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
        on_exit: {
          type: "array",
          maxItems: WORKFLOW_LIMITS.maxActionsPerHook,
          items: { $ref: "#/$defs/action" },
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
