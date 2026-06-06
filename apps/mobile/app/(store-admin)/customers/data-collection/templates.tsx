import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { DataCollectionService } from '@/features/store/services/data-collection.service';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import type { DataCollectionTemplate } from '@/features/store/types/data-collection.types';

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Activa', color: '#059669', bg: '#d1fae5' },
  inactive: { label: 'Inactiva', color: '#6b7280', bg: '#f3f4f6' },
  archived: { label: 'Archivada', color: '#dc2626', bg: '#fee2e2' },
};

export default function TemplatesScreen() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  const { data: templates, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['data-collection-templates', statusFilter],
    queryFn: () => DataCollectionService.templates.list(statusFilter),
  });

  const handleDuplicate = useCallback(async (id: number) => {
    await DataCollectionService.templates.duplicate(id);
    refetch();
  }, [refetch]);

  const handleDelete = useCallback(async (id: number) => {
    await DataCollectionService.templates.delete(id);
    refetch();
  }, [refetch]);

  const STATUS_OPTIONS = ['active', 'inactive', 'archived'];
  const STATUS_LABEL_MAP: Record<string, string> = {
    active: 'Activas',
    inactive: 'Inactivas',
    archived: 'Archivadas',
  };

  const renderTemplate = useCallback(
    ({ item }: { item: DataCollectionTemplate }) => {
      const status = STATUS_LABELS[item.status] || STATUS_LABELS.active;
      const productCount = item.products?.length ?? 0;
      return (
        <View style={styles.templateCard}>
          <View style={styles.templateInfo}>
            <Icon name={item.icon || 'layout-template'} size={20} color={colors.primary} />
            <View style={styles.templateTextInfo}>
              <Text style={styles.templateName}>{item.name}</Text>
              <Text style={styles.templateDescription} numberOfLines={1}>
                {item.description || 'Sin descripción'}
              </Text>
            </View>
          </View>
          <View style={styles.templateMeta}>
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusBadgeText, { color: status.color }]}>
                {status.label}
              </Text>
            </View>
            {item.is_default && (
              <View style={styles.defaultBadge}>
                <Icon name="star" size={12} color="#d97706" />
                <Text style={styles.defaultBadgeText}>Default</Text>
              </View>
            )}
            {productCount > 0 && (
              <View style={styles.productBadge}>
                <Icon name="package" size={12} color={colorScales.gray[500]} />
                <Text style={styles.productBadgeText}>{productCount}</Text>
              </View>
            )}
          </View>
          <View style={styles.templateActions}>
            <Pressable onPress={() => handleDuplicate(item.id)} style={styles.templateActionBtn}>
              <Icon name="copy" size={16} color={colorScales.gray[500]} />
            </Pressable>
            <Pressable onPress={() => handleDelete(item.id)} style={styles.templateActionBtn}>
              <Icon name="trash-2" size={16} color={colorScales.red[500]} />
            </Pressable>
          </View>
        </View>
      );
    },
    [handleDuplicate, handleDelete],
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
        data={templates ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderTemplate}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.filterRow}>
            {STATUS_OPTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setStatusFilter(statusFilter === s ? undefined : s)}
                style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    statusFilter === s && styles.filterChipTextActive,
                  ]}
                >
                  {STATUS_LABEL_MAP[s]}
                </Text>
              </Pressable>
            ))}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin plantillas"
            description="No hay plantillas de recolección de datos"
            icon="layout-template"
          />
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        contentContainerStyle={styles.listContent}
      />
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
  filterRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  filterChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[600],
  },
  filterChipTextActive: {
    color: colors.background,
  },
  templateCard: {
    marginHorizontal: spacing[4],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    ...shadows.sm,
  },
  templateInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  templateTextInfo: {
    flex: 1,
  },
  templateName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  templateDescription: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  templateMeta: {
    flexDirection: 'row',
    gap: spacing[1],
    marginBottom: spacing[2],
    flexWrap: 'wrap',
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
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef3c7',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  defaultBadgeText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold,
    color: '#d97706',
  },
  productBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colorScales.gray[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  productBadgeText: {
    fontSize: 11,
    color: colorScales.gray[500],
  },
  templateActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    paddingTop: spacing[2],
  },
  templateActionBtn: {
    padding: spacing[1],
  },
});
