/**
 * Moved to the shared ai-ingest core (plan ia-cargas F2):
 * `common/ai-ingest/documents/document-pages.service.ts`. This path keeps the
 * old names for Documentos recibidos, "Leer con IA" of workflows, base PDF
 * pages and data-collection drafts; it is the SAME class (same DI token).
 */
export {
  DocumentPagesService as ReceivedDocumentPagesService,
  type ReceivedDocumentSourceFile,
  type PreparedReceivedDocumentPage,
  type PreparedReceivedDocumentPages,
} from '../../../common/ai-ingest/documents/document-pages.service';
