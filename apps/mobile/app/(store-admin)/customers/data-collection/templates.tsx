import { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { DataCollectionService } from '@/features/store/services/data-collection.service';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import type { DataCollectionTemplate, EntityType, TemplateStatus } from '@/features/store/types/data-collection.types';

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Activo', color: colorScales.green[700], bg: colorScales.green[100] },
  inactive: { label: 'Inactivo', color: colorScales.gray[600], bg: colorScales.gray[100] },
  archived: { label: 'Archivado', color: colorScales.red[600], bg: colorScales.red[50] },
};

const STATUS_OPTIONS = ['active', 'inactive', 'archived'];
const STATUS_LABEL_MAP: Record<string, string> = {
  active: 'Activas',
  inactive: 'Inactivas',
  archived: 'Archivadas',
};

const ENTITY_LABELS: Record<EntityType, string> = {
  customer: 'Cliente',
  booking: 'Reserva',
  order: 'Orden',
};

const TEMPLATE_ENTITY_OPTIONS: EntityType[] = ['customer', 'booking', 'order'];
const TEMPLATE_STATUS_OPTIONS: TemplateStatus[] = ['active', 'inactive', 'archived'];

export default function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<DataCollectionTemplate | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Modal crear/editar plantilla
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<DataCollectionTemplate | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplDescription, setTplDescription] = useState('');
  const [tplEntityType, setTplEntityType] = useState<EntityType>('booking');
  const [tplStatus, setTplStatus] = useState<TemplateStatus>('active');
  const [tplIsDefault, setTplIsDefault] = useState(false);
  const [tplErrors, setTplErrors] = useState<Record<string, string>>({});

  const { data: templates, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['data-collection-templates', statusFilter],
    queryFn: () => DataCollectionService.templates.list(statusFilter),
  });

  const handleDuplicate = useCallback(async (id: number) => {
    try {
      await DataCollectionService.templates.duplicate(id);
      toastSuccess('Plantilla duplicada');
      refetch();
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Error al duplicar';
      toastError(typeof message === 'string' ? message : 'Error al duplicar la plantilla');
    }
  }, [refetch]);

  const handleDelete = useCallback(async () => {
    if (!showDeleteConfirm) return;
    setActionLoading(true);
    try {
      await DataCollectionService.templates.delete(showDeleteConfirm.id);
      toastSuccess('Plantilla eliminada');
      setShowDeleteConfirm(null);
      refetch();
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Error al eliminar';
      toastError(typeof message === 'string' ? message : 'Error al eliminar la plantilla');
    } finally {
      setActionLoading(false);
    }
  }, [showDeleteConfirm, refetch]);

  // Abrir modal de edición con datos pre-rellenados
  const openEditTemplate = useCallback((template: DataCollectionTemplate) => {
    setEditingTemplate(template);
    setTplName(template.name);
    setTplDescription(template.description || '');
    setTplEntityType(template.entity_type);
    setTplStatus(template.status);
    setTplIsDefault(!!template.is_default);
    setTplErrors({});
    setShowTemplateModal(true);
  }, []);

  // Abrir modal de creación (vacío)
  const openNewTemplate = useCallback(() => {
    setEditingTemplate(null);
    setTplName('');
    setTplDescription('');
    setTplEntityType('booking');
    setTplStatus('active');
    setTplIsDefault(false);
    setTplErrors({});
    setShowTemplateModal(true);
  }, []);

  const closeTemplateModal = useCallback(() => {
    setShowTemplateModal(false);
    setEditingTemplate(null);
    setTplErrors({});
  }, []);

  const handleSaveTemplate = useCallback(async () => {
    setTplErrors({});
    const newErrors: Record<string, string> = {};
    if (!tplName.trim()) newErrors.name = 'El nombre es requerido';
    if (Object.keys(newErrors).length > 0) {
      setTplErrors(newErrors);
      toastError('Revisa los campos marcados');
      return;
    }
    setActionLoading(true);
    try {
      const data = {
        name: tplName.trim(),
        description: tplDescription.trim() || undefined,
        entity_type: tplEntityType,
        status: tplStatus,
        is_default: tplIsDefault,
      };
      if (editingTemplate) {
        await DataCollectionService.templates.update(editingTemplate.id, data);
        toastSuccess('Plantilla actualizada');
      } else {
        await DataCollectionService.templates.create(data);
        toastSuccess('Plantilla creada');
      }
      closeTemplateModal();
      refetch();
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Error al guardar';
      toastError(typeof message === 'string' ? message : 'Error al guardar la plantilla');
    } finally {
      setActionLoading(false);
    }
  }, [tplName, tplDescription, tplEntityType, tplStatus, tplIsDefault, editingTemplate, refetch, closeTemplateModal]);

  const renderTemplate = useCallback(
    ({ item }: { item: DataCollectionTemplate }) => {
      const status = STATUS_STYLE[item.status] || STATUS_STYLE.active;
      const sectionCount = item.sections?.length ?? 0;
      const productCount = item.products?.length ?? 0;
      return (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Icon name={item.icon || 'layout-template'} size={20} color={colors.primary} />
              <View style={styles.cardHeaderInfo}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                {item.description && (
                  <Text style={styles.cardSubtitle} numberOfLines={2}>{item.description}</Text>
                )}
              </View>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>

          <View style={styles.cardMetaRow}>
            <Icon name="layers" size={12} color={colorScales.gray[400]} />
            <Text style={styles.metaText}>{sectionCount} secciones</Text>
            <Icon name="tag" size={12} color={colorScales.gray[400]} />
            <Text style={styles.metaText}>{ENTITY_LABELS[item.entity_type] || item.entity_type}</Text>
            {item.is_default && (
              <>
                <Icon name="star" size={12} color={colorScales.amber[600]} />
                <Text style={[styles.metaText, { color: colorScales.amber[600] }]}>Default</Text>
              </>
            )}
            {productCount > 0 && (
              <>
                <Icon name="package" size={12} color={colorScales.gray[400]} />
                <Text style={styles.metaText}>{productCount} producto(s)</Text>
              </>
            )}
          </View>

          <View style={styles.cardActions}>
            <Pressable onPress={() => openEditTemplate(item)} style={styles.actionBtn}>
              <Icon name="pencil" size={14} color={colorScales.gray[600]} />
              <Text style={styles.actionBtnText}>Editar</Text>
            </Pressable>
            <Pressable onPress={() => handleDuplicate(item.id)} style={styles.actionBtn}>
              <Icon name="copy" size={14} color={colorScales.gray[600]} />
              <Text style={styles.actionBtnText}>Duplicar</Text>
            </Pressable>
            <Pressable onPress={() => setShowDeleteConfirm(item)} style={styles.actionBtn}>
              <Icon name="trash-2" size={14} color={colorScales.red[500]} />
            </Pressable>
          </View>
        </View>
      );
    },
    [handleDuplicate, openEditTemplate],
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
      {/* Sticky header estilo web (app-sticky-header simplificado para mobile) */}
      <View style={styles.stickyHeader}>
        <View style={styles.stickyHeaderIcon}>
          <Icon name="layout-template" size={20} color={colors.primary} />
        </View>
        <View style={styles.stickyHeaderText}>
          <Text style={styles.stickyHeaderTitle}>Plantillas de Formulario</Text>
          <Text style={styles.stickyHeaderSubtitle}>Configura los formularios de recolección de datos</Text>
        </View>
        <Pressable style={styles.stickyHeaderAction} onPress={openNewTemplate} hitSlop={6}>
          <Icon name="plus" size={16} color={colors.background} />
          <Text style={styles.stickyHeaderActionText}>Nueva</Text>
        </Pressable>
      </View>

      <FlatList
        data={templates ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderTemplate}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Plantillas ({templates?.length ?? 0})</Text>
            </View>
            <View style={styles.filterRow}>
              {STATUS_OPTIONS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setStatusFilter(statusFilter === s ? undefined : s)}
                  style={[
                    styles.filterChip,
                    statusFilter === s && styles.filterChipActive,
                  ]}
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
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No hay plantillas"
            description="Crea tu primera plantilla para comenzar a recolectar datos de clientes."
            icon="layout-template"
            actionLabel="Nueva Plantilla"
            onAction={openNewTemplate}
          />
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing[8] }]}
      />

      <ConfirmDialog
        visible={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="Eliminar plantilla"
        message={`¿Estás seguro de eliminar "${showDeleteConfirm?.name}"?`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        loading={actionLoading}
      />

      {/* Modal crear/editar plantilla (estilo web: name, description, entity_type, status, is_default) */}
      <Modal visible={showTemplateModal} transparent animationType="fade" onRequestClose={closeTemplateModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>{editingTemplate ? 'Editar plantilla' : 'Nueva plantilla'}</Text>
                <Text style={styles.modalSubtitle}>
                  {editingTemplate ? 'Modifica los datos de la plantilla' : 'Crea una nueva plantilla para tu tienda'}
                </Text>
              </View>
              <Pressable onPress={closeTemplateModal} hitSlop={8} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Nombre */}
              <View>
                <Text style={styles.formLabel}>NOMBRE <Text style={styles.requiredStar}>*</Text></Text>
                <TextInput
                  style={[styles.formInput, !!tplErrors.name && styles.formInputError]}
                  value={tplName}
                  onChangeText={(v) => { setTplName(v); setTplErrors((p) => { const n = { ...p }; delete n.name; return n; }); }}
                  placeholder="Ej: Ficha de cliente"
                  placeholderTextColor={colorScales.gray[400]}
                />
                {!!tplErrors.name && <Text style={styles.formErrorText}>{tplErrors.name}</Text>}
              </View>

              {/* Descripción */}
              <View>
                <Text style={styles.formLabel}>DESCRIPCIÓN</Text>
                <TextInput
                  value={tplDescription}
                  onChangeText={setTplDescription}
                  placeholder="Descripción opcional de la plantilla"
                  placeholderTextColor={colorScales.gray[400]}
                  style={styles.formTextarea}
                  multiline
                />
              </View>

              {/* Tipo de Entidad + Estado (row) */}
              <View style={styles.formRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>TIPO DE ENTIDAD <Text style={styles.requiredStar}>*</Text></Text>
                  <View style={styles.chipRow}>
                    {TEMPLATE_ENTITY_OPTIONS.map((e) => (
                      <Pressable
                        key={e}
                        onPress={() => setTplEntityType(e)}
                        style={[styles.chip, tplEntityType === e && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, tplEntityType === e && styles.chipTextActive]}>
                          {ENTITY_LABELS[e]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>

              <View>
                <Text style={styles.formLabel}>ESTADO</Text>
                <View style={styles.chipRow}>
                  {TEMPLATE_STATUS_OPTIONS.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => setTplStatus(s)}
                      style={[styles.chip, tplStatus === s && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, tplStatus === s && styles.chipTextActive]}>
                        {STATUS_STYLE[s]?.label || s}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Plantilla por defecto — toggle */}
              <Pressable onPress={() => setTplIsDefault((v) => !v)} style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Plantilla por defecto</Text>
                  <Text style={styles.toggleDesc}>Define esta plantilla como la predeterminada para la entidad seleccionada</Text>
                </View>
                <View style={[styles.toggle, tplIsDefault && styles.toggleActive]}>
                  <View style={[styles.toggleThumb, tplIsDefault && styles.toggleThumbActive]} />
                </View>
              </Pressable>
            </ScrollView>

            {/* Footer: Cancelar + Guardar/Crear — estilo web */}
            <View style={styles.modalFooter}>
              <Pressable style={styles.cancelBtn} onPress={closeTemplateModal}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <View style={styles.actionSpacer} />
              <Pressable
                style={[styles.confirmBtn, (!tplName.trim() || actionLoading) && styles.confirmBtnDisabled]}
                onPress={handleSaveTemplate}
                disabled={!tplName.trim() || actionLoading}
              >
                <Text style={styles.confirmBtnText}>
                  {actionLoading ? 'Guardando...' : editingTemplate ? 'Guardar' : 'Crear'}
                </Text>
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
  /* === Sticky header (estilo web app-sticky-header) === */
  stickyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    ...shadows.sm,
  },
  stickyHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.green[50],
    borderWidth: 1,
    borderColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyHeaderText: { flex: 1 },
  stickyHeaderTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  stickyHeaderSubtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 1,
  },
  stickyHeaderAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
  },
  stickyHeaderActionText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.background,
  },
  /* === List header (legacy) === */
  headerRow: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[2] },
  headerTitle: { fontSize: 12, fontWeight: typography.fontWeight.bold, color: colorScales.gray[600], letterSpacing: 0.3 },
  filterRow: {
    flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[3],
  },
  filterChip: {
    paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.full,
    borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colors.background,
  },
  filterChipActive: { backgroundColor: colorScales.green[50], borderColor: colorScales.green[500] },
  filterChipText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colorScales.gray[600] },
  filterChipTextActive: { color: colorScales.green[600], fontWeight: typography.fontWeight.bold },
  card: {
    marginHorizontal: spacing[4], backgroundColor: colors.background, borderRadius: borderRadius.lg,
    padding: spacing[3], ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing[2],
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1, marginRight: spacing[2] },
  cardHeaderInfo: { flex: 1 },
  cardTitle: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colorScales.gray[900] },
  cardSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 1 },
  statusBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  statusBadgeText: { fontSize: 11, fontWeight: typography.fontWeight.semibold },
  cardMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginBottom: spacing[2], flexWrap: 'wrap',
  },
  metaText: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginRight: spacing[1] },
  cardActions: {
    flexDirection: 'row', gap: spacing[1], borderTopWidth: 1, borderTopColor: colorScales.gray[100],
    paddingTop: spacing[2],
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing[2], paddingVertical: spacing[1],
    borderRadius: borderRadius.md, backgroundColor: colorScales.gray[50],
  },
  actionBtnText: { fontSize: 11, fontWeight: typography.fontWeight.medium, color: colorScales.gray[600] },

  /* === Modal (estilo web, mismo patrón que locations.tsx createModal) === */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  modalSheet: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  modalHeaderText: { flex: 1 },
  modalTitle: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold as any, color: colorScales.gray[900] },
  modalSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  modalCloseBtn: { padding: spacing[1] },
  modalBody: { flexGrow: 0, flexShrink: 1, maxHeight: 480 },
  modalBodyContent: { padding: spacing[4], gap: spacing[3] },
  modalFooter: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4], borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colors.background, gap: spacing[2] },
  cancelBtn: { flex: 1, paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.gray[900], alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: typography.fontWeight.bold as any, color: colors.background },
  actionSpacer: { width: spacing[3] },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.green[100], alignItems: 'center', justifyContent: 'center' },
  confirmBtnDisabled: { backgroundColor: colorScales.gray[100] },
  confirmBtnText: { fontSize: 13, fontWeight: typography.fontWeight.bold as any, color: colorScales.green[800] },
  formRow: { flexDirection: 'row', gap: spacing[3] },
  formLabel: { fontSize: 10, fontWeight: typography.fontWeight.bold as any, fontFamily: typography.fontFamily, color: colorScales.gray[500], marginBottom: spacing[1.5], textTransform: 'uppercase', letterSpacing: 0.5 },
  formInput: {
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2.5], fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.background, fontFamily: typography.fontFamily,
  },
  formInputError: { borderColor: colorScales.red[500] },
  formErrorText: { fontSize: 11, color: colorScales.red[600], marginTop: spacing[1] },
  formTextarea: {
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2.5], fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.background,
    fontFamily: typography.fontFamily, minHeight: 70, textAlignVertical: 'top',
  },
  requiredStar: { color: colorScales.red[500] },
  chipRow: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  chip: { paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.full, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colors.background },
  chipActive: { backgroundColor: colorScales.green[50], borderColor: colorScales.green[500] },
  chipText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colorScales.gray[600] },
  chipTextActive: { color: colorScales.green[600], fontWeight: typography.fontWeight.bold },
  /* Toggle (estilo iOS) */
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3], paddingVertical: spacing[2] },
  toggleLabel: { fontSize: 14, fontWeight: typography.fontWeight.bold as any, color: colorScales.gray[900] },
  toggleDesc: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: colorScales.gray[300], padding: 2, justifyContent: 'center' },
  toggleActive: { backgroundColor: colors.primary },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.background, ...shadows.sm },
  toggleThumbActive: { transform: [{ translateX: 18 }] },
});
