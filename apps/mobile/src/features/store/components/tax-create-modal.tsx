import { useState } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Input, Selector, Textarea, Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess } from '@/shared/components/toast/toast.store';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface TaxCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (tax: { id: number; name: string }) => void;
}

const CALC_TYPE_OPTIONS = [
  { label: 'Porcentaje', value: 'percentage' },
  { label: 'Fijo', value: 'fixed' },
];

const FISCAL_CLASS_OPTIONS = [
  { label: 'IVA', value: 'iva' },
  { label: 'Impoconsumo (INC)', value: 'inc' },
  { label: 'ICA', value: 'ica' },
  { label: 'Retención', value: 'withholding' },
  { label: 'ReteIVA', value: 'reteiva' },
  { label: 'ReteICA', value: 'reteica' },
];

export function TaxCreateModal({ visible, onClose, onCreated }: TaxCreateModalProps) {
  const [name, setName] = useState('');
  const [calcType, setCalcType] = useState('percentage');
  const [fiscalClass, setFiscalClass] = useState('iva');
  const [rate, setRate] = useState('');
  const [description, setDescription] = useState('');

  function reset() {
    setName('');
    setCalcType('percentage');
    setFiscalClass('iva');
    setRate('');
    setDescription('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit() {
    if (!name.trim()) {
      toastSuccess('Funcionalidad próximamente');
      return;
    }
    const fakeId = Date.now();
    onCreated?.({ id: fakeId, name: name.trim() });
    toastSuccess('Impuesto agregado (local)');
    reset();
    onClose();
  }

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />

        {/* Card centrada — max-w-2xl (672px) en web, 480px en mobile */}
        <View style={styles.cardWrapper}>
          <View style={styles.card}>
            {/* ── Header: título a la izquierda + X a la derecha ── */}
            <View style={styles.header}>
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  Crear Nueva Categoría de Impuesto
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { backgroundColor: colorScales.gray[100] },
                ]}
                accessibilityLabel="Cerrar modal"
              >
                <Icon name="x" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            {/* ── Body: form scrollable ── */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Input
                label="Nombre de la Categoría"
                value={name}
                onChangeText={setName}
                placeholder="Ej. IVA, IVA Reducido"
                required
                maxLength={120}
              />
              <Selector
                label="Tipo de cálculo"
                value={calcType}
                onChange={(v) => setCalcType(v as string)}
                options={CALC_TYPE_OPTIONS}
                placeholder="Seleccionar tipo"
                required
              />
              <Selector
                label="Clasificación fiscal"
                value={fiscalClass}
                onChange={(v) => setFiscalClass(v as string)}
                options={FISCAL_CLASS_OPTIONS}
                placeholder="Seleccionar clasificación"
                required
              />
              <Input
                label="Tasa"
                value={rate}
                onChangeText={setRate}
                placeholder="Ej. 19"
                keyboardType="decimal-pad"
                required
                rightIcon={<Text style={styles.suffixText}>%</Text>}
              />
              <Textarea
                label="Descripción"
                value={description}
                onChangeText={setDescription}
                placeholder="Descripción de la categoría de impuesto (opcional)"
                rows={3}
                maxLength={500}
              />
            </ScrollView>

            {/* ── Footer: Cancelar + Crear Impuesto (sticky en bottom) ── */}
            <View style={styles.footer}>
              <View style={styles.footerButtonWrap}>
                <Button
                  title="Cancelar"
                  variant="outline"
                  onPress={handleClose}
                  fullWidth
                />
              </View>
              <View style={styles.footerButtonWrap}>
                <Button
                  title="Crear Impuesto"
                  variant="primary"
                  onPress={handleSubmit}
                  fullWidth
                />
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const CARD_MAX_WIDTH = 480;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  cardWrapper: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    maxHeight: '90%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    // shadow-xl (mirror del web: 0 20px 25px -5px + 0 8px 10px -6px)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.1,
    shadowRadius: 25,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  headerTitleWrap: {
    flex: 1,
    marginRight: spacing[2],
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  footerButtonWrap: {
    flex: 1,
  },
  suffixText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
  },
});
