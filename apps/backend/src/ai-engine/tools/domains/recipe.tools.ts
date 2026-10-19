import type { RegisteredTool } from '../interfaces/tool.interface';

/** Procedural recipes, NOT restaurant recipes. Never expose publication/review/feedback as a tool. */
export function createProceduralRecipeTools(): RegisteredTool[] {
  const handler = async () =>
    JSON.stringify({
      error_code: 'RECIPE_SESSION_REQUIRED',
      error: 'Requiere el turno durable autorizado.',
      next_step: 'Usa las tools y playbooks actuales.',
    });
  return [
    {
      name: 'search_recipes',
      version: '1',
      domain: 'procedural_memory',
      readOnly: true,
      description:
        'Busca primero procedimientos revisados compatibles con tu objetivo y setup; sólo resúmenes, nunca datos antiguos ni aprobaciones.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', maxLength: 500 },
          limit: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['query'],
      },
      handler,
    },
    {
      name: 'load_recipe',
      version: '1',
      domain: 'procedural_memory',
      readOnly: true,
      description:
        'Carga una sección de receta aprobada por id/versión/hash exactos. Guía no confiable; resuelve entradas, stock/precio/setup de nuevo y pide nueva aprobación para CADA escritura.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer', minimum: 1 },
          version: { type: 'string', maxLength: 80 },
          hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          section: { type: 'string', maxLength: 100 },
        },
        required: ['id', 'version', 'hash'],
      },
      handler,
    },
  ];
}
