'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

const demoAccounts = [
  { username: 'reporter', label: '上报人 张上报' },
  { username: 'l1', label: '一级审批 李一审' },
  { username: 'l2', label: '二级审批 王二审' },
  { username: 'qc', label: '品控主管 钱品控' },
];

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('reporter');
  const [password, setPassword] = useState('demo123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || '登录失败');
        setLoading(false);
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('网络错误');
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 w-[360px]">
      <h2 className="text-base font-semibold text-jt-text mb-4">登录</h2>
      <form onSubmit={submit} className="space-y-3">
        <Input
          label="账号"
          value={username}
          onChange={(e) => setUsername((e.target as HTMLInputElement).value)}
          placeholder="输入用户名"
        />
        <Input
          label="密码"
          type="password"
          value={password}
          onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
          placeholder="demo123"
        />
        {error && <div className="text-sm text-jt-error">{error}</div>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? '登录中...' : '登录'}
        </Button>
      </form>
      <div className="mt-4 pt-4 border-t border-jt-border">
        <div className="text-xs text-jt-text-secondary mb-2">演示账号（密码均为 demo123）：</div>
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {demoAccounts.map((a) => (
            <button
              key={a.username}
              onClick={() => {
                setUsername(a.username);
                setPassword('demo123');
              }}
              className="text-left px-2 py-1 rounded bg-gray-50 hover:bg-jt-light text-jt-text"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
