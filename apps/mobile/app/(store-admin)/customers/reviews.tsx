import { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { formatDate } from '@/shared/utils/date';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import { ReviewService } from '@/features/store/services/review.service';
import type { Review, ReviewState } from '@/features/store/types/review.types';

const STATE_LABELS: Record<ReviewState, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  hidden: 'Oculta',
  flagged: 'Reportada',
};

const STATE_BADGES: Record<ReviewState, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#d97706' },
  approved: { bg: '#d1fae5', text: '#059669' },
  rejected: { bg: '#fee2e2', text: '#dc2626' },
  hidden: { bg: '#f3f4f6', text: '#6b7280' },
  flagged: { bg: '#fce4ec', text: '#c62828' },
};

const STATE_OPTIONS: { label: string; value?: ReviewState }[] = [
  { label: 'Todos' },
  { label: 'Pendiente', value: 'pending' },
  { label: 'Aprobada', value: 'approved' },
  { label: 'Rechazada', value: 'rejected' },
  { label: 'Oculta', value: 'hidden' },
  { label: 'Reportada', value: 'flagged' },
];

const RATING_OPTIONS: { label: string; value?: number }[] = [
  { label: 'Todos' },
  { label: '1 ★', value: 1 },
  { label: '2 ★', value: 2 },
  { label: '3 ★', value: 3 },
  { label: '4 ★', value: 4 },
  { label: '5 ★', value: 5 },
];

function starRating(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

export default function ReviewsScreen() {
  const { user_id } = useLocalSearchParams<{ user_id?: string }>();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<ReviewState | undefined>();
  const [ratingFilter, setRatingFilter] = useState<number | undefined>();
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showStateDropdown, setShowStateDropdown] = useState(false);
  const [showRatingDropdown, setShowRatingDropdown] = useState(false);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [responseText, setResponseText] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const filterBtnRef = useRef<View>(null);
  const [filterDropdownPos, setFilterDropdownPos] = useState({ top: 0, right: 0 });
  const screenW = Dimensions.get('window').width;

  const handleShowFilters = useCallback(() => {
    const willOpen = !showFilterPanel;
    filterBtnRef.current?.measureInWindow((x, y, width, btnHeight) => {
      setFilterDropdownPos({ top: y + btnHeight + 6, right: screenW - x - width });
      setShowFilterPanel(willOpen);
      if (!willOpen) { setShowStateDropdown(false); setShowRatingDropdown(false); }
    });
  }, [screenW, showFilterPanel]);

  const activeFilterCount = (stateFilter ? 1 : 0) + (ratingFilter != null ? 1 : 0);

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['review-stats'],
    queryFn: () => ReviewService.stats(),
  });

  const { data: reviewsData, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['reviews', search, stateFilter, ratingFilter],
    queryFn: () => ReviewService.list({ search: search || undefined, state: stateFilter, rating: ratingFilter, user_id: user_id ? Number(user_id) : undefined }),
  });

  const { data: reviewDetail, refetch: refetchDetail } = useQuery({
    queryKey: ['review-detail', selectedReview?.id],
    queryFn: () => ReviewService.getOne(selectedReview!.id),
    enabled: !!selectedReview,
  });

  const reviews = reviewsData?.data ?? [];

  const handleAction = useCallback(async (id: number, action: 'approve' | 'reject' | 'hide' | 'delete') => {
    setActionLoading(id);
    try {
      if (action === 'approve') await ReviewService.approve(id);
      else if (action === 'reject') await ReviewService.reject(id);
      else if (action === 'hide') await ReviewService.hide(id);
      else if (action === 'delete') await ReviewService.delete(id);
      refetch();
      refetchStats();
      refetchDetail();
    } finally {
      setActionLoading(null);
    }
  }, [refetch, refetchStats, refetchDetail]);

  const handleRespond = useCallback(async () => {
    if (!selectedReview || !responseText.trim()) return;
    const existing = reviewDetail?.review_responses;
    setActionLoading(selectedReview.id);
    try {
      if (existing) {
        await ReviewService.updateResponse(selectedReview.id, responseText.trim());
      } else {
        await ReviewService.createResponse(selectedReview.id, responseText.trim());
      }
      setResponseText('');
      refetchDetail();
    } finally {
      setActionLoading(null);
    }
  }, [selectedReview, responseText, reviewDetail, refetchDetail]);

  const handleDeleteResponse = useCallback(async () => {
    if (!selectedReview) return;
    setActionLoading(selectedReview.id);
    try {
      await ReviewService.deleteResponse(selectedReview.id);
      setResponseText('');
      refetchDetail();
    } finally {
      setActionLoading(null);
    }
  }, [selectedReview, refetchDetail]);

  const renderReview = useCallback(
    ({ item }: { item: Review }) => {
      const badge = STATE_BADGES[item.state];
      return (
        <Pressable
          onPress={() => setSelectedReview(item)}
          style={styles.reviewCard}
        >
          <View style={styles.cardTop}>
            <View style={styles.cardTopInfo}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.products.name}
              </Text>
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {item.users.first_name} {item.users.last_name}
              </Text>
            </View>
            <View style={[styles.cardBadge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.cardBadgeText, { color: badge.text }]}>
                {STATE_LABELS[item.state]}
              </Text>
            </View>
          </View>

          <Text style={styles.cardStars}>{starRating(item.rating)}</Text>

          <Text style={styles.cardComment} numberOfLines={2}>
            {item.comment}
          </Text>

          <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
        </Pressable>
      );
    },
    [],
  );

  if (isLoading && !reviews.length) {
    return (
      <View style={styles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={reviews}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderReview}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            <StatsGrid
              items={[
                {
                  label: 'Pendientes',
                  value: String(stats?.pending_count ?? 0),
                  icon: 'clock',
                  iconBg: '#fef3c7',
                  iconColor: '#d97706',
                  description: 'Por aprobar',
                },
                {
                  label: 'Aprobadas',
                  value: String(stats?.approved_count ?? 0),
                  icon: 'check-circle',
                  iconBg: '#d1fae5',
                  iconColor: '#059669',
                  description: 'Reseñas visibles',
                },
                {
                  label: 'Calificación Promedio',
                  value: stats?.average_rating != null ? `${stats.average_rating.toFixed(1)} ★` : 'N/A',
                  icon: 'star',
                  iconBg: '#dbeafe',
                  iconColor: '#2563eb',
                  description: 'Sobre 5.0',
                },
                {
                  label: 'Reportadas',
                  value: String(stats?.flagged_count ?? 0),
                  icon: 'flag',
                  iconBg: '#fee2e2',
                  iconColor: '#dc2626',
                  description: 'Requieren revisión',
                },
              ]}
            />
            <View style={styles.searchHeader}>
              <Text style={styles.listTitle}>
                Reseñas ({reviews.length})
              </Text>
            </View>
            <View style={styles.searchRow}>
              <View style={styles.searchInputWrapper}>
                <Icon name="search" size={16} color={colorScales.gray[400]} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar por producto o cliente..."
                  placeholderTextColor={colorScales.gray[400]}
                  style={styles.searchInput}
                />
              </View>
              <Pressable
                ref={filterBtnRef}
                onPress={handleShowFilters}
                style={styles.searchFilterBtn}
              >
                <Icon name="filter" size={18} color={colors.primary} />
                {activeFilterCount > 0 && (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin reseñas"
            description="No hay reseñas registradas"
            icon="star"
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              refetch();
              refetchStats();
            }}
          />
        }
        contentContainerStyle={styles.listContent}
      />

      {/* Filter Dropdown — same style as inventory adjustments */}
      <Modal visible={showFilterPanel} transparent animationType="fade" onRequestClose={() => { setShowFilterPanel(false); setShowStateDropdown(false); setShowRatingDropdown(false); }}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => { setShowFilterPanel(false); setShowStateDropdown(false); setShowRatingDropdown(false); }} />
        <View style={[styles.dropdownPositioner, { top: filterDropdownPos.top, right: filterDropdownPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: Math.max(filterDropdownPos.right, 14) }]} />
          <View style={styles.dropdown}>
            <Text style={styles.dropdownTitle}>Filtros</Text>
            <View style={styles.dropdownDivider} />
            <View style={styles.dropdownFilterRow}>
              <Text style={styles.dropdownFilterLabel}>Estado</Text>
              <Pressable onPress={() => setShowStateDropdown((v) => !v)} style={styles.dropdownSelectBtn}>
                <Text style={styles.dropdownSelectText}>
                  {stateFilter ? STATE_OPTIONS.find((o) => o.value === stateFilter)?.label : 'Todos'}
                </Text>
                <Icon name="chevron-down" size={14} color="#6b7280" />
              </Pressable>
            </View>
            <View style={styles.dropdownDivider} />
            {showStateDropdown && (
              <View>
                {STATE_OPTIONS.map((opt) => (
                  <Pressable key={opt.label} style={[styles.dropdownOption, stateFilter === opt.value && styles.dropdownOptionActive]} onPress={() => { setStateFilter(opt.value); setShowStateDropdown(false); setShowFilterPanel(false); }}>
                    <Text style={[styles.dropdownOptionText, stateFilter === opt.value && styles.dropdownOptionTextActive]}>{opt.label}</Text>
                    {stateFilter === opt.value && <Icon name="check" size={16} color="#22C55E" />}
                  </Pressable>
                ))}
              </View>
            )}
            {!showStateDropdown && (
              <>
                <View style={styles.dropdownFilterRow}>
                  <Text style={styles.dropdownFilterLabel}>Calificación</Text>
                  <Pressable onPress={() => setShowRatingDropdown((v) => !v)} style={styles.dropdownSelectBtn}>
                    <Text style={styles.dropdownSelectText}>
                      {ratingFilter != null ? RATING_OPTIONS.find((o) => o.value === ratingFilter)?.label : 'Todos'}
                    </Text>
                    <Icon name="chevron-down" size={14} color="#6b7280" />
                  </Pressable>
                </View>
                <View style={styles.dropdownDivider} />
                {showRatingDropdown && (
                  <View>
                    {RATING_OPTIONS.map((opt) => (
                      <Pressable key={opt.label} style={[styles.dropdownOption, ratingFilter === opt.value && styles.dropdownOptionActive]} onPress={() => { setRatingFilter(opt.value); setShowRatingDropdown(false); setShowFilterPanel(false); }}>
                        <Text style={[styles.dropdownOptionText, ratingFilter === opt.value && styles.dropdownOptionTextActive]}>{opt.label}</Text>
                        {ratingFilter === opt.value && <Icon name="check" size={16} color="#22C55E" />}
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {selectedReview && (
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedReview(null)} />
          <ScrollView style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Detalle de Reseña</Text>
              <Pressable onPress={() => setSelectedReview(null)}>
                <Icon name="x" size={20} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            {reviewDetail ? (
              <>
                <View style={styles.detailProductRow}>
                  {reviewDetail.products.image_url ? (
                    <View style={styles.detailProductImage} />
                  ) : (
                    <View style={styles.detailProductPlaceholder}>
                      <Icon name="package" size={24} color={colorScales.gray[400]} />
                    </View>
                  )}
                  <View style={styles.detailProductInfo}>
                    <Text style={styles.detailProductName}>{reviewDetail.products.name}</Text>
                    <Text style={styles.detailCustomerName}>
                      {reviewDetail.users.first_name} {reviewDetail.users.last_name}
                    </Text>
                  </View>
                </View>

                <View style={styles.detailRatingRow}>
                  <Text style={styles.detailStars}>{starRating(reviewDetail.rating)}</Text>
                  <View
                    style={[
                      styles.detailBadge,
                      { backgroundColor: STATE_BADGES[reviewDetail.state].bg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.detailBadgeText,
                        { color: STATE_BADGES[reviewDetail.state].text },
                      ]}
                    >
                      {STATE_LABELS[reviewDetail.state]}
                    </Text>
                  </View>
                  {reviewDetail.verified_purchase && (
                    <View style={styles.verifiedBadge}>
                      <Text style={styles.verifiedBadgeText}>Compra verificada</Text>
                    </View>
                  )}
                </View>

                {reviewDetail.title && (
                  <Text style={styles.detailTitle}>{reviewDetail.title}</Text>
                )}
                <Text style={styles.detailComment}>{reviewDetail.comment}</Text>

                <View style={styles.detailMeta}>
                  <Text style={styles.detailMetaText}>
                    {formatDate(reviewDetail.created_at)} | {reviewDetail.helpful_count} votos útiles
                    {reviewDetail.report_count > 0
                      ? ` | ${reviewDetail.report_count} reportes`
                      : ''}
                  </Text>
                </View>

                <View style={styles.detailActions}>
                  {reviewDetail.state !== 'approved' && (
                    <Pressable
                      onPress={() => handleAction(reviewDetail.id, 'approve')}
                      style={styles.actionApprove}
                    >
                      <Icon name="check" size={16} color="#15803d" />
                      <Text style={styles.actionApproveText}>Aprobar</Text>
                    </Pressable>
                  )}
                  {reviewDetail.state !== 'rejected' && (
                    <Pressable
                      onPress={() => handleAction(reviewDetail.id, 'reject')}
                      style={styles.actionReject}
                    >
                      <Icon name="x" size={16} color="#b91c1c" />
                      <Text style={styles.actionRejectText}>Rechazar</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => handleAction(reviewDetail.id, 'hide')}
                    style={styles.actionNeutral}
                  >
                    <Icon name="eye-off" size={16} color={colorScales.gray[600]} />
                    <Text style={styles.actionNeutralText}>Ocultar</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleAction(reviewDetail.id, 'delete')}
                    style={styles.actionNeutral}
                  >
                    <Icon name="trash-2" size={16} color={colorScales.gray[600]} />
                    <Text style={styles.actionNeutralText}>Eliminar</Text>
                  </Pressable>
                </View>

                {reviewDetail.review_reports && reviewDetail.review_reports.length > 0 && (
                  <View style={styles.reportsSection}>
                    <Text style={styles.reportsTitle}>
                      Reportes de clientes ({reviewDetail.review_reports.length})
                    </Text>
                    {reviewDetail.review_reports.map((report) => (
                      <View key={report.id} style={styles.reportCard}>
                        <Text style={styles.reportReason}>{report.reason}</Text>
                        <Text style={styles.reportMeta}>
                          {report.users?.first_name} {report.users?.last_name} —{' '}
                          {formatDate(report.created_at)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.responseSection}>
                  <Text style={styles.responseTitle}>Respuesta de la tienda</Text>
                  {reviewDetail.review_responses ? (
                    <>
                      <View style={styles.responseCard}>
                        <Text style={styles.responseContent}>
                          {reviewDetail.review_responses.content}
                        </Text>
                        <Text style={styles.responseDate}>
                          {formatDate(reviewDetail.review_responses.created_at)}
                        </Text>
                      </View>
                      <View style={styles.responseLinks}>
                        <Pressable
                          onPress={() => setResponseText(reviewDetail.review_responses!.content)}
                        >
                          <Text style={styles.responseLinkText}>Editar</Text>
                        </Pressable>
                        <Text style={styles.responseLinkSep}>|</Text>
                        <Pressable onPress={handleDeleteResponse}>
                          <Text style={[styles.responseLinkText, { color: '#dc2626' }]}>
                            Eliminar
                          </Text>
                        </Pressable>
                      </View>
                      {responseText ? (
                        <View style={styles.responseForm}>
                          <TextInput
                            value={responseText}
                            onChangeText={setResponseText}
                            placeholder="Escribe una respuesta..."
                            placeholderTextColor={colorScales.gray[400]}
                            style={styles.responseInput}
                            multiline
                          />
                          <View style={styles.responseFormActions}>
                            <Pressable onPress={() => setResponseText('')}>
                              <Text style={styles.cancelBtnText}>Cancelar</Text>
                            </Pressable>
                            <Pressable
                              onPress={handleRespond}
                              style={styles.submitBtn}
                              disabled={!responseText.trim() || actionLoading === reviewDetail.id}
                            >
                              <Text style={styles.submitBtnText}>
                                {actionLoading === reviewDetail.id ? 'Guardando...' : 'Guardar'}
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <View style={styles.responseForm}>
                      <TextInput
                        value={responseText}
                        onChangeText={setResponseText}
                        placeholder="Escribe una respuesta..."
                        placeholderTextColor={colorScales.gray[400]}
                        style={styles.responseInput}
                        multiline
                      />
                      <View style={styles.responseFormActions}>
                        <Pressable onPress={() => setResponseText('')}>
                          <Text style={styles.cancelBtnText}>Cancelar</Text>
                        </Pressable>
                        <Pressable
                          onPress={handleRespond}
                          style={styles.submitBtn}
                          disabled={!responseText.trim() || actionLoading === reviewDetail.id}
                        >
                          <Text style={styles.submitBtnText}>
                            {actionLoading === reviewDetail.id ? 'Guardando...' : 'Enviar'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              </>
            ) : (
              <Spinner />
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  listContent: {
    paddingBottom: spacing[8],
  },
  separator: {
    height: spacing[3],
  },
  searchHeader: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    marginBottom: spacing[4],
  },
  listTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colorScales.gray[600],
    letterSpacing: 0.3,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    minHeight: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    padding: 0,
    height: '100%',
  },
  searchFilterBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#22C55E',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  /* Dropdown filters (matching inventory adjustments style) */
  dropdownBackdrop: { flex: 1 },
  dropdownPositioner: { position: 'absolute', alignItems: 'flex-end' },
  dropdownArrow: {
    width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fff',
    marginRight: 14, marginBottom: -1,
  },
  dropdown: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: colorScales.gray[200],
    minWidth: 200, ...shadows.lg,
  },
  dropdownTitle: { fontSize: 12, fontWeight: '700', color: colorScales.gray[500], paddingVertical: spacing[2], paddingHorizontal: spacing[3], letterSpacing: 0.3, textTransform: 'uppercase' as any },
  dropdownDivider: { height: 1, backgroundColor: colorScales.gray[100] },
  dropdownFilterRow: { paddingVertical: spacing[2], paddingHorizontal: spacing[3], gap: spacing[1] },
  dropdownFilterLabel: { fontSize: 11, fontWeight: '600' as any, color: colorScales.gray[500], letterSpacing: 0.5, textTransform: 'uppercase' as any },
  dropdownSelectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: spacing[2], borderRadius: 6, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colorScales.gray[50], marginTop: 4 },
  dropdownSelectText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[800] },
  dropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2], paddingHorizontal: spacing[3] },
  dropdownOptionActive: { backgroundColor: '#f0fdf4' },
  dropdownOptionText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownOptionTextActive: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: '#16a34a' },
  reviewCard: {
    marginHorizontal: spacing[4],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    ...shadows.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
  },
  cardTopInfo: {
    flex: 1,
    marginRight: spacing[2],
  },
  cardTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  cardSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 1,
  },
  cardBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  cardBadgeText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold,
  },
  cardStars: {
    fontSize: typography.fontSize.sm,
    color: '#eab308',
    marginBottom: spacing[1],
  },
  cardComment: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
    lineHeight: 20,
    marginBottom: spacing[2],
  },
  cardDate: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    maxHeight: '80%',
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing[4],
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[4],
  },
  modalTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  detailProductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[3],
  },
  detailProductImage: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    marginRight: spacing[3],
  },
  detailProductPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  detailProductInfo: {
    flex: 1,
  },
  detailProductName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  detailCustomerName: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  detailRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  detailStars: {
    fontSize: typography.fontSize.lg,
    color: '#eab308',
  },
  detailBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  detailBadgeText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold,
  },
  verifiedBadge: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  verifiedBadgeText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold,
    color: '#059669',
  },
  detailTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[2],
  },
  detailComment: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
    lineHeight: 22,
    marginBottom: spacing[3],
  },
  detailMeta: {
    marginBottom: spacing[3],
  },
  detailMetaText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  detailActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginBottom: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  actionApprove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: '#f0fdf4',
  },
  actionApproveText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: '#15803d',
  },
  actionReject: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: '#fef2f2',
  },
  actionRejectText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: '#b91c1c',
  },
  actionNeutral: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
  },
  actionNeutralText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[600],
  },
  reportsSection: {
    marginBottom: spacing[4],
  },
  reportsTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[800],
    marginBottom: spacing[2],
  },
  reportCard: {
    backgroundColor: '#fef2f2',
    padding: spacing[3],
    borderRadius: borderRadius.md,
    marginBottom: spacing[2],
    borderWidth: 1,
    borderColor: '#fee2e2',
  },
  reportReason: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: '#991b1b',
    marginBottom: spacing[1],
  },
  reportMeta: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  responseSection: {
    marginBottom: spacing[4],
  },
  responseTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[800],
    marginBottom: spacing[2],
  },
  responseCard: {
    backgroundColor: '#eff6ff',
    padding: spacing[3],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  responseContent: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
    lineHeight: 20,
    marginBottom: spacing[1],
  },
  responseDate: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  responseLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[1],
    marginBottom: spacing[2],
  },
  responseLinkText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.primary,
  },
  responseLinkSep: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[300],
  },
  responseForm: {
    gap: spacing[2],
  },
  responseInput: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    color: colorScales.gray[900],
    fontSize: typography.fontSize.sm,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  responseFormActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
  },
  cancelBtnText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  submitBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
  },
  submitBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.background,
  },
});
