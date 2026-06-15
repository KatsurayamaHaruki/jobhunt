// profile-daicho.md（唯一の正）→ Supabase user_docs.profile に同期。
// 台帳を更新したら毎回これを実行すれば、ポータルの「資料」タブと一致する。
// 使い方: node tools/sync-profile.mjs
import { readFileSync } from 'node:fs';
import { admin, userId, PROFILE_PATH } from './lib.mjs';

const db = admin();
let md;
try {
  md = readFileSync(PROFILE_PATH, 'utf8');
} catch {
  console.error('✗ 台帳が読めません: ' + PROFILE_PATH + '（.env.local の PROFILE_PATH を確認）');
  process.exit(1);
}

const uid = await userId(db);
const { error } = await db.from('user_docs').upsert({
  user_id: uid, profile: md, updated_at: new Date().toISOString(),
});
if (error) { console.error('✗ 同期失敗: ' + error.message); process.exit(1); }
console.log(`✓ プロフィール台帳を同期しました（${[...md].length} 字） ← ${PROFILE_PATH}`);
