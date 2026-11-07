import { ForbiddenException, Injectable } from '@nestjs/common';
import { IsObject, IsOptional } from 'class-validator';
import { RequestContextService } from '@common/context/request-context.service';
import {
  WORKFLOW_HTTP_OUTPUT_PATH,
  WORKFLOW_LIMITS,
} from '@common/workflows/contract';
import {
  HttpCallError,
  HttpCallErrorKind,
  WorkflowHttpActions,
  mapResponseOutput,
  maskSecrets,
} from '../engine/actions/http.actions';
import { WorkflowActionInputError } from '../engine/actions/workflow-action.types';
import { resolveHttpActionMap } from './workflow-http-map';

export const HTTP_TEST_BODY_PREVIEW_BYTES = 20 * 1024;
const HIDDEN_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'authorization',
  'proxy-authenticate',
]);

export class TestHttpActionDto {
  @IsObject() map!: Record<string, unknown>;
  @IsOptional() @IsObject() output?: Record<string, string>;
  @IsOptional() @IsObject() sample_fields?: Record<string, unknown>;
}

export type HttpTestResult =
  | {
      ok: true;
      status: number;
      headers: Record<string, string>;
      body: string;
      body_truncated: boolean;
      duration_ms: number;
      output: Record<string, unknown>;
    }
  | { ok: false; error: { kind: HttpCallErrorKind; message: string } };

/** "Probar esta acción": the REAL request, with the same policy, timeout and cap. */
@Injectable()
export class WorkflowHttpTestService {
  constructor(private readonly http: WorkflowHttpActions) {}

  async test(dto: TestHttpActionDto): Promise<HttpTestResult> {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new ForbiddenException('Acceso denegado: falta el contexto de tienda');
    }
    const output = dto.output ?? {};
    const outputEntries = Object.entries(output);
    if (
      outputEntries.length > WORKFLOW_LIMITS.maxHttpOutputs ||
      outputEntries.some(([, p]) => typeof p !== 'string' || !WORKFLOW_HTTP_OUTPUT_PATH.test(p))
    ) {
      return {
        ok: false,
        error: {
          kind: 'invalid',
          message:
            'La salida usa rutas como status, body, body.campo.0.otro o headers.nombre.',
        },
      };
    }
    const map = resolveHttpActionMap(dto.map, {
      fields: dto.sample_fields ?? {},
      instance: { reference: 'FLU-PRUEBA', title: 'Solicitud de prueba' },
    });
    try {
      const res = await this.http.perform(storeId, map);
      const mask = (t: string) => maskSecrets(t, res.secretValues);
      const body = mask(res.body);
      const preview = Buffer.from(body, 'utf8');
      const truncated = res.truncated || preview.length > HTTP_TEST_BODY_PREVIEW_BYTES;
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(res.headers)) {
        if (!HIDDEN_RESPONSE_HEADERS.has(name)) headers[name] = mask(value);
      }
      return {
        ok: true,
        status: res.status,
        headers,
        body: truncated
          ? preview.subarray(0, HTTP_TEST_BODY_PREVIEW_BYTES).toString('utf8')
          : body,
        body_truncated: truncated,
        duration_ms: res.duration_ms,
        output: mapResponseOutput(output, { status: res.status, headers: res.headers, body }),
      };
    } catch (e) {
      if (e instanceof HttpCallError) {
        return { ok: false, error: { kind: e.kind, message: e.message } };
      }
      if (e instanceof WorkflowActionInputError) {
        return { ok: false, error: { kind: 'invalid', message: e.message } };
      }
      throw e;
    }
  }
}
