'use client';

import { ButtonHTMLAttributes, forwardRef, useState } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  debounce?: number;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, debounce = 0, onClick, disabled, children, className = '', ...props }, ref) => {
    const [locked, setLocked] = useState(false);

    const variants: Record<string, string> = {
      primary: 'bg-jt text-white hover:bg-jt-hover active:bg-jt-dark',
      secondary: 'bg-white text-jt border border-jt hover:bg-jt-light active:bg-gray-100',
      danger: 'bg-red-500 text-white hover:bg-red-600 active:bg-red-700',
      ghost: 'bg-transparent text-jt-text-secondary hover:bg-gray-100 active:bg-gray-200',
    };

    const sizeMap: Record<string, React.CSSProperties> = {
      sm: { height: '28px', padding: '0 12px', fontSize: '12px', lineHeight: '28px' },
      md: { height: '30px', padding: '0 16px', fontSize: '14px', lineHeight: '30px' },
      lg: { height: '36px', padding: '0 20px', fontSize: '14px', lineHeight: '36px' },
    };

    const isDisabled = disabled || loading || locked;

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (isDisabled) return;
      if (debounce > 0) {
        setLocked(true);
        setTimeout(() => setLocked(false), debounce);
      }
      onClick?.(e);
    };

    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 cursor-pointer select-none ${variants[variant]} ${isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''} ${className}`}
        style={{
          ...sizeMap[size],
          borderRadius: '4px',
          border: variant === 'secondary' ? '1px solid #00bebe' : 'none',
          whiteSpace: 'nowrap',
        }}
        onClick={handleClick}
        disabled={isDisabled}
        {...props}
      >
        {loading && (
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
