import { useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Pressable, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Badge, Button, EmptyState, Spinner, ConfirmDialog } from '@/shared/components';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { ListItem } from '@/shared/components/list-item/list-item';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { PromotionsService } from '@/features/store/services/promotions.service';
import type { Promotion } from '@/features/store/types/promotions.types';
import { formatCurrency } from '@/shared/utils/currency';
import { formatDate } from '@/shared/utils/date';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import {
  PROMOTION_LABELS,
  PROMOTION_STATE_BADGE_VARIANT,
  PROMOTION_STATE_LABEL,
  PROMOTION_TYPE_LABEL,
  PROMOTION_SCOPE_LABEL,
  PROMOTION_RULE_TYPE_LABEL,
} from '@/features/store/constants/promotion-labels';
import { PromotionUpsertModal } from '@/features/store/components/promotion-upsert-modal';

export default function PromotionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: 'cancel' | 'delete' } | null
  >(null);

  const numericId = id ? Number(id) : 0;

  const { data: promotion, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['promotion', numericId],
    queryFn: () => PromotionsService.getById(numericId),
    enabled: numericId > 0,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['promotions'] });
    queryClient.invalidateQueries({ queryKey: ['promotion', numericId] });
    queryClient.invalidateQueries({ queryKey: ['promotion-stats'] });
  };

  const activateMutation = useMutation({
    mutationFn: () => PromotionsService.activate(numericId),
    onSuccess: (res) => {
      toastSuccess(res?.message ?? 'Promocion activada exitosamente');
      invalidate();
    },
    onError: (err: any) => toastError(err?.response?.data?.message ?? 'Error al activar'),
  });

  const pauseMutation = useMutation({
    mutationFn: () => PromotionsService.pause(numericId),
    onSuccess: (res) => {
      toastSuccess(res?.message ?? 'Promocion pausada exitosamente');
      invalidate();
    },
    onError: (err: any) => toastError(err?.response?.data?.message ?? 'Error al pausar'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => PromotionsService.cancel(numericId),
    onSuccess: (res) => {
      toastSuccess(res?.message ?? 'Promocion cancelada exitosamente');
      invalidate();
    },
    onError: (err: any) => toastError(err?.response?.data?.message ?? 'Error al cancelar'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => PromotionsService.remove(numericId),
    onSuccess: (res) => {
      toastSuccess(res?.message ?? 'Promocion eliminada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      router.replace('/(store-admin)/marketing/promotions');
    },
    onError: (err: any) => toastError(err?.response?.data?.message ?? 'Error al eliminar'),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Spinner />
      </View>
    );
  }

  if (!promotion) {
    return (
      <View style={styles.container}>
        <StickyHeader
          title="Detalle"
          onBack={() => router.back()}
        />
        <EmptyState
          icon="alert-circle"
          title="Promocion no encontrada"
          description="La promocion solicitada no existe o fue eliminada."
          actionLabel="Volver a la lista"
          onAction={() => router.replace('/(store-admin)/marketing/promotions')}
        />
      </View>
    );
  }

  const state = promotion.state;
  const canActivate = ['draft', 'scheduled', 'paused'].includes(state);
  const canPause = state === 'active';
  const canCancel = !['cancelled', 'expired'].includes(state);
  const canDelete = state === 'draft';
  const canEdit = state !== 'cancelled';

  const valueDisplay =
    promotion.type === 'percentage'
      ? `${promotion.value}%`
      : formatCurrency(promotion.value);

  const usageDisplay = promotion.usage_limit
    ? `${promotion.usage_count}/${promotion.usage_limit}`
    : `${promotion.usage_count}`;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        <StickyHeader
          title={promotion.name}
          subtitle={PROMOTION_STATE_LABEL[state]}
          onBack={() => router.back()}
          actions={[
            {
              label: PROMOTION_LABELS.rowEdit,
              icon: 'edit',
              variant: 'primary',
              onPress: () => setEditOpen(true),
              disabled: !canEdit,
            },
          ]}
        />

        {/* Header card with name + status */}
        <Card style={styles.section}>
          <View style={styles.headerRow}>
            <View style={styles.flex1}>
              <ListItem title={promotion.name} />
              {promotion.code ? (
                <ListItem
                  title={`${PROMOTION_LABELS.rowCode}: ${promotion.code}`}
                />
              ) : null}
            </View>
            <Badge
              label={PROMOTION_STATE_LABEL[state]}
              variant={PROMOTION_STATE_BADGE_VARIANT[state]}
              size="sm"
            />
          </View>
        </Card>

        {/* Regla y descuento */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{PROMOTION_LABELS.detailRule}</Text>
          <DetailRow label={PROMOTION_LABELS.fieldType} value={PROMOTION_TYPE_LABEL[promotion.type]} />
          <DetailRow label={PROMOTION_LABELS.fieldValue} value={valueDisplay} />
          <DetailRow label={PROMOTION_LABELS.fieldRule} value={PROMOTION_RULE_TYPE_LABEL[promotion.rule_type]} />
          <DetailRow label={PROMOTION_LABELS.fieldScope} value={PROMOTION_SCOPE_LABEL[promotion.scope]} />
          {promotion.max_discount_amount != null ? (
            <DetailRow label={PROMOTION_LABELS.fieldMaxDiscount} value={formatCurrency(promotion.max_discount_amount)} />
          ) : null}
        </Card>

        {/* Vigencia */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{PROMOTION_LABELS.detailVigency}</Text>
          <DetailRow label={PROMOTION_LABELS.fieldStartDate} value={formatDate(promotion.start_date)} />
          {promotion.end_date ? (
            <DetailRow label={PROMOTION_LABELS.fieldEndDate} value={formatDate(promotion.end_date)} />
          ) : (
            <DetailRow label={PROMOTION_LABELS.fieldEndDate} value="Sin fecha de fin" />
          )}
        </Card>

        {/* Restricciones */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{PROMOTION_LABELS.detailRestrictions}</Text>
          {promotion.min_purchase_amount != null ? (
            <DetailRow label={PROMOTION_LABELS.fieldMinPurchase} value={formatCurrency(promotion.min_purchase_amount)} />
          ) : null}
          {promotion.usage_limit != null ? (
            <DetailRow label={PROMOTION_LABELS.fieldUsageLimit} value={String(promotion.usage_limit)} />
          ) : null}
          {promotion.per_customer_limit != null ? (
            <DetailRow label={PROMOTION_LABELS.fieldPerCustomerLimit} value={String(promotion.per_customer_limit)} />
          ) : null}
          <DetailRow label={PROMOTION_LABELS.fieldPriority} value={String(promotion.priority ?? 0)} />
          <DetailRow
            label={PROMOTION_LABELS.fieldAutoApply}
            value={promotion.is_auto_apply ? 'Si' : 'No'}
          />
          <DetailRow
            label={PROMOTION_LABELS.detailUsage}
            value={usageDisplay}
          />
        </Card>

        {/* Productos elegibles */}
        {promotion.scope === 'product' && promotion.promotion_products ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{PROMOTION_LABELS.detailProducts}</Text>
            {promotion.promotion_products.length === 0 ? (
              <ListItem title="Sin productos" />
            ) : (
              promotion.promotion_products.map((pp) => (
                <DetailRow
                  key={pp.product_id}
                  label={pp.products?.name ?? `Producto #${pp.product_id}`}
                  value={pp.products?.sku ?? ''}
                />
              ))
            )}
          </Card>
        ) : null}

        {/* Categorías elegibles */}
        {promotion.scope === 'category' && promotion.promotion_categories ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{PROMOTION_LABELS.detailCategories}</Text>
            {promotion.promotion_categories.length === 0 ? (
              <ListItem title="Sin categorias" />
            ) : (
              promotion.promotion_categories.map((pc) => (
                <DetailRow
                  key={pc.category_id}
                  label={pc.categories?.name ?? `Categoria #${pc.category_id}`}
                  value=""
                />
              ))
            )}
          </Card>
        ) : null}

        {/* Escalas por cantidad */}
        {promotion.rule_type === 'quantity_tiered' && promotion.promotion_quantity_tiers ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{PROMOTION_LABELS.detailTiers}</Text>
            {promotion.promotion_quantity_tiers.length === 0 ? (
              <ListItem title="Sin escalas" />
            ) : (
              promotion.promotion_quantity_tiers
                .slice()
                .sort((a, b) => (a.min_quantity ?? 0) - (b.min_quantity ?? 0))
                .map((t, i) => {
                  const range =
                    t.max_quantity != null
                      ? `${t.min_quantity} - ${t.max_quantity} und`
                      : `${t.min_quantity}+ und`;
                  const discount =
                    t.type === 'percentage'
                      ? `${t.value}%`
                      : formatCurrency(t.value);
                  return (
                    <DetailRow
                      key={t.id ?? i}
                      label={`Escala ${i + 1}: ${range}`}
                      value={discount}
                    />
                  );
                })
            )}
          </Card>
        ) : null}

        {/* Action buttons */}
        <View style={styles.actionsSection}>
          {canActivate ? (
            <Button
              title={PROMOTION_LABELS.rowActivate}
              variant="primary"
              leftIcon="play"
              onPress={() => activateMutation.mutate()}
              loading={activateMutation.isPending}
              style={styles.actionBtn}
            />
          ) : null}
          {canPause ? (
            <Button
              title={PROMOTION_LABELS.rowPause}
              variant="outline"
              leftIcon="pause"
              onPress={() => pauseMutation.mutate()}
              loading={pauseMutation.isPending}
              style={styles.actionBtn}
            />
          ) : null}
          {canCancel ? (
            <Button
              title={PROMOTION_LABELS.rowCancel}
              variant="outline"
              leftIcon="x-circle"
              onPress={() => setConfirm({ kind: 'cancel' })}
              loading={cancelMutation.isPending}
              style={styles.actionBtn}
            />
          ) : null}
          {canDelete ? (
            <Button
              title={PROMOTION_LABELS.rowDelete}
              variant="destructive"
              leftIcon="trash-2"
              onPress={() => setConfirm({ kind: 'delete' })}
              loading={deleteMutation.isPending}
              style={styles.actionBtn}
            />
          ) : null}
        </View>
      </ScrollView>

      <PromotionUpsertModal
        visible={editOpen}
        promotion={promotion}
        onClose={() => setEditOpen(false)}
        onSaved={() => setEditOpen(false)}
      />

      <ConfirmDialog
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'cancel') cancelMutation.mutate();
          if (confirm?.kind === 'delete') deleteMutation.mutate();
          setConfirm(null);
        }}
        title={
          confirm?.kind === 'cancel'
            ? PROMOTION_LABELS.dialogCancelTitle
            : PROMOTION_LABELS.dialogDeleteTitle
        }
        message={
          confirm?.kind === 'cancel'
            ? PROMOTION_LABELS.dialogCancelMessage
            : PROMOTION_LABELS.dialogDeleteMessage
        }
        confirmLabel={
          confirm?.kind === 'cancel'
            ? PROMOTION_LABELS.dialogCancelConfirm
            : PROMOTION_LABELS.dialogDeleteConfirm
        }
        cancelLabel={
          confirm?.kind === 'cancel'
            ? PROMOTION_LABELS.dialogCancelDeny
            : PROMOTION_LABELS.dialogDeleteDeny
        }
        destructive={confirm?.kind === 'delete'}
        loading={
          confirm?.kind === 'cancel'
            ? cancelMutation.isPending
            : confirm?.kind === 'delete'
              ? deleteMutation.isPending
              : false
        }
      />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  scrollContent: { paddingBottom: spacing[8] },
  section: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  flex1: { flex: 1 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing[2],
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  detailLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  detailValue: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
    textAlign: 'right',
  },
  actionsSection: {
    padding: spacing[4],
    gap: spacing[2],
  },
  actionBtn: {
    width: '100%',
  },
});
