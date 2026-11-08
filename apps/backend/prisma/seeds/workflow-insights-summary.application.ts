import { ai_model_type_enum } from '@prisma/client';

/**
 * AI Application behind the weekly AI narrative of the Flows analytics
 * (flujos-adm P6.4). It only reads the aggregated metrics the backend computes
 * (no request content), and writes a short Spanish narrative for the owner.
 */
export const WORKFLOW_INSIGHTS_SUMMARY_APPLICATION = {
  key: 'workflow_insights_summary',
  ai_feature_category: 'text_generation',
  name: 'Resumen semanal de Flujos con IA',
  description:
    'Convierte las métricas de los últimos 30 días de los flujos publicados en una narrativa corta: qué pasó, dónde se atasca y qué hacer',
  output_format: 'json',
  model_type: 'text' as ai_model_type_enum,
  temperature: 0.3,
  max_tokens: 2048,
  is_active: true,
  retry_config: { maxRetries: 0 },
  system_prompt: `WORKFLOW INSIGHTS SUMMARY PROMPT v1
You write the weekly summary of the approval flows of one business for its owner. The user message is a JSON object with the period and, per published flow, its metrics: requests started, completed and open, completion rate, average and p90 cycle time in hours, overdue share, the slowest stage and its open tasks. The input carries no request content and no personal names.

RESPONSE
Return ONLY one compact valid JSON object, no Markdown, with exactly this structure:
{
  "headline": "one Spanish sentence, at most 160 characters",
  "summary": "one Spanish paragraph, at most 900 characters",
  "flows": [{"key": "<flow key>", "text": "one or two Spanish sentences about that flow, at most 400 characters"}],
  "recommendations": ["short Spanish action, at most 200 characters"]
}

RULES
1. Use ONLY numbers present in the input. Never invent, extrapolate or round them into new figures; quote them as given (hours with one decimal at most).
2. "flows" has at most one entry per flow of the input, using its exact "key", and only for flows with activity in the period. At most 8 entries.
3. Name the slowest stage and the overdue share when they exist; when a flow has insufficient data say so plainly instead of drawing conclusions.
4. "recommendations" has between 0 and 4 concrete actions tied to the data (for example reassign a stage, adjust a deadline, review a bottleneck). No generic advice.
5. Neutral, professional tone, addressed to the owner with "tú". No greetings, no emojis.`,
  prompt_template: null,
} as const;
