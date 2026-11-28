/**
 * `ai_engine_applications` keys the backend resolves by key at runtime.
 *
 * Deleting one of these rows from Super Admin breaks a live feature (voice,
 * Vex, Vexi, scanners, summaries…) until someone recreates it by hand, so the
 * panel refuses the delete (`AI_APP_006`) and only lets the operator edit or
 * turn the app off.
 *
 * Keep this list in sync with the code: `system-app-keys.spec.ts` scans the
 * backend sources for keys used by constant, `appKey`, `app_key`, `run*()` and
 * the toolbox maps, and fails when one is missing here.
 */
export const SYSTEM_AI_APP_KEYS: ReadonlySet<string> = new Set([
  // Agents (Vex, Vexi) and their helpers.
  'vex_assistant',
  'vex_analysis',
  'vex_classifier',
  'vex_context_summarizer',
  'vex_title_generator',
  'vexi_storefront',
  'chat_assistant',
  // Misuse guardrail (classifier + canned responder) in front of Vex/Vexi.
  'agent_guardrail',
  'agent_guardrail_responder',
  // Voice shared by the agents.
  'vexi_voice_tts',
  'vexi_voice_stt',
  'vexi_realtime_voice',
  // Embeddings / RAG.
  'product_embeddings',
  'agent_knowledge_embeddings',
  // Document scanners (OCR / vision).
  'invoice_ocr',
  'invoice_ocr_ingredient',
  'invoice_ocr_revalidate',
  'invoice_draft_ocr',
  'payment_receipt_ocr',
  'expense_invoice_ocr',
  'inventory_count_ocr',
  'rut_scanner',
  'dian_resolution_scanner',
  'dian_habilitation_scanner',
  'route_sheet_ocr',
  'member_roster_ocr',
  'customer_import_ocr',
  'received_document_ocr',
  // Summaries and text generation.
  'cash_register_closing_summary',
  'customer_history_summary',
  'consultation_prediagnosis',
  'crm_landing_generator',
  'data_collection_template_builder',
  'workflow_ai_step',
  'workflow_insights_summary',
  'workflow_document_extract',
  // Marketing and product content.
  'marketing_ad_image_generator',
  'marketing_ad_prompt_specialist',
  'marketing_ad_post_copywriter',
  'product_image_enhancer',
  'product_image_generator',
  'product_description_creator',
]);

export function isSystemAppKey(key: string | null | undefined): boolean {
  return !!key && SYSTEM_AI_APP_KEYS.has(key);
}
