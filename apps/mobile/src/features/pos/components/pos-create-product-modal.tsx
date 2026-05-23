import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput, Alert } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ProductService } from '@/features/store/services';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

interface PosCreateProductModalProps {
  visible: boolean;
  onClose: () => void;
}

export function PosCreateProductModal({ visible, onClose }: PosCreateProductModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [sku, setSku] = useState('');

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: any) => ProductService.create(data),
    onSuccess: () => {
      toastSuccess('Producto creado exitosamente');
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      onClose();
      setName('');
      setDescription('');
      setBasePrice('');
      setSku('');
    },
    onError: () => {
      toastError('Error al crear el producto');
    },
  });

  const handleCreate = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre del producto es obligatorio');
      return;
    }

    if (!basePrice || parseFloat(basePrice) <= 0) {
      Alert.alert('Error', 'El precio debe ser mayor a 0');
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      base_price: parseFloat(basePrice),
      sku: sku.trim() || undefined,
      state: 'active',
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn}>
            <Icon name="x" size={24} color={colorScales.gray[700]} />
          </Pressable>
          <Text style={styles.title}>Crear Producto</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content}>
          {/* Name */}
          <View style={styles.field}>
            <Text style={styles.label}>Nombre *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Nombre del producto"
              placeholderTextColor={colorScales.gray[400]}
              autoCapitalize="sentences"
            />
          </View>

          {/* Description */}
          <View style={styles.field}>
            <Text style={styles.label}>Descripción</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Descripción opcional"
              placeholderTextColor={colorScales.gray[400]}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Base Price */}
          <View style={styles.field}>
            <Text style={styles.label}>Precio Base *</Text>
            <TextInput
              style={styles.input}
              value={basePrice}
              onChangeText={setBasePrice}
              placeholder="0.00"
              placeholderTextColor={colorScales.gray[400]}
              keyboardType="decimal-pad"
            />
          </View>

          {/* SKU */}
          <View style={styles.field}>
            <Text style={styles.label}>SKU</Text>
            <TextInput
              style={styles.input}
              value={sku}
              onChangeText={setSku}
              placeholder="Código SKU opcional"
              placeholderTextColor={colorScales.gray[400]}
              autoCapitalize="characters"
            />
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={[styles.createBtn, createMutation.isPending && styles.createBtnDisabled]}
            onPress={handleCreate}
            disabled={createMutation.isPending}
          >
            <Text style={styles.createBtnText}>
              {createMutation.isPending ? 'Creando...' : 'Crear Producto'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  content: {
    flex: 1,
    padding: spacing[4],
  },
  field: {
    marginBottom: spacing[4],
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    marginBottom: spacing[2],
  },
  input: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colorScales.gray[50],
  },
  textArea: {
    minHeight: 80,
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  createBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  createBtnDisabled: {
    opacity: 0.6,
  },
  createBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
