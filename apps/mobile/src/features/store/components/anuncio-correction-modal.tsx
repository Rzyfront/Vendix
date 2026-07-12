/**
 * AnuncioCorrectionModal — Modal centered-card `md` para pedir una
 * corrección al AI.
 *
 * Replica `app-modal size="md"` del web
 * (`anuncio-create-wizard-page.component.ts:1087-1123`).
 *
 * Anatomía (Web Visual Pattern):
 *  - Centered card `md` (maxWidth 480)
 *  - Header: "Regenerar con correccion" + subtitle
 *  - Body: Textarea "Que quieres corregir?" + maxLength 1000
 *  - Footer: outline "Cancelar" + primary "Regenerar" right-aligned
 *    (Regenerar disabled if text vacío)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Modal as RNModal,
  Pressable,
  View,
  Text,
  StyleSheet,
} from 'react-native';

import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import { Textarea } from '@/shared/components/textarea/textarea';

import { ANUNCIO_LABELS } from '@/features/store/constants/anuncio-labels';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

export interface AnuncioCorrectionModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (text: string) => void | Promise<void>;
  loading?: boolean;
}

const PLACEHOLDER = 'Ej: el logo salio cortado, el texto no se lee...';
const MAX_LENGTH = 1000;

export function AnuncioCorrectionModal({
  visible,
  onClose,
  onConfirm,
  loading,
}: AnuncioCorrectionModalProps) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!visible) {
      setText('');
    }
  }, [visible]);

  const handleConfirm = useCallback(() => {
    if (!text.trim() || loading) return;
    void onConfirm(text.trim());
  }, [text, loading, onConfirm]);

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.cardWrapper} onPress={(e) => e.stopPropagation()}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title}>{ANUNCIO_LABELS.modalCorrectionTitle}</Text>
                <Text style={styles.subtitle}>{ANUNCIO_LABELS.modalCorrectionSubtitle}</Text>
              </View>
              <Pressable style={styles.closeButton} onPress={onClose}>
                <Icon name="x" size={18} color={colorScales.gray[700]} />
              </Pressable>
            </View>

            <View style={styles.body}>
              <Textarea
                value={text}
                onChangeText={setText}
                label={ANUNCIO_LABELS.fieldCorrection}
                placeholder={PLACEHOLDER}
                rows={5}
                maxLength={MAX_LENGTH}
              />
            </View>

            <View style={styles.footer}>
              <Button
                variant="outline"
                size="md"
                onPress={onClose}
                title={ANUNCIO_LABELS.ctaCancel}
              />
              <Button
                variant="primary"
                size="md"
                onPress={handleConfirm}
                loading={loading}
                disabled={!text.trim() || Boolean(loading)}
                title={ANUNCIO_LABELS.ctaRegenerate}
                leftIcon={<Icon name="refresh-cw" size={16} color={colors.card} />}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 480,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  headerText: {
    flex: 1,
    gap: spacing[1],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
  },
  body: {
    padding: spacing[4],
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
});
