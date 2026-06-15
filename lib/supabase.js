import { createClient } from '@supabase/supabase-js';

// 環境変数が未設定（ローカルの初期状態やビルドのプリレンダリング時）でも
// createClient が throw しないようプレースホルダにフォールバックする。
// 実際の値は NEXT_PUBLIC_* としてビルド時に注入される。未設定のままでは通信は当然失敗する。
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(url, key);
