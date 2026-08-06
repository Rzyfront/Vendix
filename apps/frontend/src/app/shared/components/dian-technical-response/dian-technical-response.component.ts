import { Component, computed, input } from '@angular/core';

import { IconComponent } from '../icon/icon.component';

/**
 * Forma laxa a propósito: es un panel de DIAGNÓSTICO y muestra lo que haya.
 *
 * Las dos superficies fiscales guardan el mismo `last_test_result` pero lo
 * entregan con envoltorios distintos (tiendas lo mapea a `DianTestResult`,
 * plataforma pasa el objeto crudo). Un tipo estricto obligaría a un adaptador por
 * superficie para ganar nada: si un campo falta, su sección no se rinde.
 */
export interface DianTechnicalResponseData {
  zip_key?: string | null;
  tracking_id?: string | null;
  executed_at?: string | null;
  rechecked_at?: string | null;
  dian_status?: string | null;
  status_message?: string | null;
  error_messages?: string[];
  total_documents?: number | null;
  number_from?: number | null;
  number_to?: number | null;
  zip_file_name?: string | null;
  operation_mode?: string | null;
  documents?: Array<{
    file_name?: string;
    number?: string;
    kind?: string;
    cufe?: string;
  }>;
  poll_history?: Array<{
    attempt?: number;
    status_code?: string;
    status_message?: string;
    success?: boolean;
  }>;
  dian_response?: {
    status_code?: string;
    status_message?: string;
    error_messages?: string[];
    raw_response?: string;
  } | null;
}

interface NameCheck {
  label: string;
  value: string;
  length: number;
  expected: number;
  ok: boolean;
}

/** Anexo Técnico FE de Venta v1.9 (Res. 000165/2023), §6.5.7 y §6.5.8. */
const XML_NAME_LENGTH = 25;
const ZIP_NAME_LENGTH = 24;

/**
 * Respuesta técnica de la DIAN, plegada.
 *
 * POR QUÉ EXISTE: plataforma volcaba el resultado entero con el pipe json, así
 * que el sobre SOAP se leía escapado —comillas con barras, todo en una línea— y
 * tiendas no mostraba nada. Cuando un lote no recibe veredicto, lo que hace falta
 * es el StatusDescription de la DIAN, los nombres de archivo con su longitud y el
 * historial de consultas; no un JSON de 12 KB.
 *
 * Va plegado por defecto: es diagnóstico, no información de pantalla. El
 * veredicto legible ya lo dan las tarjetas de estado.
 */
@Component({
  selector: 'app-dian-technical-response',
  standalone: true,
  imports: [IconComponent],
  template: `
    <details class="rounded-lg border border-border bg-background">
      <summary
        class="cursor-pointer px-3 py-2 text-xs font-medium text-text-secondary select-none flex items-center gap-2"
      >
        <app-icon name="code" [size]="14"></app-icon>
        Ver respuesta técnica de la DIAN
      </summary>

      <div class="px-3 pb-3 space-y-3">
        <!-- Veredicto crudo -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          @for (row of summaryRows(); track row.label) {
            <div class="flex gap-1.5 min-w-0">
              <span class="text-text-secondary shrink-0">{{ row.label }}:</span>
              <span class="font-mono text-text-primary break-all">{{ row.value }}</span>
            </div>
          }
        </div>

        <!-- Nombres de archivo contra el anexo. Un nombre con la longitud
             equivocada es la causa de que la DIAN acuse un lote y no lo
             clasifique nunca, así que se muestra medido. -->
        @if (nameChecks().length) {
          <div class="pt-2 border-t border-border space-y-1">
            <p class="text-[11px] font-medium text-text-secondary">
              Nombres entregados a la DIAN
            </p>
            @for (check of nameChecks(); track check.label) {
              <div class="flex items-center gap-2 text-[11px]">
                <app-icon
                  [name]="check.ok ? 'check-circle' : 'alert-triangle'"
                  [size]="12"
                  [class]="check.ok ? 'text-success shrink-0' : 'text-error shrink-0'"
                ></app-icon>
                <span class="font-mono text-text-primary break-all">{{ check.value }}</span>
                <span class="text-text-secondary shrink-0">
                  {{ check.length }}/{{ check.expected }}
                </span>
              </div>
            }
          </div>
        }

        <!-- Errores devueltos por la DIAN -->
        @if (errors().length) {
          <div class="pt-2 border-t border-border space-y-1">
            <p class="text-[11px] font-medium text-error">
              Errores devueltos por la DIAN ({{ errors().length }})
            </p>
            <ul class="space-y-0.5">
              @for (err of errors(); track err) {
                <li class="text-[11px] text-error break-words">{{ err }}</li>
              }
            </ul>
          </div>
        }

        <!-- Historial de consultas -->
        @if (pollHistory().length) {
          <div class="pt-2 border-t border-border space-y-1">
            <p class="text-[11px] font-medium text-text-secondary">
              Consultas realizadas ({{ pollHistory().length }})
            </p>
            @for (attempt of pollHistory(); track attempt.attempt) {
              <div class="flex gap-2 text-[11px]">
                <span class="text-text-secondary shrink-0 w-6">#{{ attempt.attempt }}</span>
                <span class="font-mono shrink-0">{{ attempt.status_code || '-' }}</span>
                <span class="text-text-secondary break-words">{{ attempt.status_message }}</span>
              </div>
            }
          </div>
        }

        <!-- Sobre SOAP -->
        @if (prettyRaw(); as raw) {
          <div class="pt-2 border-t border-border space-y-1">
            <p class="text-[11px] font-medium text-text-secondary">
              Sobre SOAP devuelto por la DIAN
            </p>
            <pre
              class="text-[10px] leading-relaxed overflow-x-auto max-h-72 overflow-y-auto text-text-secondary bg-[var(--color-surface)] rounded p-2"
              >{{ raw }}</pre
            >
          </div>
        }
      </div>
    </details>
  `,
})
export class DianTechnicalResponseComponent {
  readonly result = input.required<DianTechnicalResponseData | null>();

  private readonly response = computed(() => this.result()?.dian_response ?? null);

  readonly summaryRows = computed(() => {
    const r = this.result();
    if (!r) return [];
    const rows: Array<{ label: string; value: string }> = [];
    const push = (label: string, value: unknown) => {
      if (value === null || value === undefined || value === '') return;
      rows.push({ label, value: String(value) });
    };

    push('ZipKey', r.zip_key ?? r.tracking_id);
    // `dian_status` es el nombre en tiendas; `dian_response.status_code` el que
    // guarda el backend. Se prefiere el que venga.
    push('StatusCode', r.dian_status ?? this.response()?.status_code);
    push(
      'StatusDescription',
      r.status_message ?? this.response()?.status_message,
    );
    push('Enviado', r.executed_at);
    push('Última consulta', r.rechecked_at);
    push('Documentos', r.total_documents ?? r.documents?.length);
    if (r.number_from && r.number_to) {
      push('Consecutivos', `${r.number_from} – ${r.number_to}`);
    }
    push('Modo de operación', r.operation_mode);
    return rows;
  });

  readonly nameChecks = computed<NameCheck[]>(() => {
    const r = this.result();
    if (!r) return [];
    const checks: NameCheck[] = [];

    const firstXml = r.documents?.find((d) => !!d.file_name)?.file_name;
    if (firstXml) {
      const bare = firstXml.replace(/\.xml$/i, '');
      checks.push({
        label: 'xml',
        value: firstXml,
        length: bare.length,
        expected: XML_NAME_LENGTH,
        ok: bare.length === XML_NAME_LENGTH,
      });
    }
    if (r.zip_file_name) {
      const bare = r.zip_file_name.replace(/\.zip$/i, '');
      checks.push({
        label: 'zip',
        value: r.zip_file_name,
        length: bare.length,
        expected: ZIP_NAME_LENGTH,
        ok: bare.length === ZIP_NAME_LENGTH,
      });
    }
    return checks;
  });

  readonly errors = computed<string[]>(
    () => this.result()?.error_messages ?? this.response()?.error_messages ?? [],
  );

  readonly pollHistory = computed(() => this.result()?.poll_history ?? []);

  /**
   * El sobre viene en una sola línea. Se parte entre etiquetas y se indenta por
   * profundidad; sin librería, porque el CSP de la app bloquea recursos externos
   * y un resaltador no aporta sobre un XML que se lee una vez para diagnosticar.
   */
  readonly prettyRaw = computed<string | null>(() => {
    const raw = this.response()?.raw_response;
    if (!raw) return null;

    const parts = raw
      .replace(/>\s*</g, '><')
      .replace(/></g, '>\n<')
      .split('\n');

    let depth = 0;
    return parts
      .map((line) => {
        const isClose = /^<\//.test(line);
        const isSelfContained = /^<[^>]+>[^<]*<\/[^>]+>$/.test(line);
        const isVoid = /\/>$/.test(line) || /^<\?/.test(line);

        if (isClose) depth = Math.max(0, depth - 1);
        const indented = '  '.repeat(depth) + line;
        if (!isClose && !isSelfContained && !isVoid) depth += 1;
        return indented;
      })
      .join('\n');
  });
}
