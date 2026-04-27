import { View, Text, type ViewProps } from 'react-native';

interface CardProps extends ViewProps {
  children: React.ReactNode;
}

interface CardHeaderProps extends ViewProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

interface CardBodyProps extends ViewProps {
  children: React.ReactNode;
}

interface CardFooterProps extends ViewProps {
  children: React.ReactNode;
}

function Card({ children, className = '', ...props }: CardProps) {
  return (
    <View
      className={`bg-white rounded-xl shadow-sm border border-gray-100 ${className}`}
      {...props}
    >
      {children}
    </View>
  );
}

function CardHeader({ title, subtitle, right, className = '', ...props }: CardHeaderProps) {
  return (
    <View className={`px-4 py-3 border-b border-gray-100 ${className}`} {...props}>
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-base font-semibold text-gray-900">{title}</Text>
          {subtitle && <Text className="text-sm text-gray-500 mt-0.5">{subtitle}</Text>}
        </View>
        {right && <View>{right}</View>}
      </View>
    </View>
  );
}

function CardBody({ children, className = '', ...props }: CardBodyProps) {
  return (
    <View className={`px-4 py-4 ${className}`} {...props}>
      {children}
    </View>
  );
}

function CardFooter({ children, className = '', ...props }: CardFooterProps) {
  return (
    <View className={`px-4 py-3 border-t border-gray-100 ${className}`} {...props}>
      {children}
    </View>
  );
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;

export { Card };
