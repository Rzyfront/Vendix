import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native';
import { Selector } from '@/shared/components/selector/selector';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { DataCollectionService } from '@/features/store/services/data-collection.service';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import type { MetadataField, FieldType, EntityType, DisplayMode } from '@/features/store/types/data-collection.types';

const ENTITY_LABELS: Record<string, string> = {
  customer: 'Cliente',
  booking: 'Reserva',
  order: 'Orden',
};

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Fecha' },
  { value: 'select', label: 'Selección' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'textarea', label: 'Área de texto' },
  { value: 'file', label: 'Archivo' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Teléfono' },
  { value: 'url', label: 'URL' },
];

const DISPLAY_MODES: { value: DisplayMode; label: string }[] = [
  { value: 'detail', label: 'Detalle' },
  { value: 'summary', label: 'Resumen' },
];

const ENTITY_OPTIONS = ['customer', 'booking', 'order'] as const;

// Opciones de filtro de entidad (web: [{id:'',label:'Todos'}, ...])
const ENTITY_FILTER_OPTIONS: { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'Todos' },
  ...ENTITY_OPTIONS.map((e) => ({ value: e as string, label: ENTITY_LABELS[e] })),
];

export default function FieldsScreen() {
  const insets = useSafeAreaInsets();
  const [entityFilter, setEntityFilter] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingField, setEditingField] = useState<MetadataField | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<MetadataField | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state
  const [formLabel, setFormLabel] = useState('');
  const [formKey, setFormKey] = useState('');
  const [formEntityType, setFormEntityType] = useState<EntityType>('customer');
  const [formFieldType, setFormFieldType] = useState<FieldType>('text');
  const [formDescription, setFormDescription] = useState('');
  const [formDisplayMode, setFormDisplayMode] = useState<DisplayMode>('detail');
  const [formRequired, setFormRequired] = useState(false);
  const [formOptionsText, setFormOptionsText] = useState('');

  const { data: fields, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['metadata-fields', entityFilter],
    queryFn: () => DataCollectionService.fields.list(entityFilter),
  });

  const filteredFields = useMemo(() => {
    if (!fields) return [];
    const term = search.toLowerCase().trim();
    if (!term) return fields;
    return fields.filter(
      (f) =>
        f.label.toLowerCase().includes(term) ||
        f.field_key.toLowerCase().includes(term) ||
        f.field_type.toLowerCase().includes(term),
    );
  }, [fields, search]);

  const handleToggle = useCallback(async (field: MetadataField) => {
    try {
      await DataCollectionService.fields.toggle(field.id);
      toastSuccess(field.is_active ? 'Campo desactivado' : 'Campo activado');
      refetch();
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Error al cambiar el estado';
      toastError(typeof message === 'string' ? message : 'Error al cambiar el estado');
    }
  }, [refetch]);

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
  }, []);

  const openCreateModal = useCallback(() => {
    setEditingField(null);
    setFormLabel('');
    setFormKey('');
    setFormEntityType('customer');
    setFormFieldType('text');
    setFormDescription('');
    setFormDisplayMode('detail');
    setFormRequired(false);
    setFormOptionsText('');
    setShowModal(true);
  }, []);

  const openEditModal = useCallback((field: MetadataField) => {
    setEditingField(field);
    setFormLabel(field.label);
    setFormKey(field.field_key);
    setFormEntityType(field.entity_type);
    setFormFieldType(field.field_type);
    setFormDescription(field.description || '');
    setFormDisplayMode(field.display_mode);
    setFormRequired(field.is_required);
    // Convertir options (array o record) a texto (uno por línea)
    const opts = field.options;
    if (Array.isArray(opts)) {
      setFormOptionsText((opts as string[]).join('\n'));
    } else if (opts && typeof opts === 'object') {
      setFormOptionsText(Object.values(opts as Record<string, string>).join('\n'));
    } else {
      setFormOptionsText('');
    }
    setShowModal(true);
  }, []);

  const autoGenerateKey = useCallback((label: string) => {
    if (!editingField) {
      setFormKey(
        label
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_')
          .substring(0, 100),
      );
    }
  }, [editingField]);

  const handleSaveField = useCallback(async () => {
    if (!formLabel.trim() || !formKey.trim()) return;
    setActionLoading(true);
    try {
      const data: Partial<MetadataField> & { options?: string[] } = {
        label: formLabel.trim(),
        field_key: formKey.trim(),
        entity_type: formEntityType,
        field_type: formFieldType,
        description: formDescription.trim() || undefined,
        display_mode: formDisplayMode,
        is_required: formRequired,
      };
      // Si el tipo es "select", enviar las opciones como array (web field-modal)
      if (formFieldType === 'select' && formOptionsText.trim()) {
        data.options = formOptionsText
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean);
      }
      if (editingField) {
        await DataCollectionService.fields.update(editingField.id, data);
        toastSuccess('Campo actualizado');
      } else {
        await DataCollectionService.fields.create(data);
        toastSuccess('Campo creado');
      }
      setShowModal(false);
      refetch();
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Error al guardar el campo';
      toastError(typeof message === 'string' ? message : 'Error al guardar el campo');
    } finally {
      setActionLoading(false);
    }
  }, [formLabel, formKey, formEntityType, formFieldType, formDescription, formDisplayMode, formRequired, formOptionsText, editingField, refetch]);

  const handleDeleteField = useCallback(async () => {
    if (!showDeleteConfirm) return;
    setActionLoading(true);
    try {
      await DataCollectionService.fields.delete(showDeleteConfirm.id);
      toastSuccess('Campo eliminado');
      setShowDeleteConfirm(null);
      refetch();
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Error al eliminar el campo';
      toastError(typeof message === 'string' ? message : 'Error al eliminar el campo');
    } finally {
      setActionLoading(false);
    }
  }, [showDeleteConfirm, refetch]);

  const renderField = useCallback(
    ({ item }: { item: MetadataField }) => (
      <Pressable onPress={() => openEditModal(item)} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderInfo}>
            <Text style={styles.cardTitle}>{item.label}</Text>
            <Text style={styles.cardSubtitle}>@{item.field_key}</Text>
          </View>
          <View style={[styles.statusDot, item.is_active ? styles.statusActive : styles.statusInactive]} />
        </View>

        <View style={styles.cardMetaRow}>
          <View style={styles.metaTag}>
            <Text style={styles.metaTagText}>{ENTITY_LABELS[item.entity_type] || item.entity_type}</Text>
          </View>
          <View style={styles.metaTag}>
            <Text style={styles.metaTagText}>{FIELD_TYPES.find((t) => t.value === item.field_type)?.label || item.field_type}</Text>
          </View>
          {item.is_required && (
            <View style={styles.metaTagRequired}>
              <Text style={styles.metaTagTextRequired}>Obligatorio</Text>
            </View>
          )}
        </View>

        <View style={styles.cardActions}>
          <Pressable onPress={() => handleToggle(item)} style={styles.actionBtn}>
            <Icon
              name={item.is_active ? 'check-circle' : 'circle'}
              size={20}
              color={item.is_active ? colors.primary : colorScales.gray[400]}
            />
          </Pressable>
          <Pressable onPress={() => setShowDeleteConfirm(item)} style={styles.actionBtn}>
            <Icon name="trash-2" size={16} color={colorScales.red[500]} />
          </Pressable>
        </View>
      </Pressable>
    ),
    [handleToggle, openEditModal],
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
        data={filteredFields}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderField}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            {/* Entity filter chips (estilo web: incluye "Todos") */}
            <View style={styles.filterRow}>
              {ENTITY_FILTER_OPTIONS.map((opt) => {
                const isActive = entityFilter === opt.value;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => setEntityFilter(opt.value)}
                    style={[
                      styles.filterChip,
                      isActive && styles.filterChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        isActive && styles.filterChipTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {/* Title */}
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Campos Personalizados ({fields?.length ?? 0})</Text>
            </View>
            {/* Search + (+) button */}
            <View style={styles.searchRow}>
              <View style={styles.searchInputWrapper}>
                <Icon name="search" size={16} color={colorScales.gray[400]} />
                <TextInput
                  value={search}
                  onChangeText={handleSearch}
                  placeholder="Buscar campos..."
                  placeholderTextColor={colorScales.gray[400]}
                  style={styles.searchInput}
                />
              </View>
              <Pressable onPress={openCreateModal} style={styles.addBtn}>
                <Icon name="plus" size={18} color={colors.primary} />
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No hay campos"
            description="Define los campos de datos para clientes, reservas y órdenes"
            icon="database"
            actionLabel="Nuevo Campo"
            onAction={openCreateModal}
          />
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing[8] }]}
        keyboardShouldPersistTaps="handled"
      />

      {/* Create/Edit Modal — centered card pattern (Web Visual Pattern) */}
      {showModal && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowModal(false)}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.centeredCardRoot}
            >
              <View style={styles.centeredCard}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{editingField ? 'Editar Campo' : 'Nuevo Campo'}</Text>
                  <Pressable onPress={() => setShowModal(false)}>
                    <Icon name="x" size={20} color={colorScales.gray[500]} />
                  </Pressable>
                </View>
                <ScrollView
                  style={styles.modalScroll}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >

            {/* Label */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Label</Text>
              <TextInput
                value={formLabel}
                onChangeText={(t) => { setFormLabel(t); autoGenerateKey(t); }}
                placeholder="Ej: Fecha de nacimiento"
                placeholderTextColor={colorScales.gray[400]}
                style={styles.formInput}
              />
            </View>

            {/* Key */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Key</Text>
              <TextInput
                value={formKey}
                onChangeText={setFormKey}
                placeholder="fecha_de_nacimiento"
                placeholderTextColor={colorScales.gray[400]}
                style={[styles.formInput, !!editingField && styles.formInputDisabled]}
                editable={!editingField}
              />
            </View>

            {/* Entity type + Field type — 2-col grid (web parity) */}
            <View style={styles.formRow}>
              <View style={styles.formCol}>
                <Selector
                  label="Tipo de Entidad *"
                  value={formEntityType}
                  onChange={(v) => setFormEntityType(v as EntityType)}
                  options={ENTITY_OPTIONS.map((e) => ({ label: ENTITY_LABELS[e], value: e }))}
                />
              </View>
              <View style={styles.formCol}>
                <Selector
                  label="Tipo de Campo *"
                  value={formFieldType}
                  onChange={(v) => setFormFieldType(v as FieldType)}
                  options={FIELD_TYPES.map((ft) => ({ label: ft.label, value: ft.value }))}
                />
              </View>
            </View>

            {/* Description */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Descripción</Text>
              <TextInput
                value={formDescription}
                onChangeText={setFormDescription}
                placeholder="Descripción opcional..."
                placeholderTextColor={colorScales.gray[400]}
                style={[styles.formTextarea, { minHeight: 70 }]}
                multiline
              />
            </View>

            {/* Display mode + Obligatorio — 2-col grid (web parity) */}
            <View style={styles.formRow}>
              <View style={styles.formCol}>
                <Selector
                  label="Modo de Display"
                  value={formDisplayMode}
                  onChange={(v) => setFormDisplayMode(v as DisplayMode)}
                  options={DISPLAY_MODES.map((dm) => ({ label: dm.label, value: dm.value }))}
                />
              </View>
              <View style={[styles.formCol, styles.formColToggle]}>
                <Text style={styles.formLabel}>Obligatorio</Text>
                <Pressable onPress={() => setFormRequired((v) => !v)} style={styles.toggleRow}>
                  <View style={[styles.toggle, formRequired && styles.toggleActive]}>
                    <View style={[styles.toggleThumb, formRequired && styles.toggleThumbActive]} />
                  </View>
                </Pressable>
              </View>
            </View>

            {/* Opciones (solo cuando field_type === 'select') — estilo web */}
            {formFieldType === 'select' && (
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Opciones (una por línea)</Text>
                <TextInput
                  value={formOptionsText}
                  onChangeText={setFormOptionsText}
                  placeholder={'Opción 1\nOpción 2\nOpción 3'}
                  placeholderTextColor={colorScales.gray[400]}
                  style={[styles.formTextarea, { minHeight: 90 }]}
                  multiline
                />
              </View>
            )}

            {/* Actions */}
            <View style={styles.formActions}>
              <Pressable onPress={() => setShowModal(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveField}
                style={[styles.saveBtn, (!formLabel.trim() || !formKey.trim() || actionLoading) && styles.saveBtnDisabled]}
                disabled={!formLabel.trim() || !formKey.trim() || actionLoading}
              >
                <Text style={styles.saveBtnText}>
                  {actionLoading ? 'Guardando...' : editingField ? 'Guardar' : 'Crear'}
                </Text>
              </Pressable>
            </View>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      )}

      <ConfirmDialog
        visible={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={handleDeleteField}
        title="Eliminar campo"
        message={`¿Estás seguro de eliminar "${showDeleteConfirm?.label}"?`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        loading={actionLoading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  listContent: { paddingBottom: spacing[8] },
  separator: { height: spacing[3] },
  // Filter chips
  filterRow: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  filterChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  filterChipActive: { backgroundColor: colorScales.green[50], borderColor: colorScales.green[500] },
  filterChipText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colorScales.gray[600] },
  filterChipTextActive: { color: colorScales.green[600], fontWeight: typography.fontWeight.bold },
  // Header
  headerRow: { paddingHorizontal: spacing[4], paddingTop: spacing[1], paddingBottom: spacing[1] },
  headerTitle: { fontSize: 12, fontWeight: '700', color: colorScales.gray[600], letterSpacing: 0.3 },
  // Search row
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    minHeight: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    padding: 0,
    height: '100%',
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  // Card
  card: {
    marginHorizontal: spacing[4],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    ...shadows.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[2] },
  cardHeaderInfo: { flex: 1 },
  cardTitle: { fontSize: typography.fontSize.sm, fontWeight: '600', color: colorScales.gray[900] },
  cardSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[400], fontFamily: 'monospace' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusActive: { backgroundColor: colorScales.green[600] },
  statusInactive: { backgroundColor: colorScales.gray[300] },
  cardMetaRow: { flexDirection: 'row', gap: spacing[1], marginBottom: spacing[2], flexWrap: 'wrap' },
  metaTag: { backgroundColor: colorScales.gray[100], paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.sm },
  metaTagText: { fontSize: 11, color: colorScales.gray[500] },
  metaTagRequired: { backgroundColor: colorScales.amber[100], paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.sm },
  metaTagTextRequired: { fontSize: 11, color: colorScales.amber[700], fontWeight: typography.fontWeight.medium },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[2], borderTopWidth: 1, borderTopColor: colorScales.gray[100], paddingTop: spacing[2] },
  actionBtn: { padding: spacing[1] },
  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'center', alignItems: 'center' },
  centeredCardRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' },
  centeredCard: { width: '100%', maxWidth: 480, maxHeight: '85%', backgroundColor: colors.card, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], overflow: 'hidden', marginHorizontal: spacing[4] },
  modalScroll: { maxHeight: '85%' },
  modalScrollContent: { paddingHorizontal: spacing[4], paddingVertical: spacing[4], gap: spacing[3] },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[3] },
  modalTitle: { fontSize: typography.fontSize.lg, fontWeight: '700', color: colorScales.gray[900] },
  // Form
  formGroup: { marginBottom: spacing[3] },
  formRow: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  formCol: { flex: 1 },
  formColToggle: { justifyContent: 'flex-end' },
  formLabel: { fontSize: typography.fontSize.xs, fontWeight: '600', color: colorScales.gray[500], marginBottom: spacing[1], textTransform: 'uppercase', letterSpacing: 0.5 },
  formInput: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    color: colorScales.gray[900],
    fontSize: typography.fontSize.sm,
  },
  formInputDisabled: { opacity: 0.6, backgroundColor: colorScales.gray[100] },
  formTextarea: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    color: colorScales.gray[900],
    fontSize: typography.fontSize.sm,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: spacing[2],
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colorScales.gray[200],
    padding: 2,
    justifyContent: 'center',
  },
  toggleActive: { backgroundColor: colors.primary },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.background },
  toggleThumbActive: { transform: [{ translateX: 18 }] },
  chipRow: { flexDirection: 'row', gap: spacing[2] },
  chipRowWrapped: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  chipActive: { backgroundColor: colorScales.green[50], borderColor: colorScales.green[500] },
  chipText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colorScales.gray[600] },
  chipTextActive: { color: colorScales.green[600], fontWeight: typography.fontWeight.bold },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[2], marginTop: spacing[2] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  cancelBtnText: { fontSize: typography.fontSize.sm, color: colorScales.gray[600], fontWeight: typography.fontWeight.medium },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.background },
});
