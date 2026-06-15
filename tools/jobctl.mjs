// 就活ポータルのデータをコマンドラインから決定的に操作するワーカー CLI。
// Claude Code（サブスク）がプレイブックに従ってこれを叩く＝API課金ゼロで status / 締切 / ES を更新。
// すべての変更は status_log に証跡を残す（あなたの「出力チェック」用）。
//
// 使い方:
//   node tools/jobctl.mjs list                          全企業を JSON で一覧
//   node tools/jobctl.mjs find "<部分一致>"             企業を名前で検索（id を得る）
//   node tools/jobctl.mjs status <id|名前> "<状態>" [--source gmail --evidence "件名…"]
//   node tools/jobctl.mjs add-task <id|名前> "<ラベル>" <YYYY-MM-DD> [--source gmail --evidence "…"]
//   node tools/jobctl.mjs add-company "<企業名>" [--category … --vote B --status 検討中]
//   node tools/jobctl.mjs save-es <id|名前> "<設問>" <文字数上限> --text-file <path> [--source es]
//   node tools/jobctl.mjs log [N]                       直近 N 件の変更履歴
import { readFileSync } from 'node:fs';
import { admin, userId, logChange } from './lib.mjs';

const STATUSES = ['検討中', 'エントリー済', 'ES提出', 'Webテスト', '一次面接', '二次面接', '最終面接', '内定', '見送り'];

const db = admin();
const argv = process.argv.slice(2);
const cmd = argv[0];

// --flag value 形式のオプションを抜き出す
function opts(args) {
  const o = {}; const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { o[args[i].slice(2)] = args[i + 1]; i++; }
    else pos.push(args[i]);
  }
  return { o, pos };
}

async function getCompanies() {
  const uid = await userId(db);
  const { data, error } = await db.from('companies').select('*').eq('user_id', uid).order('created_at');
  if (error) throw error;
  return data || [];
}

async function resolve(ref) {
  const cs = await getCompanies();
  let c = cs.find((x) => x.id === ref);
  if (!c) {
    const hit = cs.filter((x) => x.name.includes(ref));
    if (hit.length === 1) c = hit[0];
    else if (hit.length > 1) { throw new Error(`「${ref}」が複数一致: ` + hit.map((x) => x.name).join(' / ') + '（id で指定して）'); }
  }
  if (!c) throw new Error(`企業が見つかりません: ${ref}`);
  return c;
}

try {
  if (cmd === 'list') {
    console.log(JSON.stringify(await getCompanies(), null, 2));

  } else if (cmd === 'find') {
    const cs = await getCompanies();
    const hit = cs.filter((x) => x.name.includes(argv[1] || ''));
    console.log(JSON.stringify(hit.map((c) => ({ id: c.id, name: c.name, status: c.status })), null, 2));

  } else if (cmd === 'status') {
    const { o, pos } = opts(argv.slice(1));
    const c = await resolve(pos[0]);
    const next = pos[1];
    if (!STATUSES.includes(next)) throw new Error(`未知のステータス: ${next}（${STATUSES.join('/')}）`);
    if (c.status === next) { console.log(`= 変更なし: ${c.name} は既に「${next}」`); process.exit(0); }
    const { error } = await db.from('companies').update({ status: next }).eq('id', c.id);
    if (error) throw error;
    await logChange(db, { companyId: c.id, companyName: c.name, field: 'status', oldValue: c.status, newValue: next, source: o.source || 'manual', evidence: o.evidence });
    console.log(`✓ ${c.name}: 「${c.status}」→「${next}」`);

  } else if (cmd === 'add-task') {
    const { o, pos } = opts(argv.slice(1));
    const c = await resolve(pos[0]);
    const label = pos[1]; const date = pos[2];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('日付は YYYY-MM-DD');
    const tasks = c.tasks || [];
    if (tasks.some((t) => t.label === label && t.date === date)) { console.log(`= 重複スキップ: ${c.name} ${label} ${date}`); process.exit(0); }
    const task = { id: cryptoId(), label, date, done: false };
    const { error } = await db.from('companies').update({ tasks: [...tasks, task] }).eq('id', c.id);
    if (error) throw error;
    await logChange(db, { companyId: c.id, companyName: c.name, field: 'task', newValue: `${label} ${date}`, source: o.source || 'manual', evidence: o.evidence });
    console.log(`✓ ${c.name}: 締切追加「${label} ${date}」`);

  } else if (cmd === 'add-company') {
    const { o, pos } = opts(argv.slice(1));
    const uid = await userId(db);
    const name = pos[0];
    if (!name) throw new Error('企業名が必要');
    const row = { user_id: uid, name, category: o.category || null, vote: o.vote || 'B', status: o.status || '検討中', tasks: [], es_drafts: [] };
    const { data, error } = await db.from('companies').insert(row).select().single();
    if (error) throw error;
    await logChange(db, { companyId: data.id, companyName: name, field: 'company', newValue: '新規追加', source: o.source || 'manual', evidence: o.evidence });
    console.log(`✓ 企業追加: ${name}（id=${data.id}）`);

  } else if (cmd === 'save-es') {
    const { o, pos } = opts(argv.slice(1));
    const c = await resolve(pos[0]);
    const question = pos[1]; const limit = Number(pos[2]) || 0;
    if (!o['text-file']) throw new Error('--text-file <path> が必要（本文ファイル）');
    const text = readFileSync(o['text-file'], 'utf8');
    const draft = { id: cryptoId(), question, limit, text, savedAt: new Date().toISOString() };
    const { error } = await db.from('companies').update({ es_drafts: [...(c.es_drafts || []), draft] }).eq('id', c.id);
    if (error) throw error;
    await logChange(db, { companyId: c.id, companyName: c.name, field: 'es_draft', newValue: `${question}（${[...text].length}字）`, source: o.source || 'es' });
    console.log(`✓ ${c.name}: ES下書き保存（${[...text].length}字）`);

  } else if (cmd === 'log') {
    const uid = await userId(db);
    const n = Number(argv[1]) || 20;
    const { data, error } = await db.from('status_log').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(n);
    if (error) throw error;
    for (const r of data) console.log(`${r.created_at.slice(0, 16).replace('T', ' ')}  [${r.source}] ${r.company_name || ''} ${r.field}: ${r.old_value ?? ''} → ${r.new_value ?? ''}${r.evidence ? '  «' + r.evidence + '»' : ''}`);

  } else {
    console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 21).join('\n').replace(/^\/\/ ?/gm, ''));
  }
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}

function cryptoId() {
  return (globalThis.crypto?.randomUUID?.() ) || (Date.now().toString(36) + Math.random().toString(36).slice(2));
}
