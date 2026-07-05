interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
  error?: string;
}

export default function Select({ label, options, error, className = '', ...props }: SelectProps) {
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
      <select
        className={`outline-none transition-all bg-white ${className}`}
        style={{
          height: '30px',
          lineHeight: '30px',
          fontSize: '14px',
          color: 'rgba(0,0,0,0.8)',
          border: error ? undefined : '1px solid #DCDFE6',
          borderRadius: '4px',
          padding: '0 12px',
          width: '100%',
          minWidth: '180px',
          transition: 'all 0.2s ease',
          cursor: 'pointer',
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
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p style={{ color: '#f5222d', fontSize: '12px', marginTop: '2px' }}>{error}</p>}
    </div>
  );
}
