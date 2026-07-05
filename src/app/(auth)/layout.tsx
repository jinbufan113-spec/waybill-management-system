import Link from 'next/link';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-jt-bg flex flex-col items-center justify-center p-4">
      <div className="mb-6 flex items-center gap-2">
        <div className="w-9 h-9 rounded bg-jt flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <span className="text-lg font-bold text-jt-text">运单全流程管理系统 V3</span>
      </div>
      {children}
      <div className="mt-6 text-xs text-jt-text-secondary">
        <Link href="/" className="hover:text-jt">返回首页</Link>
      </div>
    </div>
  );
}
