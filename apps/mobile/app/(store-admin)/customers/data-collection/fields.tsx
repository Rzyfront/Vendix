import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { DataCollectionService } from '@/features/store/services/data-collection.service';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import type { MetadataField } from '@/features/store/types/data-collection.types';

export default function FieldsScreen() {
  const [entityFilter, setEntityFilter] = useState<string | undefined>();

  const { data: fields, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['metadata-fields', entityFilter],
    queryFn: () => DataCollectionService.fields.list(entityFilter),
  });

  const handleToggle = useCallback(async (field: MetadataField) => {
    await DataCollectionService.fields.toggle(field.id);
    refetch();
  }, [refetch]);

  const handleDelete = useCallback(async (id: number) => {
    await DataCollectionService.fields.delete(id);
    refetch();
  }, [refetch]);

  const ENTITY_LABELS: Record<string, string> = {
    customer: 'Clientes',
    booking: 'Reservas',
    order: 'Órdenes',
  };

  const FIELD_TYPE_LABELS: Record<string, string> = {
    text: 'Texto',
    number: 'Número',
    date: 'Fecha',
    select: 'Selección',
    checkbox: 'Checkbox',
    textarea: 'Área de texto',
    file: 'Archivo',
    email: 'Email',
    phone: 'Teléfono',
    url: 'URL',
  };

  const renderField = useCallback(
    ({ item }: { item: MetadataField }) => (
      <View style={styles.fieldCard}>
        <View style={styles.fieldHeader}>
          <View style={styles.fieldInfo}>
            <Text style={styles.fieldLabel}>{item.label}</Text>
            <Text style={styles.fieldKey}>@{item.field_key}</Text>
          </View>
          <View style={[styles.statusDot, item.is_active ? styles.statusActive : styles.statusInactive]} />
        </View>
        <View style={styles.fieldMeta}>
          <View style={styles.fieldMetaTag}>
            <Text style={styles.fieldMetaText}>{FIELD_TYPE_LABELS[item.field_type] || item.field_type}</Text>
          </View>
          <View style={styles.fieldMetaTag}>
            <Text style={styles.fieldMetaText}>{ENTITY_LABELS[item.entity_type] || item.entity_type}</Text>
          </View>
          {item.is_required && (
            <View style={styles.fieldMetaTagRequired}>
              <Text style={styles.fieldMetaTextRequired}>Obligatorio</Text>
            </View>
          )}
        </View>
        <View style={styles.fieldActions}>
          <Pressable onPress={() => handleToggle(item)} style={styles.fieldActionBtn}>
            <Icon
              name={item.is_active ? 'toggle-right' : 'toggle-left'}
              size={18}
              color={item.is_active ? colors.primary : colorScales.gray[400]}
            />
          </Pressable>
          <Pressable onPress={() => handleDelete(item.id)} style={styles.fieldActionBtn}>
            <Icon name="trash-2" size={16} color={colorScales.red[500]} />
          </Pressable>
        </View>
      </View>
    ),
    [handleToggle, handleDelete],
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
        data={fields ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderField}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.filterRow}>
            {['customer', 'booking', 'order'].map((type) => (
              <Pressable
                key={type}
                onPress={() => setEntityFilter(entityFilter === type ? undefined : type)}
                style={[
                  styles.filterChip,
                  entityFilter === type && styles.filterChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    entityFilter === type && styles.filterChipTextActive,
                  ]}
                >
                  {ENTITY_LABELS[type]}
                </Text>
              </Pressable>
            ))}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin campos"
            description="No hay campos de metadatos configurados"
            icon="database"
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
  fieldCard: {
    marginHorizontal: spacing[4],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    ...shadows.sm,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  fieldInfo: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  fieldKey: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    fontFamily: 'monospace',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusActive: {
    backgroundColor: '#059669',
  },
  statusInactive: {
    backgroundColor: colorScales.gray[300],
  },
  fieldMeta: {
    flexDirection: 'row',
    gap: spacing[1],
    marginBottom: spacing[2],
    flexWrap: 'wrap',
  },
  fieldMetaTag: {
    backgroundColor: colorScales.gray[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  fieldMetaTagRequired: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  fieldMetaText: {
    fontSize: 11,
    color: colorScales.gray[500],
  },
  fieldMetaTextRequired: {
    fontSize: 11,
    color: '#d97706',
    fontWeight: typography.fontWeight.medium,
  },
  fieldActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    paddingTop: spacing[2],
  },
  fieldActionBtn: {
    padding: spacing[1],
  },
});
