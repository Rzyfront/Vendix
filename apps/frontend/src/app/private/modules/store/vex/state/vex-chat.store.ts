import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { VexConversation, VexMessage } from '../models/vex.models';

const AGENT_REPLY_DELAY_MS = 900;
const TITLE_MAX_LENGTH = 40;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function buildMessage(
  role: VexMessage['role'],
  content: string,
  created_at: Date,
): VexMessage {
  return { id: crypto.randomUUID(), role, content, created_at };
}

function buildSeed(): VexConversation[] {
  return [
    {
      id: crypto.randomUUID(),
      title: 'Resumen de ventas de la semana',
      created_at: minutesAgo(60 * 3),
      updated_at: minutesAgo(60 * 3 - 1),
      messages: [
        buildMessage('user', 'Dame un resumen de las ventas de esta semana.', minutesAgo(60 * 3)),
        buildMessage(
          'agent',
          'Esta semana vendiste $12.480.000 COP en 143 órdenes. El día más fuerte fue el sábado y el producto más vendido fue el combo familiar.',
          minutesAgo(60 * 3 - 1),
        ),
      ],
    },
    {
      id: crypto.randomUUID(),
      title: 'Productos con bajo stock',
      created_at: minutesAgo(60 * 26),
      updated_at: minutesAgo(60 * 25),
      messages: [
        buildMessage('user', '¿Qué productos tienen bajo stock?', minutesAgo(60 * 26)),
        buildMessage(
          'agent',
          'Hay 5 productos por debajo del mínimo: Aceite 1L (3 und), Arroz 500g (6 und), Café molido (2 und), Azúcar 1kg (4 und) y Leche entera (5 und).',
          minutesAgo(60 * 25),
        ),
      ],
    },
    {
      id: crypto.randomUUID(),
      title: 'Cuadre de caja de ayer',
      created_at: minutesAgo(60 * 50),
      updated_at: minutesAgo(60 * 49),
      messages: [
        buildMessage('user', 'Muéstrame el cuadre de caja de ayer.', minutesAgo(60 * 50)),
        buildMessage(
          'agent',
          'La caja cerró con $2.150.000 COP en efectivo contados frente a $2.150.000 esperados. Diferencia: $0.',
          minutesAgo(60 * 49),
        ),
      ],
    },
  ];
}

@Injectable()
export class VexChatStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly pending_timeouts = new Set<ReturnType<typeof setTimeout>>();

  private readonly _conversations = signal<VexConversation[]>(buildSeed());
  private readonly _active_id = signal<string | null>(null);
  private readonly _search_term = signal('');
  private readonly _is_agent_typing = signal(false);
  private readonly _selected_model_id = signal('vex-flash');

  readonly conversations = computed(() =>
    [...this._conversations()].sort(
      (a, b) => b.updated_at.getTime() - a.updated_at.getTime(),
    ),
  );
  readonly active_id = this._active_id.asReadonly();
  readonly active_conversation = computed<VexConversation | null>(() => {
    const id = this._active_id();
    if (!id) return null;
    return this._conversations().find((c) => c.id === id) ?? null;
  });
  readonly search_term = this._search_term.asReadonly();
  readonly filtered_conversations = computed(() => {
    const term = normalizeText(this._search_term().trim());
    const all = this.conversations();
    if (!term) return all;
    return all.filter(
      (c) =>
        normalizeText(c.title).includes(term) ||
        c.messages.some((m) => normalizeText(m.content).includes(term)),
    );
  });
  readonly is_agent_typing = this._is_agent_typing.asReadonly();
  readonly selected_model_id = this._selected_model_id.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.pending_timeouts.forEach((t) => clearTimeout(t));
      this.pending_timeouts.clear();
    });
  }

  newConversation(): void {
    this._active_id.set(null);
  }

  selectConversation(id: string): void {
    if (this._conversations().some((c) => c.id === id)) {
      this._active_id.set(id);
    }
  }

  setSearchTerm(term: string): void {
    this._search_term.set(term);
  }

  setModel(id: string): void {
    this._selected_model_id.set(id);
  }

  sendMessage(content: string): void {
    const text = content.trim();
    if (!text || this._is_agent_typing()) return;

    const now = new Date();
    const user_message = buildMessage('user', text, now);
    let conversation_id = this._active_id();

    if (conversation_id && this._conversations().some((c) => c.id === conversation_id)) {
      const id = conversation_id;
      this._conversations.update((list) =>
        list.map((c) =>
          c.id === id
            ? { ...c, messages: [...c.messages, user_message], updated_at: now }
            : c,
        ),
      );
    } else {
      conversation_id = crypto.randomUUID();
      const created: VexConversation = {
        id: conversation_id,
        title: text.slice(0, TITLE_MAX_LENGTH),
        messages: [user_message],
        created_at: now,
        updated_at: now,
      };
      this._conversations.update((list) => [created, ...list]);
      this._active_id.set(conversation_id);
    }

    this._is_agent_typing.set(true);
    const target_id = conversation_id;

    const timeout = setTimeout(() => {
      this.pending_timeouts.delete(timeout);
      const reply_at = new Date();
      const reply = buildMessage(
        'agent',
        `Entendido. Estoy trabajando en: "${text}". (Respuesta simulada — Vex aún no está conectado.)`,
        reply_at,
      );
      this._conversations.update((list) =>
        list.map((c) =>
          c.id === target_id
            ? { ...c, messages: [...c.messages, reply], updated_at: reply_at }
            : c,
        ),
      );
      this._is_agent_typing.set(false);
    }, AGENT_REPLY_DELAY_MS);
    this.pending_timeouts.add(timeout);
  }

  deleteConversation(id: string): void {
    this._conversations.update((list) => list.filter((c) => c.id !== id));
    if (this._active_id() === id) {
      this._active_id.set(null);
    }
  }
}
