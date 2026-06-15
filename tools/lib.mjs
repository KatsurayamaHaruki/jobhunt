// ローカル専用ワーカーの共通土台（Supabase 書き込み）。
// service_role キーを使う。ブラウザには絶対に載せない（このファイルは Node 専用）。
import { createClient } from '@supabase/supabase-js';
import { PROFILE_PATH, ROOT } from './env.mjs';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_EMAIL = process.env.JOBHUNT_USER_EMAIL;

export { PROFILE_PATH, ROOT };

export function requireEnv() {
  const missing = [];
  if (!URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!USER_EMAIL) missing.push('JOBHUNT_USER_EMAIL');
  if (missing.length) {
    console.error('✗ .env.local が未設定です: ' + missing.join(', '));
    process.exit(1);
  }
}

export function admin() {
  requireEnv();
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
}

let _uid = null;
export async function userId(db) {
  if (_uid) return _uid;
  // service_role なら admin API でメールから user を引ける
  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw error;
  const u = (data?.users || []).find((x) => (x.email || '').toLowerCase() === USER_EMAIL.toLowerCase());
  if (!u) throw new Error(`ユーザーが見つかりません: ${USER_EMAIL}（まず一度ポータルにログインして下さい）`);
  _uid = u.id;
  return _uid;
}

// 変更履歴を1行記録する（AIの出力チェック用の証跡）
export async function logChange(db, { companyId = null, companyName = null, field, oldValue = null, newValue = null, source = 'manual', evidence = null }) {
  const uid = await userId(db);
  const { error } = await db.from('status_log').insert({
    user_id: uid, company_id: companyId, company_name: companyName,
    field, old_value: oldValue == null ? null : String(oldValue),
    new_value: newValue == null ? null : String(newValue),
    source, evidence,
  });
  if (error) throw error;
}
