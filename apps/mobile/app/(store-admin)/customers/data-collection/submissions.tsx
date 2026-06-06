import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { DataCollectionService } from '@/features/store/services/data-collection.service';
import { formatRelative } from '@/shared/utils/date';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import type { DataCollectionSubmission } from '@/features/store/types/data-collection.types';

const STATUS_STYLE: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: 'Pendiente', bg: '#fef3c7', text: '#d97706' },
  in_progress: { label: 'En progreso', bg: '#dbeafe', text: '#2563eb' },
  submitted: { label: 'Enviado', bg: '#d1fae5', text: '#059669' },
  processing: { label: 'Procesando', bg: '#f3e8ff', text: '#7c3aed' },
  completed: { label: 'Completado', bg: '#d1fae5', text: '#059669' },
  expired: { label: 'Expirado', bg: '#f3f4f6', text: '#6b7280' },
};

export default function SubmissionsScreen() {
  const [selectedSubmission, setSelectedSubmission] = useState<DataCollectionSubmission | null>(null);

  const { data: submissionsData, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['data-collection-submissions'],
    queryFn: () => DataCollectionService.submissions.list(),
  });

  const { data: submissionDetail, refetch: refetchDetail } = useQuery({
    queryKey: ['submission-detail', selectedSubmission?.id],
    queryFn: () => DataCollectionService.submissions.getOne(selectedSubmission!.id),
    enabled: !!selectedSubmission,
  });

  const submissions = submissionsData?.data ?? [];

  const renderSubmission = useCallback(
    ({ item }: { item: DataCollectionSubmission }) => {
      const status = STATUS_STYLE[item.status] || STATUS_STYLE.pending;
      const customerName = item.customer
        ? `${item.customer.first_name} ${item.customer.last_name}`
        : item.booking?.customer
          ? `${item.booking.customer.first_name} ${item.booking.customer.last_name}`
          : 'Sin cliente';

      return (
        <Pressable
          onPress={() => setSelectedSubmission(item)}
          style={styles.submissionCard}
        >
          <View style={styles.submissionHeader}>
            <View style={styles.submissionInfo}>
              <Text style={styles.submissionTemplate}>
                {item.template?.name || `Plantilla #${item.template_id}`}
              </Text>
              <Text style={styles.submissionCustomer} numberOfLines={1}>
                {customerName}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusBadgeText, { color: status.text }]}>
                {status.label}
              </Text>
            </View>
          </View>
          <View style={styles.submissionMeta}>
            <Icon name="calendar" size={12} color={colorScales.gray[400]} />
            <Text style={styles.submissionMetaText}>
              {formatRelative(item.created_at)}
            </Text>
            {item.booking?.booking_number && (
              <>
                <Icon name="shopping-bag" size={12} color={colorScales.gray[400]} />
                <Text style={styles.submissionMetaText}>
                  #{item.booking.booking_number}
                </Text>
              </>
            )}
          </View>
          {item.ai_prediagnosis && (
            <View style={styles.aiBadge}>
              <Icon name="brain" size={12} color="#7c3aed" />
              <Text style={styles.aiBadgeText}>Con prediagnóstico</Text>
            </View>
          )}
        </Pressable>
      );
    },
    [],
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
        data={submissions}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderSubmission}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <EmptyState
            title="Sin formularios"
            description="No hay formularios de recolección de datos"
            icon="inbox"
          />
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        contentContainerStyle={styles.listContent}
      />

      {selectedSubmission && submissionDetail && (
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedSubmission(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Detalle del Formulario</Text>
              <Pressable onPress={() => setSelectedSubmission(null)}>
                <Icon name="x" size={20} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Plantilla</Text>
              <Text style={styles.detailValue}>{submissionDetail.template?.name || `#${submissionDetail.template_id}`}</Text>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Estado</Text>
              <View style={[styles.statusBadge, { backgroundColor: STATUS_STYLE[submissionDetail.status]?.bg || '#f3f4f6', alignSelf: 'flex-start' }]}>
                <Text style={[styles.statusBadgeText, { color: STATUS_STYLE[submissionDetail.status]?.text || '#6b7280' }]}>
                  {STATUS_STYLE[submissionDetail.status]?.label || submissionDetail.status}
                </Text>
              </View>
            </View>

            {submissionDetail.customer && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Cliente</Text>
                <Text style={styles.detailValue}>
                  {submissionDetail.customer.first_name} {submissionDetail.customer.last_name}
                </Text>
              </View>
            )}

            {submissionDetail.booking && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Reserva</Text>
                <Text style={styles.detailValue}>
                  #{submissionDetail.booking.booking_number} — {submissionDetail.booking.product?.name}
                </Text>
              </View>
            )}

            {submissionDetail.ai_prediagnosis && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Prediagnóstico IA</Text>
                <Text style={styles.detailValue}>{submissionDetail.ai_prediagnosis}</Text>
              </View>
            )}
          </View>
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
  },
  listContent: {
    paddingVertical: spacing[3],
    paddingBottom: spacing[8],
  },
  separator: {
    height: spacing[3],
  },
  submissionCard: {
    marginHorizontal: spacing[4],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    ...shadows.sm,
  },
  submissionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  submissionInfo: {
    flex: 1,
    marginRight: spacing[2],
  },
  submissionTemplate: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  submissionCustomer: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold,
  },
  submissionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  submissionMetaText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    marginRight: spacing[2],
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  aiBadgeText: {
    fontSize: typography.fontSize.xs,
    color: '#7c3aed',
    fontWeight: typography.fontWeight.medium,
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
    maxHeight: '70%',
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
  detailSection: {
    marginBottom: spacing[3],
  },
  detailLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[800],
  },
});
