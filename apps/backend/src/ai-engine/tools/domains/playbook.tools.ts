import { RegisteredTool } from '../interfaces/tool.interface';

/** State is injected ONLY by the in-process agent loop, never by MCP/voice arguments. */
export function createPlaybookTools(): RegisteredTool[] {
  const outsideLoop = async () =>
    JSON.stringify({
      error_code: 'PLAYBOOK_SESSION_REQUIRED',
      error:
        'Los procesos requieren una sesión autorizada del turno de Vex/Vexi.',
      next_step:
        'Usa las herramientas autorizadas de tu superficie actual; no se cargó ningún proceso.',
    });
  return [
    {
      name: 'search_playbooks',
      version: '1',
      domain: 'playbooks',
      readOnly: true,
      description:
        'Busca procesos Vendix de la versión publicada por intención. Devuelve títulos, entradas, disponibilidad y costo, no cuerpos ni permisos nuevos. Solo dentro de un turno autorizado.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            maxLength: 500,
            description: 'Intención concreta del proceso.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['query'],
      },
      handler: outsideLoop,
    },
    {
      name: 'load_playbook',
      version: '1',
      domain: 'playbooks',
      readOnly: true,
      description:
        'Carga una sección de un proceso publicado por id y versión exactos. Máximo dos procesos activos; presupuesto inicial 2000 tokens por proceso. Poda herramientas no autorizadas y no autoriza escrituras ni sustituye verificaciones.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', maxLength: 100 },
          version: { type: 'string', maxLength: 40 },
          section: {
            type: 'string',
            maxLength: 100,
            description: 'Identificador de sección publicado, opcional.',
          },
        },
        required: ['id', 'version'],
      },
      handler: outsideLoop,
    },
  ];
}
