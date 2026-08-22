import {
  Invoice,
  InvoiceResolution,
  InvoiceStats,
  DianConfig,
  DianDocumentEvent,
} from '../interfaces/invoice.interface';
import { DianRejection } from '../utils/invoicing-errors.util';
import type {
  InvoiceProfile,
  InvoiceProfileDetail,
  InvoiceProfilePageMeta,
  InvoiceProfileState as InvoiceProfileStateLiteral,
  InvoiceProfileVersionSummary,
  ProfilePreviewResult,
} from '../interfaces/invoice-profile.interface';

export interface InvoicingState {
  invoices: Invoice[];
  resolutions: InvoiceResolution[];
  loading: boolean;
  resolutionsLoading: boolean;
  currentInvoice: Invoice | null;
  currentInvoiceLoading: boolean;
  error: string | null;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null;

  // Stats from backend
  stats: InvoiceStats | null;
  loadingStats: boolean;

  // DIAN configs (gate pre-factura)
  dianConfigs: DianConfig[];
  dianConfigsLoading: boolean;
  dianConfigsError: string | null;

  /**
   * Ultimo rechazo de la DIAN con sus motivos enumerados. Vive en el state —y
   * no en un toast— porque es la unica informacion que dice QUE corregir, y
   * tiene que seguir disponible mientras el usuario lee la factura.
   */
  dianRejection: DianRejection | null;

  /**
   * Eventos RADIAN de la factura abierta, con la factura a la que pertenecen.
   *
   * `dianEventsInvoiceId` no es redundante: sin el, los eventos de la factura A
   * seguirian en el store al abrir la B y el detalle los pintaria como suyos —
   * el mismo fallo que `dianRejection` ya resuelve con `invoiceId`.
   */
  dianEvents: DianDocumentEvent[];
  dianEventsInvoiceId: number | null;
  dianEventsLoading: boolean;

  /**
   * Registro de un evento RADIAN en curso. Bandera propia y NO `dianEventsLoading`:
   * reusar la de la carga cambiaria la pista de auditoria por «Cargando eventos…»
   * mientras se firma y transmite el evento, escondiendo justo la lista contra la
   * que el usuario esta comprobando que no lo esta duplicando.
   */
  dianEventRegistering: boolean;

  /**
   * Regeneracion del PDF en curso. Bandera propia y NO `loading`: reusar la de
   * la lista cambiaria la tabla por un spinner mientras se rearma un PDF.
   */
  pdfRegenerating: boolean;

  // ── Perfiles de facturación ───────────────────────────────────────────────
  // Campos planos con prefijo `profile*`, siguiendo el patrón del resto del
  // slice. No se anidan en un sub-objeto: un `profiles: {...}` obligaría a cada
  // reducer a hacer spread de dos niveles, y ese es el sitio donde se pierden
  // banderas sin que nada avise.
  profiles: InvoiceProfile[];
  profilesLoading: boolean;
  profilesMeta: InvoiceProfilePageMeta | null;
  profilesError: string | null;

  currentProfile: InvoiceProfileDetail | null;
  currentProfileLoading: boolean;

  /**
   * Mutación de un perfil en curso. Bandera propia y NO `profilesLoading`:
   * reusar la de la lista cambiaría la tabla por un esqueleto mientras se
   * guarda, y el usuario perdería de vista la fila que está editando.
   */
  profileSaving: boolean;

  profileVersions: InvoiceProfileVersionSummary[];
  /**
   * A qué perfil pertenece el historial cargado.
   *
   * No es redundante — es el mismo defecto que `dianEventsInvoiceId` ya
   * resuelve: sin él, las versiones del perfil A siguen en el store al abrir el
   * B y el historial las pinta como suyas. En un perfil de facturación eso es
   * peor que un dato feo: el diff compararía snapshots de perfiles distintos y
   * mostraría cambios fiscales que nunca ocurrieron.
   */
  profileVersionsProfileId: number | null;
  profileVersionsLoading: boolean;

  /**
   * Última previsualización. Vive en el state y no en el componente porque el
   * editor la consulta desde varias secciones y volver a pedirla en cada cambio
   * de pestaña reconstruiría el XML sin necesidad.
   */
  profilePreview: ProfilePreviewResult | null;
  profilePreviewProfileId: number | null;
  profilePreviewLoading: boolean;
  /**
   * Fallo de la previsualización con su código. Se guarda el CÓDIGO y no sólo
   * el mensaje: `INVOICING_PREVIEW_002` (muestra inutilizable) se corrige en el
   * formulario, mientras `INVOICING_PROFILE_VERSION_001` (historial roto) es un
   * error que el usuario no puede arreglar. Un solo string no distingue eso.
   */
  profilePreviewError: { code: string | null; message: string } | null;

  // Filter-as-state de perfiles, separado del de facturas: comparten slice
  // pero no vista, y un `search` común haría que buscar en una tabla filtrara
  // la otra.
  profilesSearch: string;
  profilesStateFilter: InvoiceProfileStateLiteral | '';
  profilesOperationFilter: string;
  profilesPage: number;
  profilesLimit: number;

  // Filter-as-state
  search: string;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  statusFilter: string;
  typeFilter: string;
  dateFrom: string;
  dateTo: string;
}

export const initialInvoicingState: InvoicingState = {
  invoices: [],
  resolutions: [],
  loading: false,
  resolutionsLoading: false,
  currentInvoice: null,
  currentInvoiceLoading: false,
  error: null,
  meta: null,

  stats: null,
  loadingStats: false,

  dianConfigs: [],
  dianConfigsLoading: false,
  dianConfigsError: null,
  dianRejection: null,

  dianEvents: [],
  dianEventsInvoiceId: null,
  dianEventsLoading: false,
  dianEventRegistering: false,
  pdfRegenerating: false,

  profiles: [],
  profilesLoading: false,
  profilesMeta: null,
  profilesError: null,

  currentProfile: null,
  currentProfileLoading: false,
  profileSaving: false,

  profileVersions: [],
  profileVersionsProfileId: null,
  profileVersionsLoading: false,

  profilePreview: null,
  profilePreviewProfileId: null,
  profilePreviewLoading: false,
  profilePreviewError: null,

  profilesSearch: '',
  profilesStateFilter: '',
  profilesOperationFilter: '',
  profilesPage: 1,
  profilesLimit: 20,

  search: '',
  page: 1,
  limit: 10,
  sortBy: 'created_at',
  sortOrder: 'desc',
  statusFilter: '',
  typeFilter: '',
  dateFrom: '',
  dateTo: '',
};
