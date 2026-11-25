import { RegisteredTool, ToolExecutionContext, ToolPreview } from '../interfaces/tool.interface';
import {
  CapabilityCorpusEntry,
  CapabilityMatch,
  capabilityStems,
  findExistingCapabilities,
} from '../capability-gap';
import type {
  CapabilityRequestInput,
  CapabilityRequestStatus,
} from '../../../domains/support/tickets/tickets.service';

export const REQUEST_CAPABILITY = 'request_capability';

/** What the tool needs from `TicketsService`: one ticket per capability. */
export interface CapabilityTicketsPort {
  findCapabilityRequest(
    capabilityKey: string,
    organizationId: number,
    storeId: number,
  ): Promise<CapabilityRequestStatus>;
  recordCapabilityRequest(
    input: CapabilityRequestInput,
  ): Promise<
    CapabilityRequestStatus & { outcome: 'created' | 'voted' | 'already_voted' }
  >;
}

export interface CapabilityRequestToolDeps {
  tickets: CapabilityTicketsPort;
  /** Whole release catalog flagged with the caller's reach (T6). */
  corpus: () => CapabilityCorpusEntry[];
}

/** Only a missing capability opens a ticket; the rest are not product gaps. */
const FAILURE_KINDS = [
  'missing_capability',
  'permission',
  'invalid_data',
  'connection',
] as const;
type FailureKind = (typeof FAILURE_KINDS)[number];

const NOT_A_GAP: Record<Exclude<FailureKind, 'missing_capability'>, string> = {
  permission:
    'Es un tema de permisos, no una capacidad que falte: no se crea ticket. Dile a la persona que se lo pida al dueño de la tienda.',
  invalid_data:
    'Son datos inválidos, no una capacidad que falte: no se crea ticket. Dile a la persona qué dato corregir.',
  connection:
    'Es una falla de conexión, no una capacidad que falte: no se crea ticket. Sugiere reintentar en un momento.',
};

/** `storefront-cart-button-color`: lowercase ASCII words joined by dashes. */
export function normalizeCapabilityKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return key.length >= 3 ? key : null;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

type Resolution =
  | {
      ok: true;
      key: string;
      title: string;
      userRequest: string;
      organizationId: number;
      storeId: number;
      userId: number;
      status: CapabilityRequestStatus;
    }
  | { ok: false; message: string; existing?: CapabilityMatch[] };

function describeExisting(matches: CapabilityMatch[]): string {
  const permitted = matches.filter((m) => m.permitted);
  if (permitted.length) {
    return `Eso ya existe (aunque sea en parte): ${permitted
      .slice(0, 3)
      .map((m) => m.name)
      .join(', ')}. No se crea ticket: usa esa herramienta o explícale a la persona cómo se hace.`;
  }
  return 'Eso ya existe en Vendix, pero el rol de esta persona no lo permite. No se crea ticket: dile que se lo pida al dueño de la tienda.';
}

/**
 * T5/T6 — `request_capability`: asks the Vendix team for a capability Vex
 * does not have, as a support ticket labelled `vex-capability-request`.
 *
 * - Only after the person agrees: it is a write, so it goes through the
 *   confirmation card (the approval IS the consent).
 * - Only for a missing capability: permission, invalid data and connection
 *   failures never open one (`failure_kind`).
 * - Only when the release really lacks it: the person's words are swept
 *   against every tool and bridge route (T6); any partial match refuses.
 * - One ticket per capability: other stores add a vote, never a new ticket.
 */
export function createCapabilityRequestTools(
  deps: CapabilityRequestToolDeps,
): RegisteredTool[] {
  async function resolve(
    args: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<Resolution> {
    const organizationId = context.organization_id;
    const storeId = context.store_id;
    const userId = context.user_id;
    if (!organizationId || !storeId || !userId) {
      return {
        ok: false,
        message:
          'Sin tienda o usuario en contexto: las solicitudes al equipo se hacen desde una tienda.',
      };
    }

    const kind = String(args.failure_kind ?? '') as FailureKind;
    if (!(FAILURE_KINDS as readonly string[]).includes(kind)) {
      return {
        ok: false,
        message: `failure_kind "${args.failure_kind ?? ''}" inválido. Usa ${FAILURE_KINDS.join(', ')}.`,
      };
    }
    if (kind !== 'missing_capability') {
      return { ok: false, message: NOT_A_GAP[kind] };
    }

    const key = normalizeCapabilityKey(args.capability_key);
    if (!key) {
      return {
        ok: false,
        message:
          'capability_key inválida: usa 3 a 60 caracteres que nombren la capacidad («storefront-cart-button-color»).',
      };
    }
    const userRequest = cleanText(args.user_request, 1000);
    if (!userRequest) {
      return {
        ok: false,
        message:
          'user_request es obligatorio: copia lo que pidió la persona, con sus palabras.',
      };
    }
    const title = cleanText(args.title, 120) ?? userRequest.slice(0, 120);

    // Nothing to validate against means no ticket: never file one blind.
    if (!capabilityStems(`${userRequest} ${title}`).length) {
      return {
        ok: false,
        message:
          'No queda claro qué capacidad falta: pide a la persona que diga qué quiere lograr y vuelve a intentarlo.',
      };
    }
    const existing = findExistingCapabilities(
      `${userRequest} ${title}`,
      deps.corpus(),
    );
    if (existing.length) {
      return { ok: false, message: describeExisting(existing), existing };
    }

    const status = await deps.tickets.findCapabilityRequest(
      key,
      organizationId,
      storeId,
    );
    if (status.already_voted) {
      return {
        ok: false,
        message: status.ticket_number
          ? `Esta tienda ya lo pidió: el ticket ${status.ticket_number} sigue abierto. No se crea otro.`
          : 'Esta tienda ya sumó su voto a esa solicitud, que sigue abierta. No se crea otra.',
      };
    }
    return {
      ok: true,
      key,
      title,
      userRequest,
      organizationId,
      storeId,
      userId,
      status,
    };
  }

  return [
    {
      name: REQUEST_CAPABILITY,
      version: '1',
      domain: 'capability_requests',
      access: 'public',
      accessReason:
        'Same reach as POST /support/tickets (any authenticated store user, no permission). It only writes after the person approves the card, and only when the release lacks the capability.',
      requiresConfirmation: true,
      discovery: {
        synonyms: [
          'pedir una función nueva',
          'solicitar herramienta al equipo de Vendix',
          'no puedes hacer esto',
          'reportar que falta una capacidad',
        ],
      },
      description:
        'Pide al equipo de Vendix una capacidad que NO existe (crea un ticket de soporte o suma el voto de esta tienda si otra ya la pidió). Úsala SOLO si la persona acepta tu ofrecimiento. No la uses para errores de permisos, datos inválidos o fallas de conexión: esos no son capacidades faltantes. El servidor revisa todo el catálogo y la rechaza si algo parecido ya existe.',
      parameters: {
        type: 'object',
        properties: {
          capability_key: {
            type: 'string',
            description:
              'Clave corta y estable de la capacidad, en inglés o español sin tildes: «storefront-cart-button-color». La misma capacidad debe llevar la misma clave en cualquier tienda.',
          },
          user_request: {
            type: 'string',
            description: 'Lo que pidió la persona, con sus palabras.',
          },
          title: {
            type: 'string',
            description:
              'Título corto para el equipo: «Cambiar el color del botón del carrito».',
          },
          failure_kind: {
            type: 'string',
            enum: [...FAILURE_KINDS],
            description:
              'Por qué no pudiste: missing_capability (no hay herramienta). permission, invalid_data y connection NO crean ticket.',
          },
        },
        required: ['capability_key', 'user_request', 'failure_kind'],
      },
      preview: async (args, context): Promise<ToolPreview> => {
        const resolved = await resolve(args, context);
        if (!resolved.ok) {
          return {
            status: 'error',
            target: 'Solicitud al equipo de Vendix',
            changes: [],
            message: resolved.message,
            domain: 'support',
          };
        }
        const voting = resolved.status.exists;
        return {
          status: 'ok',
          target: voting
            ? 'Sumar tu voto a una solicitud que ya existe'
            : `Pedir al equipo de Vendix: «${resolved.title}»`,
          changes: [
            {
              field: 'capability',
              label: 'Capacidad',
              from: null,
              to: resolved.title,
            },
          ],
          message: voting
            ? `Otra tienda ya la pidió (${resolved.status.votes} voto(s)); no se crea un ticket nuevo.`
            : 'Se crea un ticket de soporte para el equipo de Vendix.',
          domain: 'support',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-verification: the catalog, or another store's ticket, may have
          // changed since the card was shown.
          const resolved = await resolve(args, context);
          if (!resolved.ok) {
            return JSON.stringify({ error: resolved.message });
          }
          const result = await deps.tickets.recordCapabilityRequest({
            organizationId: resolved.organizationId,
            storeId: resolved.storeId,
            userId: resolved.userId,
            capabilityKey: resolved.key,
            title: resolved.title,
            description: `Solicitud de capacidad desde Vex.\n\nLo que pidió la persona: ${resolved.userRequest}\n\nClave: ${resolved.key}`,
          });
          const summary =
            result.outcome === 'created'
              ? `Listo: le pedí al equipo de Vendix esta capacidad. Tu ticket es ${result.ticket_number}.`
              : result.outcome === 'voted'
                ? `Otra tienda ya lo había pedido: sumé tu voto (${result.votes} tiendas lo piden).`
                : 'Esta tienda ya lo había pedido; la solicitud sigue abierta.';
          return JSON.stringify({
            summary,
            data: {
              outcome: result.outcome,
              capability_key: resolved.key,
              ticket_number: result.ticket_number,
              votes: result.votes,
            },
          });
        } catch (error) {
          return JSON.stringify({
            error: `No se pudo registrar la solicitud: ${error instanceof Error ? error.message : 'error desconocido'}`,
          });
        }
      },
    },
  ];
}
