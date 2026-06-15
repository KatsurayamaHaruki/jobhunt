'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/');
    });
  }, [router]);

  async function send() {
    if (!email.trim()) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  async function google() {
    setErr('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
    if (error) setErr(error.message);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>就活ポータル</h1>
        <p>Googleアカウントでそのままログインできます。</p>
        {sent ? (
          <p style={{ color: 'var(--calm)' }}>
            {email} にリンクを送りました。メール内のリンクを開くとログインされます。
          </p>
        ) : (
          <>
            <button className="btn google" style={{ width: '100%' }} onClick={google}>
              <span className="g-icon">G</span> Googleでログイン
            </button>
            <div className="or-divider"><span>または メールでログイン</span></div>
            <div className="field">
              <label>メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="you@example.com"
              />
            </div>
            {err && <p style={{ color: 'var(--urgent)', fontSize: 13 }}>{err}</p>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={send}>
              {busy ? '送信中…' : 'ログインリンクを送る'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
