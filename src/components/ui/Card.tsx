interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}

export default function Card({ title, children, className = '', padding = true }: CardProps) {
  return (
    <div className={`bg-white border border-jt-border ${className}`} style={{ borderRadius: '8px', boxShadow: '0 1px 6px 0 rgba(0,0,0,0.06)', margin: '16px', padding: '12px' }}>
      {title && (
        <div className="px-3 py-3 mb-3 flex items-center gap-2">
          <div className="w-1 h-4 rounded-sm bg-jt" />
          <h3 className="text-base font-bold" style={{ color: 'rgba(0,0,0,0.8)' }}>{title}</h3>
        </div>
      )}
      <div className={padding ? 'px-3 pb-2' : ''}>{children}</div>
    </div>
  );
}
