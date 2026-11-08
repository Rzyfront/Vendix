import { BadRequestException, Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_ACTIONS,
  WORKFLOW_VENDIX_ACTIONS,
  WorkflowActionDef,
  WorkflowActionInputSpec,
  WorkflowVendixActionName,
  resolveTokens,
} from '@common/workflows/contract';
import { applyActionList } from '../engine/workflow-rules';
import { requireActionPermission } from '../engine/actions/action-test-permission';
import { WorkflowConnectorsService } from '../connectors/connectors.service';
import {
  HttpTestResult,
  WorkflowHttpTestService,
} from '../secrets/workflow-http-test.service';
import { WorkflowActionTestDto } from '../dto/workflow-action-test.dto';
import { describeAssignee } from './workflow-simulator.service';

const SIM_REFERENCE = 'FLU-PRUEBA';
const SIM_TITLE = 'Solicitud de prueba';

export interface ActionSchemaError {
  key: string;
  label: string;
  message: string;
}

export type ActionTestResult =
  | {
      /** Nothing ran: the effect would create or change records. */
      mode: 'preview';
      executed: false;
      action: string;
      label: string;
      resolved_input: Record<string, unknown>;
      schema_errors: ActionSchemaError[];
      permission: { required: string | null; granted: boolean };
    }
  | { mode: 'http'; executed: true; action: string; label: string; result: HttpTestResult }
  | {
      mode: 'connector';
      executed: true;
      action: string;
      label: string;
      connector: 'email_out' | 'whatsapp';
      result: Awaited<ReturnType<WorkflowConnectorsService['test']>>;
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problem with a resolved value, or null when it satisfies the catalog input. */
function inputProblem(spec: WorkflowActionInputSpec, value: unknown): string | null {
  if (spec.type === 'assignee') {
    return value && typeof value === 'object' ? null : 'Debe ser un responsable.';
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return spec.required ? 'Falta un valor (revisa los datos de prueba).' : null;
  }
  const text = value.trim();
  switch (spec.type) {
    case 'id':
    case 'int':
    case 'number':
    case 'money': {
      const n = Number(text);
      const integer = spec.type === 'id' || spec.type === 'int';
      const min = spec.min ?? (spec.type === 'id' ? 1 : undefined);
      if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
        return `Debe ser un número${integer ? ' entero' : ''}.`;
      }
      if (min !== undefined && n < min) return `Debe ser mayor o igual a ${min}.`;
      if (spec.max !== undefined && n > spec.max) return `Debe ser menor o igual a ${spec.max}.`;
      return null;
    }
    case 'date':
      return ISO_DATE.test(text) ? null : 'Debe ser una fecha AAAA-MM-DD.';
    case 'boolean':
      return text === 'true' || text === 'false' ? null : 'Debe ser verdadero o falso.';
    case 'enum':
      return (spec.values ?? []).includes(text)
        ? null
        : `Debe ser uno de: ${(spec.values ?? []).join(', ')}.`;
    default:
      return null;
  }
}

function hasPermission(action: WorkflowVendixActionName): boolean {
  try {
    requireActionPermission(action);
    return true;
  } catch (e) {
    if (e instanceof VendixHttpException && e.errorCode === ErrorCodes.AUTH_PERM_001.code) {
      return false;
    }
    throw e;
  }
}

/**
 * "Probar esta acción" (P5.2, R1: never report success without executing).
 * HTTP and the email / WhatsApp connectors make the real call through their
 * own test services; every other action only previews its resolved input.
 */
@Injectable()
export class WorkflowActionTestService {
  constructor(
    private readonly http: WorkflowHttpTestService,
    private readonly connectors: WorkflowConnectorsService,
  ) {}

  async test(dto: WorkflowActionTestDto): Promise<ActionTestResult> {
    const def = dto.action as unknown as WorkflowActionDef;
    const name = def.action;
    if (!(WORKFLOW_ACTIONS as readonly string[]).includes(name)) {
      throw new BadRequestException(`La acción "${String(name)}" no existe.`);
    }
    const data = dto.data ?? {};
    const instance = {
      reference: dto.instance?.reference ?? SIM_REFERENCE,
      title: dto.instance?.title ?? SIM_TITLE,
    };

    if (def.action === 'notify' || def.action === 'set_field') {
      return this.previewHook(def, data, instance);
    }
    const vendix = def.action as WorkflowVendixActionName;
    if (!(WORKFLOW_VENDIX_ACTIONS as readonly string[]).includes(vendix)) {
      throw new BadRequestException(`La acción "${String(name)}" no existe.`);
    }
    const label = WORKFLOW_ACTION_CATALOG[vendix].label;
    const vendixDef = def as Extract<WorkflowActionDef, { map: unknown }>;
    if (vendix === 'vendix.http.request') {
      const result = await this.http.test({
        map: vendixDef.map,
        output: vendixDef.output,
        sample_fields: data,
      });
      return { mode: 'http', executed: true, action: vendix, label, result };
    }
    if (vendix === 'vendix.email.send' || vendix === 'vendix.whatsapp.send') {
      const resolved = applyActionList([vendixDef], data, instance).vendix[0].map_resolved;
      const asText = (key: string) =>
        typeof resolved[key] === 'string' ? (resolved[key] as string) : undefined;
      const connector = vendix === 'vendix.email.send' ? 'email_out' : 'whatsapp';
      const result = await this.connectors.test(
        connector,
        connector === 'whatsapp'
          ? {
              to: asText('to'),
              template: asText('template'),
              language: asText('language'),
              params: asText('params'),
            }
          : undefined,
      );
      return { mode: 'connector', executed: true, action: vendix, label, connector, result };
    }
    return this.previewVendix(vendix, label, vendixDef, data, instance);
  }

  private previewVendix(
    name: WorkflowVendixActionName,
    label: string,
    def: Extract<WorkflowActionDef, { map: unknown }>,
    data: Record<string, unknown>,
    instance: { reference: string; title: string },
  ): ActionTestResult {
    const spec = WORKFLOW_ACTION_CATALOG[name];
    const inputs = spec.inputs as Record<string, WorkflowActionInputSpec>;
    const resolved: Record<string, unknown> = applyActionList([def], data, instance).vendix[0]
      .map_resolved;
    const errors: ActionSchemaError[] = [];
    for (const key of Object.keys(resolved)) {
      if (!inputs[key]) {
        errors.push({ key, label: key, message: 'Este dato no existe en la acción.' });
      }
    }
    for (const [key, input] of Object.entries(inputs)) {
      const problem = inputProblem(input, resolved[key]);
      if (problem) errors.push({ key, label: input.label, message: problem });
    }
    return {
      mode: 'preview',
      executed: false,
      action: name,
      label,
      resolved_input: resolved,
      schema_errors: errors,
      permission: { required: spec.permission, granted: hasPermission(name) },
    };
  }

  private previewHook(
    def: Extract<WorkflowActionDef, { action: 'notify' | 'set_field' }>,
    data: Record<string, unknown>,
    instance: { reference: string; title: string },
  ): ActionTestResult {
    const applied = applyActionList([def], data, instance);
    if (def.action === 'notify') {
      return {
        mode: 'preview',
        executed: false,
        action: 'notify',
        label: 'Notificar',
        resolved_input: {
          to: describeAssignee(def.to)?.label ?? '',
          message: resolveTokens(applied.notifies[0]?.message ?? '', {
            fields: data,
            instance,
          }),
        },
        schema_errors: def.message?.trim()
          ? []
          : [{ key: 'message', label: 'Mensaje', message: 'Falta el mensaje.' }],
        permission: { required: null, granted: true },
      };
    }
    return {
      mode: 'preview',
      executed: false,
      action: 'set_field',
      label: 'Asignar campo',
      resolved_input: { field: def.field, value: applied.data[def.field] ?? null },
      schema_errors: def.field
        ? []
        : [{ key: 'field', label: 'Campo', message: 'Falta el campo.' }],
      permission: { required: null, granted: true },
    };
  }
}
