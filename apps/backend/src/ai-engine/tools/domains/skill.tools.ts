import { RegisteredTool } from '../interfaces/tool.interface';

export interface SkillToolsDeps {
  search(
    query: string,
    limit?: number,
  ): Promise<Array<{ key: string; title: string; module: string | null; score: number }>>;
  load(key: string): Promise<{
    key: string;
    title: string;
    module: string | null;
    version: number;
    body: string;
    candidate_tools: string[];
    help_article_id: number | null;
    video_id: number | null;
    estimated_tokens: number;
    truncated: boolean;
  } | null>;
}

const ACCESS_REASON =
  'Published how-to guides for Vendix processes; they read no business data and grant no permission (every tool they mention is still permission-checked).';

/**
 * `search_skills` / `load_skill`: Vex finds and reads the published version of
 * a "how is X done in Vendix" guide. Drafts and archived skills never reach it.
 */
export function createSkillTools(deps: SkillToolsDeps): RegisteredTool[] {
  return [
    {
      name: 'search_skills',
      access: 'public',
      accessReason: ACCESS_REASON,
      version: '1',
      domain: 'skills',
      readOnly: true,
      description:
        'Busca guías publicadas de «cómo se hace X en Vendix» por significado (cierre de caja, crear producto, emitir factura…). Devuelve clave, título, módulo y puntaje; usa load_skill para leer la guía. Úsala cuando pregunten cómo se hace un proceso.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            maxLength: 500,
            description: 'Pregunta o proceso que la persona quiere aprender.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const query = typeof args.query === 'string' ? args.query : '';
        const results = await deps.search(query, args.limit);
        return JSON.stringify({
          results,
          next_step: results.length
            ? 'Carga la guía más relevante con load_skill y explícala con tus palabras.'
            : 'No hay una guía publicada para esa pregunta; responde con lo que sabes y dilo.',
        });
      },
    },
    {
      name: 'load_skill',
      access: 'public',
      accessReason: ACCESS_REASON,
      version: '1',
      domain: 'skills',
      readOnly: true,
      description:
        'Carga el cuerpo de una guía publicada por su clave (la que devuelve search_skills): pantallas, pasos, errores comunes y herramientas candidatas. Máximo 2000 tokens. Las herramientas candidatas son pistas, no permisos.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', maxLength: 120 },
        },
        required: ['key'],
      },
      handler: async (args) => {
        const key = typeof args.key === 'string' ? args.key : '';
        const skill = await deps.load(key);
        if (!skill)
          return JSON.stringify({
            error_code: 'SKILL_NOT_FOUND',
            error: 'No hay una guía publicada con esa clave.',
            next_step: 'Busca de nuevo con search_skills.',
          });
        return JSON.stringify(skill);
      },
    },
  ];
}
