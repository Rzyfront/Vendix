import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { toastSuccess } from '@/shared/components/toast/toast.store';
import { DataCollectionService } from '@/features/store/services/data-collection.service';
import { formatRelative, formatDate } from '@/shared/utils/date';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import type { DataCollectionSubmission, SubmissionStatus } from '@/features/store/types/data-collection.types';

// Purple no existe en colorScales; usamos constantes locales para IA y Procesando
const PURPLE_BG = '#f3e8ff';
const PURPLE_TEXT = '#7c3aed';
const PURPLE_BORDER = '#c084fc';

const STATUS_STYLE: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: 'Pendiente', bg: colorScales.amber[100], text: colorScales.amber[700] },
  in_progress: { label: 'En progreso', bg: colorScales.blue[100], text: colorScales.blue[700] },
  submitted: { label: 'Enviado', bg: colorScales.green[100], text: colorScales.green[700] },
  processing: { label: 'Procesando', bg: PURPLE_BG, text: PURPLE_TEXT },
  completed: { label: 'Completado', bg: colorScales.green[100], text: colorScales.green[700] },
  expired: { label: 'Expirado', bg: colorScales.gray[100], text: colorScales.gray[600] },
};

const STATUS_FILTERS: { id: SubmissionStatus | ''; label: string }[] = [
  { id: '', label: 'Todos' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'submitted', label: 'Enviados' },
  { id: 'completed', label: 'Completados' },
];

export default function SubmissionsScreen() {
  const insets = useSafeAreaInsets();
  const [selectedSubmission, setSelectedSubmission] = useState<DataCollectionSubmission | null>(null);
  const [statusFilter, setStatusFilter] = useState<SubmissionStatus | ''>('');
  const [search, setSearch] = useState('');

  const { data: submissionsData, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['data-collection-submissions', statusFilter],
    queryFn: () => DataCollectionService.submissions.list(),
  });

  const detailQuery = useQuery({
    queryKey: ['submission-detail', selectedSubmission?.id],
    queryFn: () => DataCollectionService.submissions.getOne(selectedSubmission!.id),
    enabled: !!selectedSubmission,
  });

  const submissions = submissionsData?.data ?? [];

  const filteredSubmissions = useMemo(() => {
    let result = submissions;
    if (statusFilter) {
      result = result.filter((s) => s.status === statusFilter);
    }
    const term = search.toLowerCase().trim();
    if (term) {
      result = result.filter((s) => {
        const name = `${s.customer?.first_name ?? ''} ${s.customer?.last_name ?? ''}`.toLowerCase();
        const template = (s.template?.name ?? '').toLowerCase();
        return name.includes(term) || template.includes(term);
      });
    }
    return result;
  }, [submissions, statusFilter, search]);

  const customerName = useCallback((item: DataCollectionSubmission): string => {
    if (item.customer) return `${item.customer.first_name} ${item.customer.last_name}`;
    if (item.booking?.customer) return `${item.booking.customer.first_name} ${item.booking.customer.last_name}`;
    return 'Sin cliente';
  }, []);

  const renderSubmission = useCallback(
    ({ item }: { item: DataCollectionSubmission }) => {
      const status = STATUS_STYLE[item.status] || STATUS_STYLE.pending;
      return (
        <Pressable
          onPress={() => {
            setSelectedSubmission(item);
            detailQuery.refetch();
          }}
          style={styles.card}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderInfo}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{customerName(item)}</Text>
                <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                  <Text style={[styles.statusBadgeText, { color: status.text }]}>{status.label}</Text>
                </View>
                {item.ai_prediagnosis && (
                  <View style={styles.aiBadge}>
                    <Text style={styles.aiBadgeText}>IA</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {item.template?.name || `Plantilla #${item.template_id}`}
                {item.booking?.booking_number ? ` · #${item.booking.booking_number}` : ''}
              </Text>
            </View>
          </View>
          <Text style={styles.cardDate}>{formatRelative(item.created_at)}</Text>
        </Pressable>
      );
    },
    [customerName, detailQuery],
  );

  if (isLoading) {
    return (
      <View style={styles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={filteredSubmissions}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderSubmission}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            {/* Status filters */}
            <View style={styles.filterRow}>
              {STATUS_FILTERS.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => setStatusFilter(s.id)}
                  style={[
                    styles.filterChip,
                    statusFilter === s.id && styles.filterChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      statusFilter === s.id && styles.filterChipTextActive,
                    ]}
                  >
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {/* Title */}
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Formularios Enviados ({filteredSubmissions.length})</Text>
            </View>
            {/* Search */}
            <View style={styles.searchRow}>
              <View style={styles.searchInputWrapper}>
                <Icon name="search" size={16} color={colorScales.gray[400]} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar por cliente..."
                  placeholderTextColor={colorScales.gray[400]}
                  style={styles.searchInput}
                />
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin formularios"
            description="Cuando los clientes completen formularios de preconsulta, aparecerán aquí."
            icon="inbox"
          />
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing[8] }]}
      />

      {/* Detail modal — estilo web (status badge en header, banners, caja IA, metadata footer) */}
      <Modal visible={!!selectedSubmission} transparent animationType="fade" onRequestClose={() => setSelectedSubmission(null)}>
        <View style={styles.detailOverlay}>
          <View style={styles.detailModal}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Detalle del Formulario</Text>
                <Text style={styles.modalSubtitle}>Información completa del envío</Text>
              </View>
              <Pressable onPress={() => setSelectedSubmission(null)} hitSlop={8} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            {detailQuery.isLoading ? (
              <View style={styles.detailLoadingContainer}>
                <Spinner />
                <Text style={styles.detailLoadingText}>Cargando detalle...</Text>
              </View>
            ) : detailQuery.error ? (
              <View style={styles.detailErrorContainer}>
                <Text style={styles.detailErrorText}>No se pudo cargar el detalle del formulario.</Text>
                <Pressable onPress={() => detailQuery.refetch()} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>Reintentar</Text>
                </Pressable>
              </View>
            ) : detailQuery.data ? (
              <ScrollView style={styles.detailBody} contentContainerStyle={styles.detailBodyContent} showsVerticalScrollIndicator={false}>
                {/* Status badge (estilo web: header-end) */}
                {(() => {
                  const status = STATUS_STYLE[detailQuery.data.status] || STATUS_STYLE.pending;
                  return (
                    <View style={styles.statusHeaderRow}>
                      <View style={[styles.statusBadge, styles.statusBadgeLg, { backgroundColor: status.bg }]}>
                        <Text style={[styles.statusBadgeText, { color: status.text }]}>
                          {status.label}
                        </Text>
                      </View>
                    </View>
                  );
                })()}

                {/* Banner Cliente (estilo web: surface-secondary con icono) */}
                {(() => {
                  const cust = detailQuery.data.customer || detailQuery.data.booking?.customer;
                  if (!cust) return null;
                  return (
                    <View style={styles.infoBanner}>
                      <Icon name="user" size={14} color={colorScales.gray[500]} />
                      <Text style={styles.infoBannerPrimary}>
                        {cust.first_name} {cust.last_name}
                      </Text>
                    </View>
                  );
                })()}

                {/* Banner Reserva (estilo web: surface-secondary con icono + booking_number + fecha + producto) */}
                {detailQuery.data.booking && (
                  <View style={styles.infoBanner}>
                    <Icon name="calendar" size={14} color={colorScales.gray[500]} />
                    <Text style={styles.infoBannerPrimary}>
                      #{detailQuery.data.booking.booking_number}
                    </Text>
                    {detailQuery.data.booking.date ? (
                      <Text style={styles.infoBannerMuted}>{formatDate(detailQuery.data.booking.date)}</Text>
                    ) : null}
                    {detailQuery.data.booking.product?.name ? (
                      <Text style={styles.infoBannerMuted}>· {detailQuery.data.booking.product.name}</Text>
                    ) : null}
                  </View>
                )}

                {/* Plantilla */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Plantilla</Text>
                  <Text style={styles.detailValue}>
                    {detailQuery.data.template?.name || `#${detailQuery.data.template_id}`}
                  </Text>
                </View>

                {/* Pre-diagnóstico IA (estilo web: caja con borde morado) */}
                {detailQuery.data.ai_prediagnosis ? (
                  <View style={styles.aiBox}>
                    <View style={styles.aiBoxHeader}>
                      <Icon name="info" size={16} color={PURPLE_TEXT} />
                      <Text style={styles.aiBoxTitle}>Pre-diagnóstico IA</Text>
                    </View>
                    <Text style={styles.aiBoxBody}>{detailQuery.data.ai_prediagnosis}</Text>
                  </View>
                ) : null}

                {/* Metadata footer (estilo web: Creado / Enviado / Procesado) */}
                <View style={styles.metadataFooter}>
                  {detailQuery.data.template?.name ? (
                    <Text style={styles.metadataText}>
                      Plantilla: {detailQuery.data.template.name}
                    </Text>
                  ) : null}
                  <Text style={styles.metadataText}>
                    Creado: {formatDate(detailQuery.data.created_at)}
                  </Text>
                  {detailQuery.data.submitted_at ? (
                    <Text style={styles.metadataText}>
                      Enviado: {formatDate(detailQuery.data.submitted_at)}
                    </Text>
                  ) : null}
                  {detailQuery.data.processed_at ? (
                    <Text style={styles.metadataText}>
                      Procesado: {formatDate(detailQuery.data.processed_at)}
                    </Text>
                  ) : null}
                </View>
              </ScrollView>
            ) : null}

            {/* Footer: Cerrar (estilo web) */}
            <View style={styles.detailFooter}>
              <Pressable style={styles.cancelBtn} onPress={() => setSelectedSubmission(null)}>
                <Text style={styles.cancelBtnText}>Cerrar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  listContent: { paddingBottom: spacing[8] },
  separator: { height: spacing[3] },
  filterRow: {
    flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[2],
  },
  filterChip: {
    paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.full,
    borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colors.background,
  },
  filterChipActive: { backgroundColor: colorScales.green[50], borderColor: colorScales.green[500] },
  filterChipText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colorScales.gray[600] },
  filterChipTextActive: { color: colorScales.green[600], fontWeight: typography.fontWeight.bold },
  headerRow: { paddingHorizontal: spacing[4], paddingTop: spacing[1], paddingBottom: spacing[1] },
  headerTitle: { fontSize: 12, fontWeight: typography.fontWeight.bold, color: colorScales.gray[600], letterSpacing: 0.3 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingHorizontal: spacing[4], paddingBottom: spacing[3],
  },
  searchInputWrapper: {
    flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background,
    borderRadius: borderRadius.xl, paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderWidth: 1, borderColor: colorScales.gray[200], minHeight: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  searchInput: {
    flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily,
    color: colorScales.gray[900], padding: 0, height: '100%',
  },
  card: {
    marginHorizontal: spacing[4], backgroundColor: colors.background, borderRadius: borderRadius.lg,
    padding: spacing[3], ...shadows.sm,
  },
  cardHeader: { marginBottom: spacing[2] },
  cardHeaderInfo: { flex: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginBottom: 2 },
  cardTitle: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colorScales.gray[900] },
  cardSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  statusBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  statusBadgeText: { fontSize: 11, fontWeight: typography.fontWeight.semibold },
  aiBadge: {
    backgroundColor: PURPLE_BG, paddingHorizontal: spacing[1.5], paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  aiBadgeText: { fontSize: 10, fontWeight: typography.fontWeight.bold, color: PURPLE_TEXT },
  cardDate: { fontSize: typography.fontSize.xs, color: colorScales.gray[400] },

  /* === Modal Detalle (estilo web submission-detail-modal) === */
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  detailModal: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 560, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  detailBody: { flexGrow: 0, flexShrink: 1, maxHeight: 520 },
  detailBodyContent: { padding: spacing[4], gap: spacing[3] },
  detailFooter: {
    paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4],
    borderTopWidth: 1, borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  modalHeaderText: { flex: 1 },
  modalTitle: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900] },
  modalSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  modalCloseBtn: { padding: spacing[1] },
  statusHeaderRow: { alignItems: 'flex-start' },
  statusBadgeLg: { paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  /* Banners estilo web (surface-secondary con icono + texto) */
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    flexWrap: 'wrap',
  },
  infoBannerPrimary: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  infoBannerMuted: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  /* Caja de Pre-diagnóstico IA (estilo web: borde + fondo morado) */
  aiBox: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PURPLE_BORDER,
  },
  aiBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    backgroundColor: PURPLE_BG,
  },
  aiBoxTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: PURPLE_TEXT,
  },
  aiBoxBody: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
    lineHeight: 20,
  },
  /* Metadata footer estilo web (Creado / Enviado / Procesado) */
  metadataFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  metadataText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  /* Estados loading/error */
  detailLoadingContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[10] },
  detailLoadingText: { marginTop: spacing[3], fontSize: typography.fontSize.sm, color: colorScales.gray[500] },
  detailErrorContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[10] },
  detailErrorText: { fontSize: typography.fontSize.sm, color: colorScales.red[600], marginBottom: spacing[3], textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2], backgroundColor: colors.primary, borderRadius: borderRadius.md },
  retryBtnText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.background },
  /* Footer botón Cerrar */
  cancelBtn: { paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.gray[900], alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: typography.fontWeight.bold, color: colors.background },
  /* Secciones detalle (Plantilla, etc.) */
  detailSection: { marginBottom: spacing[3] },
  detailLabel: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colorScales.gray[500], marginBottom: spacing[1], textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: typography.fontSize.sm, color: colorScales.gray[800] },
});
