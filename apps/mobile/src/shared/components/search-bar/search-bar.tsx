import { useState } from 'react';
import { View, TextInput, Pressable, Text, StyleSheet, type ViewStyle, type TextInputProps } from 'react-native';
import { colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface SearchBarProps extends Omit<TextInputProps, 'style'> {
  onSubmit?: (value: string) => void;
  onClear?: () => void;
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    height: 44,
  },
  searchIcon: {
    color: colorScales.gray[400],
    marginRight: spacing[2],
    fontSize: 18,
  },
  textInput: {
    flex: 1,
    color: colorScales.gray[900],
    fontSize: typography.fontSize.base,
  },
  clearButton: {
    color: colorScales.gray[400],
    fontSize: 18,
  },
});

export function SearchBar({
  value,
  onSubmit,
  onClear,
  placeholder = 'Search...',
  style,
  ...props
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value || '');

  const handleClear = () => {
    setLocalValue('');
    onClear?.();
  };

  const handleSubmit = () => {
    onSubmit?.(localValue);
  };

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.searchIcon}>🔍</Text>
      <TextInput
        style={styles.textInput}
        value={localValue}
        onChangeText={setLocalValue}
        onSubmitEditing={handleSubmit}
        placeholder={placeholder}
        placeholderTextColor={colorScales.gray[400]}
        returnKeyType="search"
        {...props}
      />
      {localValue.length > 0 && (
        <Pressable onPress={handleClear} hitSlop={8}>
          <Text style={styles.clearButton}>×</Text>
        </Pressable>
      )}
    </View>
  );
}
