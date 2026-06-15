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

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>就活ポータル</h1>
        <p>メールアドレスにログイン用リンクを送ります。</p>
        {sent ? (
          <p style={{ color: 'var(--calm)' }}>
            {email} にリンクを送りました。メール内のリンクを開くとログインされます。
          </p>
        ) : (
          <>
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
