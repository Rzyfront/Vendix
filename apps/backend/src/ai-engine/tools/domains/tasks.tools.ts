import { Logger } from '@nestjs/common';
import { RegisteredTool } from '../interfaces/tool.interface';
import { VexiTaskService } from '../../../domains/store/vexi/vexi-task.service';
import { VexiAttachmentsService } from '../../../domains/store/vexi/vexi-attachments.service';
import {
  buildMultipartBody,
  internalApiBase,
  internalAuthHeaders,
} from '../bridge/internal-http';

export interface TaskToolDeps {
  tasks: VexiTaskService;
  attachments: VexiAttachmentsService;
}

/** Enough to report every failing row's reason; past this the model cannot act on it. */
const MAX_REPORT_CHARS = 6000;

const logger = new Logger('vexi-tasks');

/**
 * The dry-run endpoint per bulk domain, with the field name it reads the file from.
 *
 * A curated table rather than a derivation, because "which endpoint validates
 * without applying" is not something a route name reveals: `POST bulk/analyze` and
 * `POST bulk/upload/file` are indistinguishable to the catalog, and picking the wrong
 * one would apply hundreds of rows the person never saw.
 */
const BULK_ANALYZERS: Record<
  string,
  {
    analyze: string;
    apply: string;
    subject: string;
    /** Field multer reads the spreadsheet from, for file-driven analyzers. */
    fileField?: string;
    /**
     * Set when the analyzer takes the extracted JSON instead of the file.
     *
     * The member roster is scanned by the vision application first
     * (`padron_socios`) and only then analysed, so its dry run has no file to
     * send — it has the extraction. Modelled explicitly rather than forced into the
     * file shape, because sending a photo to an endpoint expecting parsed rows fails
     * in a way the model cannot diagnose.
     */
    jsonField?: string;
  }
> = {
  productos: {
    analyze: 'store/products/bulk/analyze',
    apply: 'store/products/bulk/upload-session',
    fileField: 'file',
    subject: 'productos',
  },
  empleados: {
    analyze: 'store/payroll/employees/bulk/analyze',
    apply: 'store/payroll/employees/bulk/upload-session',
    fileField: 'file',
    subject: 'empleados de nómina',
  },
  socios: {
    analyze: 'store/memberships/bulk-scan/analyze',
    apply: 'store/memberships/bulk-scan/commit',
    jsonField: 'scan',
    subject: 'socios de membresía',
  },
};

/**
 * Work that outlives a turn, and files too big to validate inside one.
 *
 * Two tools with one shared discipline: neither of them applies anything. A bulk
 * file is validated row by row against the real catalog and reported back — the
 * person then approves the apply, which goes through the same confirmation card as
 * every other write. A queued task runs with no bearer token at all, so even if the
 * model tried to write from inside it, the bridge would refuse.
 *
 * The alternative — letting the agent apply 300 rows because the person said "sube
 * esto" once — is precisely the class of decision the business rule reserves for a
 * human.
 */
export function createTaskTools({
  tasks,
  attachments,
}: TaskToolDeps): RegisteredTool[] {
  return [
    {
      name: 'queue_task',
      domain: 'tasks',
      readOnly: true,
      description:
        'Deja un trabajo largo corriendo en segundo plano y avisa por la campana al terminar. Úsala SOLO cuando lo que te piden no cabe en una conversación: revisar meses de órdenes, cuadrar cientos de registros, auditar un inventario completo. Antes de llamarla, declara el plan con propose_plan y confírmalo con la persona: un trabajo de fondo no se lanza sin que sepa qué va a hacer. Importante: el trabajo de fondo NO puede aplicar cambios (no hay quién apruebe mientras corre); sirve para revisar, validar y preparar, y lo que encuentre te lo trae para que la persona lo apruebe después. Solo un trabajo a la vez por persona.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description:
              'El objetivo completo y autocontenido del trabajo, con todo el detalle necesario: quien lo ejecuta no verá esta conversación.',
          },
          conversation_id: {
            type: 'number',
            description:
              'Conversación desde la que se pide, para poder retomarla al terminar.',
          },
        },
        required: ['goal'],
      },
      handler: async (args) => {
        try {
          const task = await tasks.enqueue({
            goal: String(args.goal ?? ''),
            conversationId:
              typeof args.conversation_id === 'number'
                ? args.conversation_id
                : undefined,
          });

          return JSON.stringify({
            queued: true,
            task_id: task.id,
            status: task.status,
            note: 'El trabajo quedó corriendo. Dile a la persona que puede seguir con lo suyo y que le avisas por la campana cuando termine; no le prometas un tiempo exacto.',
          });
        } catch (error: any) {
          // The service's message is already written for the person (an active
          // task, no store context), so it is forwarded rather than reworded.
          return JSON.stringify({
            queued: false,
            error:
              error?.response?.message ??
              error?.message ??
              'No pude dejar el trabajo en cola.',
          });
        }
      },
    },
    {
      name: 'bulk_prepare',
      domain: 'tasks',
      readOnly: true,
      description:
        'Valida una carga masiva SIN subir nada, fila por fila, contra los datos reales de la tienda, y devuelve qué filas pasan y cuáles fallan con su causa. Es el paso obligatorio antes de cualquier carga masiva: primero se valida y se le muestra el informe a la persona, y solo si acepta se aplica. Dominios: "productos" y "empleados" (archivo Excel/CSV de la plantilla, pásale attachment_id) y "socios" (padrón escaneado, pásale primero el documento por ai_extract_document y luego el JSON extraído en `extraction`). Si el archivo no corresponde a la plantilla, dilo y ofrécele la plantilla en vez de adivinar las columnas.',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: ['productos', 'empleados', 'socios'],
            description: 'Qué se está cargando.',
          },
          attachment_id: {
            type: 'string',
            description:
              'El archivo de plantilla que la persona adjuntó, por ejemplo "att_41". Para "productos" y "empleados".',
          },
          extraction: {
            type: 'object',
            description:
              'El JSON que devolvió ai_extract_document. Solo para "socios".',
          },
        },
        required: ['domain'],
      },
      handler: async (args) => {
        const target = BULK_ANALYZERS[String(args.domain)];

        if (!target) {
          return JSON.stringify({
            error: `No sé validar cargas masivas de "${args.domain}". Puedo con: ${Object.keys(BULK_ANALYZERS).join(', ')}.`,
          });
        }

        if (target.fileField && !args.attachment_id) {
          return JSON.stringify({
            error: `Para validar ${target.subject} necesito el archivo de la plantilla. Pídeselo a la persona.`,
          });
        }

        if (target.jsonField && !args.extraction) {
          return JSON.stringify({
            error: `Para validar ${target.subject} necesito primero la extracción del documento: llama a ai_extract_document y pásame su resultado en "extraction".`,
          });
        }

        try {
          const request = target.fileField
            ? await (async () => {
                const payload = await attachments.read(
                  String(args.attachment_id),
                );
                return {
                  headers: internalAuthHeaders(),
                  body: buildMultipartBody({
                    file: {
                      buffer: payload.buffer,
                      mimeType: payload.mime_type,
                      fileName: payload.original_name,
                    },
                    fileField: target.fileField!,
                  }) as BodyInit,
                };
              })()
            : {
                headers: internalAuthHeaders({
                  'Content-Type': 'application/json',
                }),
                body: JSON.stringify({
                  [target.jsonField!]: args.extraction,
                }) as BodyInit,
              };

          const response = await fetch(
            `${internalApiBase()}/${target.analyze}`,
            {
              method: 'POST',
              headers: request.headers,
              body: request.body,
            },
          );

          const body = await response.text();

          if (!response.ok) {
            return JSON.stringify({
              validated: false,
              status: response.status,
              detail: body.slice(0, 800),
              note: 'No se pudo validar. Dile a la persona qué pasó y ofrécele la plantilla oficial; no inventes las columnas que faltan.',
            });
          }

          return JSON.stringify({
            validated: true,
            subject: target.subject,
            apply_with: target.apply,
            report:
              body.length > MAX_REPORT_CHARS
                ? body.slice(0, MAX_REPORT_CHARS)
                : body,
            note: `Nada se subió todavía. Resúmele cuántas filas pasan y cuáles fallan con su causa —fila por fila si son pocas— y pregúntale si aplica solo las válidas. Si dice que sí, aplica con write_endpoint sobre "${target.apply}" con los datos que devolvió este informe (el identificador de sesión o el padrón validado, según lo que traiga), y le volverá a pedir aprobación. Nunca digas cuántas filas se cargaron antes de aplicar.`,
          });
        } catch (error: any) {
          logger.warn(`bulk_prepare failed: ${error?.message}`);
          return JSON.stringify({
            validated: false,
            error:
              error?.response?.message ??
              error?.message ??
              'No pude validar el archivo.',
          });
        }
      },
    },
  ];
}
