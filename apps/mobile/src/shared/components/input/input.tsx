import React, { useState } from 'react';
import { View, Text, TextInput, type TextInputProps } from 'react-native';
import { colors } from '@/shared/theme/colors';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
  helperText?: string;
  rightIcon?: React.ReactNode;
}

export function Input({
  label,
  error,
  helperText,
  rightIcon,
  className = '',
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View className="w-full">
      <Text className="text-[12px] font-semibold text-text-secondary mb-1.5 tracking-widest uppercase">
        {label}
      </Text>
      <View
        className={`flex-row items-center bg-white rounded-lg px-4 border ${
          error ? 'border-error' : isFocused ? 'border-primary' : 'border-inputBorder'
        }`}
      >
        <TextInput
          className={`flex-1 h-12 text-[14px] text-text-primary ${className}`}
          placeholderTextColor={colors.text.muted}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...props}
        />
        {rightIcon && <View className="ml-2">{rightIcon}</View>}
      </View>
      {error && <Text className="text-[12px] text-error mt-1">{error}</Text>}
      {helperText && !error && (
        <Text className="text-[12px] text-text-muted mt-1">{helperText}</Text>
      )}
    </View>
  );
}
