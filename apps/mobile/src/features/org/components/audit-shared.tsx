import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Modal } from '@/shared/components/modal/modal';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';

/**
 * Visor de diff antiguo → nuevo para los `old_values` / `new_values` de
 * un AuditLog. Espejo del `DiffViewerComponent` de la web: dos columnas
 * lado a lado, con cada clave formateada como fila.
 *
 * Si ambos están ausentes, retorna `null` y el padre decide qué mostrar.
 */
export interface DiffRow {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function extractDiffRows(
  oldValues: Record<string, unknown> | null | undefined,
  newValues: Record<string, unknown> | null | undefined,
): DiffRow[] {
  const keys = new Set<string>([
    ...Object.keys(oldValues ?? {}),
    ...Object.keys(newValues ?? {}),
  ]);
  return Array.from(keys)
    .sort()
    .map((key) => ({
      key,
      oldValue: oldValues?.[key],
      newValue: newValues?.[key],
    }));
}

interface DiffViewerProps {
  rows: DiffRow[];
}

export function DiffViewer({ rows }: DiffViewerProps) {
  if (rows.length === 0) {
    return (
      <Text style={styles.diffEmpty}>No hay cambios registrados en old_values / new_values.</Text>
    );
  }
  return (
    <View style={styles.diffWrap}>
      <View style={styles.diffHeader}>
        <Text style={[styles.diffHeaderText, { flex: 1.5 }]}>Campo</Text>
        <Text style={[styles.diffHeaderText, { flex: 2 }]}>Antes</Text>
        <Text style={[styles.diffHeaderText, { flex: 2 }]}>Después</Text>
      </View>
      {rows.map((row) => {
        const changed = formatValue(row.oldValue) !== formatValue(row.newValue);
        return (
          <View
            key={row.key}
            style={[styles.diffRow, changed && styles.diffRowChanged]}
          >
            <Text style={[styles.diffKey, { flex: 1.5 }]} numberOfLines={1}>
              {row.key}
            </Text>
            <Text style={[styles.diffVal, styles.diffOld, { flex: 2 }]} numberOfLines={3}>
              {formatValue(row.oldValue)}
            </Text>
            <Text style={[styles.diffVal, styles.diffNew, { flex: 2 }]} numberOfLines={3}>
              {formatValue(row.newValue)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AuditLog detail modal (logs.component.ts web → modal fullscreen)
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditLogDetailModalProps {
  visible: boolean;
  log: import('@/core/models/org-admin/audit.types').AuditLog | null;
  /** Header label transformer para "Acción". */
  formatAction: (a: string) => string;
  formatResource: (r: string) => string;
  getActionIcon: (a: string) => string;
  getActionColor: (a: string) => string;
  formatUser: (log: import('@/core/models/org-admin/audit.types').AuditLog) => string;
  onClose: () => void;
}

export function AuditLogDetailModal({
  visible,
  log,
  formatAction,
  formatResource,
  getActionIcon,
  getActionColor,
  formatUser,
  onClose,
}: AuditLogDetailModalProps) {
  if (!log) return null;
  const diffRows = extractDiffRows(log.old_values, log.new_values);
  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title="Detalle de Auditoría"
      subtitle={log.id ? `Evento ID: ${log.id}` : undefined}
      size="lg"
      footer={
        <View style={styles.modalActions}>
          <Pressable
            style={[styles.modalBtn, styles.modalBtnSecondary]}
            onPress={onClose}
          >
            <Text style={styles.modalBtnSecondaryText}>Cerrar</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.detailHero}>
        <View
          style={[
            styles.detailHeroIcon,
            { backgroundColor: getActionColor(log.action) + '15' },
          ]}
        >
          <Icon name={getActionIcon(log.action)} size={22} color={getActionColor(log.action)} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.detailHeroTitle}>{formatAction(log.action)}</Text>
          <Text style={styles.detailHeroSub} numberOfLines={1}>
            {formatResource(log.resource)}
            {log.resource_id ? ` · #${log.resource_id}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Información</Text>
        <View style={styles.card}>
          <OrgDetailRow icon="user" label="Usuario" value={formatUser(log)} />
          <OrgDetailRow
            icon="calendar"
            label="Fecha"
            value={new Date(log.created_at).toLocaleString()}
          />
          <OrgDetailRow
            icon="globe"
            label="IP"
            value={log.ip_address ?? 'N/A'}
            monospace
          />
          {log.user_agent ? (
            <OrgDetailRow icon="monitor" label="Dispositivo" value={log.user_agent} />
          ) : null}
          {log.description ? (
            <OrgDetailRow icon="file-text" label="Descripción" value={log.description} />
          ) : null}
        </View>
      </View>

      {diffRows.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cambios registrados</Text>
          <DiffViewer rows={diffRows} />
        </View>
      ) : null}
    </OrgCenteredModal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter BottomSheet (selectable list — replicado para Recurso / Acción)
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectableOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  color?: string;
}

export interface SelectableFilterSheetProps<T extends string> {
  visible: boolean;
  title: string;
  options: SelectableOption<T>[];
  selected?: T | null;
  onSelect: (value: T | null) => void;
  onClose: () => void;
  /** Etiqueta del botón "Todos". */
  allLabel?: string;
}

export function SelectableFilterSheet<T extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  allLabel = 'Todos',
}: SelectableFilterSheetProps<T>) {
  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={title}
      showCloseButton
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        <Pressable
          style={[styles.opt, !selected && styles.optActive]}
          onPress={() => {
            onSelect(null);
            onClose();
          }}
        >
          <Icon name="inbox" size={16} color={colorScales.gray[500]} />
          <Text style={[styles.optText, !selected && styles.optTextActive]}>{allLabel}</Text>
          {!selected ? <Icon name="check" size={16} color={colorScales.green[600]} /> : null}
        </Pressable>
        {options.map((opt) => {
          const active = selected === opt.value;
          return (
            <Pressable
              key={opt.value}
              style={[styles.opt, active && styles.optActive]}
              onPress={() => {
                onSelect(opt.value);
                onClose();
              }}
            >
              {opt.icon ? (
                <Icon name={opt.icon} size={16} color={opt.color ?? colorScales.gray[700]} />
              ) : (
                <View style={{ width: 16 }} />
              )}
              <Text style={[styles.optText, active && styles.optTextActive]} numberOfLines={1}>
                {opt.label}
              </Text>
              {active ? <Icon name="check" size={16} color={colorScales.green[600]} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination footer — replica la barra inferior de las tablas web.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}

export function PaginationBar({ page, totalPages, total, onChange }: PaginationBarProps) {
  if (totalPages <= 1) {
    return (
      <Text style={styles.pagerMeta}>
        {total} {total === 1 ? 'registro' : 'registros'}
      </Text>
    );
  }
  return (
    <View style={styles.pager}>
      <Text style={styles.pagerMeta}>
        Página {page} de {totalPages} · {total} registros
      </Text>
      <View style={styles.pagerBtns}>
        <Pressable
          style={[styles.pagerBtn, page === 1 && styles.pagerBtnDisabled]}
          disabled={page === 1}
          onPress={() => onChange(page - 1)}
        >
          <Text style={[styles.pagerBtnText, page === 1 && styles.pagerBtnTextDisabled]}>
            Anterior
          </Text>
        </Pressable>
        <Pressable
          style={[styles.pagerBtn, page === totalPages && styles.pagerBtnDisabled]}
          disabled={page === totalPages}
          onPress={() => onChange(page + 1)}
        >
          <Text style={[styles.pagerBtnText, page === totalPages && styles.pagerBtnTextDisabled]}>
            Siguiente
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  detailHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  detailHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeroTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  detailHeroSub: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  section: {
    marginBottom: spacing[4],
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing[2],
  },
  card: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[3],
  },
  diffWrap: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    overflow: 'hidden',
  },
  diffHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.gray[100],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  diffHeaderText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    textTransform: 'uppercase',
    color: colorScales.gray[500],
  },
  diffRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  diffRowChanged: {
    backgroundColor: colorScales.amber[50],
  },
  diffKey: {
    fontSize: 12,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },
  diffVal: {
    fontSize: 12,
    fontFamily: 'Menlo',
    paddingRight: spacing[2],
  },
  diffOld: {
    color: colorScales.red[700],
  },
  diffNew: {
    color: colorScales.green[700],
  },
  diffEmpty: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing[4],
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing[2],
    justifyContent: 'flex-end',
  },
  modalBtn: {
    height: 40,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondary: { backgroundColor: colorScales.gray[100] },
  modalBtnSecondaryText: { color: colorScales.gray[700], fontWeight: typography.fontWeight.semibold },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  optActive: {
    backgroundColor: colorScales.green[50],
  },
  optText: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colorScales.gray[800],
  },
  optTextActive: {
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.green[800],
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  pagerMeta: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  pagerBtns: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  pagerBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  pagerBtnDisabled: {
    opacity: 0.5,
  },
  pagerBtnText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[800],
  },
  pagerBtnTextDisabled: {
    color: colorScales.gray[400],
  },
});
