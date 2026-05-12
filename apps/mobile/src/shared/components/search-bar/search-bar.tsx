import { useEffect, useRef, useState } from 'react';
import { View, TextInput, Pressable, Text, StyleSheet, type ViewStyle, type TextInputProps } from 'react-native';
import { colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface SearchBarProps extends Omit<TextInputProps, 'style' | 'onChangeText'> {
  onChangeText?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onClear?: () => void;
  style?: ViewStyle;
  debounceMs?: number;
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
    paddingVertical: 0,
  },
  clearButton: {
    color: colorScales.gray[400],
    fontSize: 18,
  },
});

export function SearchBar({
  value,
  onChangeText,
  onSubmit,
  onClear,
  placeholder = 'Buscar...',
  style,
  debounceMs = 300,
  ...props
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value || '');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef(value || '');
  const onChangeTextRef = useRef(onChangeText);

  useEffect(() => {
    onChangeTextRef.current = onChangeText;
  }, [onChangeText]);

  useEffect(() => {
    const next = value ?? '';
    if (next !== lastEmittedRef.current) {
      lastEmittedRef.current = next;
      setLocalValue(next);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const emit = (text: string, immediate = false) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const fire = () => {
      lastEmittedRef.current = text;
      onChangeTextRef.current?.(text);
    };
    if (immediate || debounceMs <= 0) {
      fire();
    } else {
      timerRef.current = setTimeout(fire, debounceMs);
    }
  };

  const handleChange = (text: string) => {
    setLocalValue(text);
    emit(text);
  };

  const handleClear = () => {
    setLocalValue('');
    emit('', true);
    onClear?.();
  };

  const handleSubmit = () => {
    emit(localValue, true);
    onSubmit?.(localValue);
  };

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.searchIcon}>🔍</Text>
      <TextInput
        style={styles.textInput}
        value={localValue}
        onChangeText={handleChange}
        onSubmitEditing={handleSubmit}
        placeholder={placeholder}
        placeholderTextColor={colorScales.gray[400]}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
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
