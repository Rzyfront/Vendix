import type { ToolStub } from './tool-router.service';

/** Header of the stubs system message (F10/T62); also its lookup key per round. */
export const TOOL_STUBS_HEADER = 'Fichas de herramientas precargadas';

/** One compact line per stub: name — one line (lee|escribe). */
export function toolStubsText(stubs: readonly ToolStub[] | undefined): string {
  if (!stubs)
    return `${TOOL_STUBS_HEADER}: ninguna en esta ronda; ya tienes las definiciones completas.`;
  if (!stubs.length)
    return `${TOOL_STUBS_HEADER}: ninguna todavía. Búscalas con search_tools o llámalas por su nombre exacto.`;
  return [
    `${TOOL_STUBS_HEADER} (sin esquema; usa describe_tool para ver sus argumentos):`,
    ...stubs.map(
      (stub) =>
        `- ${stub.name} — ${stub.one_line} (${stub.access === 'read' ? 'lee' : 'escribe'})`,
    ),
  ].join('\n');
}

/** Routing-text sentence that introduces the stubs and describe_tool (switch on only). */
export const TOOL_STUBS_ROUTING_SENTENCE =
  'Las herramientas precargadas llegan como fichas de una línea, sin esquema: con describe_tool y su nombre exacto ves sus argumentos y ejemplos, y después la llamas directamente.';
