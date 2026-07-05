import { InputHTMLAttributes, ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

export default function Input({ label, error, icon, className = '', ...props }: InputProps) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', marginRight: '20px', marginBottom: '16px', verticalAlign: 'bottom' }}>
      {label && (
        <label style={{
          padding: '0 12px 0 0',
          color: 'rgba(0,0,0,0.8)',
          fontSize: '14px',
          lineHeight: '22px',
          whiteSpace: 'nowrap',
          marginBottom: '4px',
        }}>
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</div>
        )}
        <input
          className={`outline-none transition-all ${error ? 'border-red-400' : ''} ${icon ? 'pl-10' : ''} ${className}`}
          style={{
            height: '30px',
            lineHeight: '30px',
            fontSize: '14px',
            color: 'rgba(0,0,0,0.8)',
            border: error ? undefined : '1px solid #DCDFE6',
            borderRadius: '4px',
            padding: icon ? undefined : '0 12px',
            width: '100%',
            minWidth: '180px',
            transition: 'all 0.2s ease',
          }}
          onFocus={(e) => {
            if (!error) {
              e.currentTarget.style.borderColor = '#00BEBE';
              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0, 190, 190, 0.1)';
            }
          }}
          onBlur={(e) => {
            if (!error) {
              e.currentTarget.style.borderColor = '#DCDFE6';
              e.currentTarget.style.boxShadow = 'none';
            }
          }}
          placeholder={props.placeholder}
          {...props}
        />
      </div>
      {error && <p style={{ color: '#f5222d', fontSize: '12px', marginTop: '2px' }}>{error}</p>}
    </div>
  );
}
