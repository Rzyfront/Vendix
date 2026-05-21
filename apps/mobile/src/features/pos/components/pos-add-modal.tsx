import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface PosAddModalProps {
  visible: boolean;
  onClose: () => void;
  onSearchCustomer: () => void;
  onCreateCustomer: () => void;
}

export function PosAddModal({
  visible,
  onClose,
  onSearchCustomer,
  onCreateCustomer,
}: PosAddModalProps) {
  const options = [
    {
      id: 'search',
      icon: 'search' as const,
      title: 'Buscar cliente',
      description: 'Buscar un cliente existente',
      action: onSearchCustomer,
    },
    {
      id: 'create',
      icon: 'user-plus' as const,
      title: 'Crear cliente rápido',
      description: 'Crear un nuevo cliente rápidamente',
      action: onCreateCustomer,
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.modal} onPress={() => {}}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Agregar Productos</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Icon name="x" size={20} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          {/* Options */}
          <View style={styles.optionsContainer}>
            {options.map((option) => (
              <Pressable
                key={option.id}
                style={({ pressed }) => [
                  styles.optionBtn,
                  pressed && styles.optionBtnPressed,
                ]}
                onPress={() => {
                  option.action();
                  onClose();
                }}
              >
                <View style={styles.optionIcon}>
                  <Icon name={option.icon} size={24} color={colors.primary} />
                </View>
                <View style={styles.optionContent}>
                  <Text style={styles.optionTitle}>{option.title}</Text>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colorScales.gray[400]} />
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  modal: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.background,
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsContainer: {
    padding: spacing[2],
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.background,
    gap: spacing[3],
  },
  optionBtnPressed: {
    backgroundColor: colorScales.gray[50],
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.xl,
    backgroundColor: colorScales.green[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  optionDescription: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
});
