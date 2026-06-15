'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

const CATS = ['大手SIer', '金融IT子会社', 'AI・Web系', '事業会社（内製）', '非IT', 'その他'];
const STATUSES = ['検討中', 'エントリー済', 'ES提出', 'Webテスト', '一次面接', '二次面接', '最終面接', '内定', '見送り'];
const LIVE = new Set(['エントリー済', 'ES提出', 'Webテスト', '一次面接', '二次面接', '最終面接']);
const TASK_LABELS = ['ES締切', 'Webテスト', '説明会', '一次面接', '二次面接', '最終面接', '面談'];

const jpLen = (s) => [...(s || '')].length;
function dayDiff(d) { if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(d + 'T00:00:00') - t) / 86400000); }
function urgency(x) { if (x === null) return ''; if (x < 0) return 'over'; if (x <= 3) return 'urgent'; if (x <= 7) return 'warn'; return ''; }
function countText(x) { if (x === null) return ['—', '']; if (x < 0) return [String(-x), '日超過']; if (x === 0) return ['今日', '']; return [String(x), '日後']; }
function statusClass(s) { if (s === '内定') return 'win'; if (s === '見送り') return 'lose'; if (LIVE.has(s)) return 'live'; return ''; }
const blank = { name: '', category: CATS[0], vote: 'B', status: '検討中', mypage_url: '', es_doc_url: '', memo: '' };

export default function Portal() {
  const router = useRouter();
  const [session, setSession] = useState(undefined);
  const [companies, setCompanies] = useState([]);
  const [docs, setDocs] = useState({ master_doc: '', profile: '' });
  const [logs, setLogs] = useState([]);
  const [tab, setTab] = useState('dash');
  const [filters, setFilters] = useState({ cat: '', status: '', sort: 'deadline' });
  const [modal, setModal] = useState(null); // null | {edit?} form object
  const [toast, setToast] = useState('');
  const fileRef = useRef(null);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 2300); }, []);

  // auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) router.replace('/login');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) router.replace('/login');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  // load data once session known
  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data: cs } = await supabase.from('companies').select('*').order('created_at', { ascending: true });
      setCompanies(cs || []);
      const { data: d } = await supabase.from('user_docs').select('*').eq('user_id', session.user.id).maybeSingle();
      if (d) setDocs({ master_doc: d.master_doc || '', profile: d.profile || '' });
      const { data: lg } = await supabase.from('status_log').select('*').order('created_at', { ascending: false }).limit(100);
      setLogs(lg || []);
    })();
  }, [session]);

  async function patchCompany(id, patch) {
    setCompanies((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase.from('companies').update(patch).eq('id', id);
    if (error) showToast('保存に失敗: ' + error.message);
  }
  async function saveCompanyForm(form) {
    if (!form.name.trim()) { showToast('企業名を入力'); return; }
    if (form.id) {
      const { id, ...patch } = form;
      await patchCompany(id, patch);
    } else {
      const row = { ...form, user_id: session.user.id, tasks: [], es_drafts: [] };
      const { data, error } = await supabase.from('companies').insert(row).select().single();
      if (error) { showToast('追加に失敗: ' + error.message); return; }
      setCompanies((cs) => [...cs, data]);
    }
    setModal(null);
  }
  async function deleteCompany(id) {
    if (!confirm('この企業を削除しますか？')) return;
    const { error } = await supabase.from('companies').delete().eq('id', id);
    if (error) { showToast('削除に失敗'); return; }
    setCompanies((cs) => cs.filter((c) => c.id !== id));
  }
  function addTask(c, label, date) {
    if (!date) { showToast('日付を選んで'); return; }
    patchCompany(c.id, { tasks: [...(c.tasks || []), { id: crypto.randomUUID(), label, date, done: false }] });
  }
  function removeTask(c, tid) { patchCompany(c.id, { tasks: (c.tasks || []).filter((t) => t.id !== tid) }); }
  function doneTask(c, tid) { patchCompany(c.id, { tasks: (c.tasks || []).map((t) => (t.id === tid ? { ...t, done: true } : t)) }); }

  async function saveDocs() {
    const { error } = await supabase.from('user_docs').upsert({ user_id: session.user.id, master_doc: docs.master_doc, profile: docs.profile, updated_at: new Date().toISOString() });
    showToast(error ? '保存に失敗' : '資料を保存しました');
  }

  // import / export
  function exportJson() {
    const payload = { companies: companies.map(({ user_id, ...c }) => c), docs };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jobhunt-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('書き出しました');
  }
  function importJson(file) {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const d = JSON.parse(r.result);
        if (!Array.isArray(d.companies)) throw 0;
        const rows = d.companies.map((c) => ({
          user_id: session.user.id,
          name: c.name,
          category: c.category || null,
          vote: c.vote || 'B',
          status: c.status || '検討中',
          mypage_url: c.mypage_url ?? c.mypageUrl ?? null,
          es_doc_url: c.es_doc_url ?? c.esDocUrl ?? null,
          memo: c.memo || null,
          tasks: c.tasks || [],
          es_drafts: c.es_drafts ?? c.esDrafts ?? [],
        }));
        const { data: inserted, error } = await supabase.from('companies').insert(rows).select();
        if (error) throw error;
        setCompanies((cs) => [...cs, ...(inserted || [])]);
        if (d.docs) { setDocs(d.docs); await supabase.from('user_docs').upsert({ user_id: session.user.id, master_doc: d.docs.master_doc || '', profile: d.docs.profile || '' }); }
        showToast(`${rows.length}社を読み込みました`);
      } catch (e) { showToast('読み込めませんでした: ' + (e.message || '')); }
    };
    r.readAsText(file);
  }

  if (session === undefined) return <div className="wrap"><p className="muted">読み込み中…</p></div>;
  if (!session) return null;

  const upcoming = companies
    .flatMap((c) => (c.tasks || []).filter((t) => !t.done && t.date).map((t) => ({ ...t, co: c.name, cid: c.id, diff: dayDiff(t.date) })))
    .filter((t) => t.diff !== null)
    .sort((a, b) => a.diff - b.diff);

  const nextDiff = (c) => { const ds = (c.tasks || []).filter((t) => !t.done && t.date).map((t) => dayDiff(t.date)).filter((d) => d !== null && d >= 0); return ds.length ? Math.min(...ds) : 9999; };
  let list = companies.filter((c) => (!filters.cat || c.category === filters.cat) && (!filters.status || c.status === filters.status));
  if (filters.sort === 'deadline') list = [...list].sort((a, b) => nextDiff(a) - nextDiff(b));
  else if (filters.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  else list = [...list].sort((a, b) => (a.vote || 'Z').localeCompare(b.vote || 'Z'));

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">
          <h1>就活ポータル</h1>
          <span className="sub">{session.user.email}</span>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={exportJson}>書き出し</button>
          <button className="btn" onClick={() => fileRef.current.click()}>読み込み</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
                 onChange={(e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; }} />
          <button className="btn primary" onClick={() => setModal({ ...blank })}>＋ 企業</button>
          <button className="btn" onClick={() => supabase.auth.signOut()}>ログアウト</button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'dash' ? 'on' : ''} onClick={() => setTab('dash')}>ダッシュボード</button>
        <button className={tab === 'es' ? 'on' : ''} onClick={() => setTab('es')}>ES作成</button>
        <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>資料</button>
        <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>履歴{logs.length ? ` (${logs.length})` : ''}</button>
      </div>

      {tab === 'dash' && (
        <>
          {upcoming.filter((t) => t.diff < 0).length > 0 && (
            <div className="overdue-banner">
              <strong>締切超過 {upcoming.filter((t) => t.diff < 0).length}件</strong>
              ：{upcoming.filter((t) => t.diff < 0).slice(0, 6).map((t) => `${t.co}「${t.label}」${-t.diff}日超過`).join(' / ')}
              <span className="muted">（完了済みにするか、状況を更新してください）</span>
            </div>
          )}
          <div className="hero">
            <div className="hero-label">次にやること（締切順）</div>
            <div className="rail">
              {upcoming.length === 0 && <div className="muted">未完了の締切タスクはありません。</div>}
              {upcoming.slice(0, 12).map((t) => {
                const [n, u] = countText(t.diff);
                return (
                  <div key={t.id} className={`ticket ${urgency(t.diff)}`}>
                    <div className="co">{t.co}</div>
                    <div className="task">{t.label}</div>
                    <div className="count"><span className="n">{n}</span><span className="u">{u}</span></div>
                    <div className="date">{new Date(t.date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</div>
                    <button className="linkbtn" onClick={() => doneTask(companies.find((c) => c.id === t.cid), t.id)}>完了にする</button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="filters">
            <select value={filters.cat} onChange={(e) => setFilters({ ...filters, cat: e.target.value })}>
              <option value="">全カテゴリ</option>{CATS.map((v) => <option key={v}>{v}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">全ステータス</option>{STATUSES.map((v) => <option key={v}>{v}</option>)}
            </select>
            <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
              <option value="deadline">直近の締切順</option>
              <option value="vote">志望度順</option>
              <option value="name">企業名順</option>
            </select>
            <span className="count-pill">{list.length} 社 / 全 {companies.length} 社</span>
          </div>

          {companies.length === 0 ? (
            <div className="emptystate">まだ企業がありません。「＋ 企業」か「読み込み」から。</div>
          ) : (
            <div className="cards">
              {list.map((c) => <CompanyCard key={c.id} c={c} onEdit={() => setModal({ ...c })} onDelete={() => deleteCompany(c.id)} onAddTask={addTask} onRemoveTask={removeTask} />)}
            </div>
          )}
        </>
      )}

      {tab === 'es' && <ESPanel companies={companies} onSaveDrafts={(cid, drafts) => patchCompany(cid, { es_drafts: drafts })} showToast={showToast} />}

      {tab === 'docs' && (
        <>
          <div className="note">ここに置いた資料は、ES生成時の文脈として渡されます。<strong>パスワード等の秘密情報は入れないでください。</strong></div>
          <div className="es-card" style={{ marginBottom: 16 }}>
            <h3>自己分析マスター資料</h3>
            <textarea className="es-out" style={{ minHeight: 200 }} value={docs.master_doc} onChange={(e) => setDocs({ ...docs, master_doc: e.target.value })} placeholder="自己分析マスター資料の本文を貼り付け" />
          </div>
          <div className="es-card" style={{ marginBottom: 16 }}>
            <h3>基本プロフィール</h3>
            <textarea className="es-out" style={{ minHeight: 120 }} value={docs.profile} onChange={(e) => setDocs({ ...docs, profile: e.target.value })} placeholder="氏名・学歴・スキルなどの台帳本文を貼り付け" />
          </div>
          <button className="btn primary" onClick={saveDocs}>資料を保存</button>
          <span className={`docs-status ${jpLen(docs.master_doc) ? 'set' : 'unset'}`}>
            {jpLen(docs.master_doc) ? `マスター ${jpLen(docs.master_doc)}字 / プロフィール ${jpLen(docs.profile)}字` : '未保存'}
          </span>
        </>
      )}

      {tab === 'log' && (
        <>
          <div className="note">Gmail同期や手動更新でステータス・締切・ESがどう変わったかの履歴です。<strong>これがAIの自動更新を確認する場所です（source=gmail はGmail同期、manual は手動、es はES保存）。</strong></div>
          {logs.length === 0 ? (
            <div className="emptystate">まだ履歴はありません。Gmail同期や手動更新を行うとここに記録されます。</div>
          ) : (
            <div className="logtable">
              {logs.map((r) => (
                <div key={r.id} className="logrow">
                  <span className="logtime">{new Date(r.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={`logsrc src-${r.source}`}>{r.source}</span>
                  <span className="logco">{r.company_name || '—'}</span>
                  <span className="logchg">
                    <span className="logfield">{r.field}</span>
                    {r.old_value ? <> {r.old_value} → </> : ' '}
                    <strong>{r.new_value}</strong>
                    {r.evidence && <span className="logev">«{r.evidence}»</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {modal && <CompanyModal form={modal} setForm={setModal} onSave={() => saveCompanyForm(modal)} onClose={() => setModal(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function CompanyCard({ c, onEdit, onDelete, onAddTask, onRemoveTask }) {
  const [label, setLabel] = useState(TASK_LABELS[0]);
  const [date, setDate] = useState('');
  const tasks = (c.tasks || []).slice().sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  return (
    <div className="card">
      <div className="row1">
        <div><h3 className="name">{c.name}</h3><div className="cat">{c.category}</div></div>
        <span className="vote">{c.vote || '-'}</span>
      </div>
      <span className={`status ${statusClass(c.status)}`}>{c.status || '検討中'}</span>
      <div className="tasks">
        {tasks.length === 0 && <div className="muted">締切タスクなし</div>}
        {tasks.map((t) => {
          const diff = dayDiff(t.date); const [n, u] = countText(diff);
          return (
            <div key={t.id} className={`trow ${t.done ? 'done' : urgency(diff)}`}>
              <span className="tdot" />
              <span className="tlabel">{t.label}{t.date ? ` ${t.date.slice(5).replace('-', '/')}` : ''}</span>
              <span className="tcount">{t.done ? '完了' : (diff !== null ? n + u : '')}</span>
              <button className="tx" onClick={() => onRemoveTask(c, t.id)}>✕</button>
            </div>
          );
        })}
      </div>
      <div className="add-task-mini">
        <select value={label} onChange={(e) => setLabel(e.target.value)}>{TASK_LABELS.map((l) => <option key={l}>{l}</option>)}</select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn" style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => { onAddTask(c, label, date); setDate(''); }}>＋</button>
      </div>
      {(c.mypage_url || c.es_doc_url) && (
        <div className="links">
          {c.mypage_url && <a href={c.mypage_url} target="_blank" rel="noopener noreferrer">マイページ ↗</a>}
          {c.es_doc_url && <a href={c.es_doc_url} target="_blank" rel="noopener noreferrer">ES下書き ↗</a>}
        </div>
      )}
      {(c.es_drafts || []).length > 0 && <div className="es-tag">保存済みES {(c.es_drafts || []).length}件</div>}
      {c.memo && <div className="memo">{c.memo}</div>}
      <div className="actions"><button onClick={onEdit}>編集</button><button onClick={onDelete}>削除</button></div>
    </div>
  );
}

function CompanyModal({ form, setForm, onSave, onClose }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="scrim" onClick={(e) => e.target.classList.contains('scrim') && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{form.id ? '企業を編集' : '企業を追加'}</h2>
        <div className="field"><label>企業名</label><input value={form.name} onChange={set('name')} autoFocus /></div>
        <div className="field two">
          <div><label>カテゴリ</label><select value={form.category || CATS[0]} onChange={set('category')}>{CATS.map((v) => <option key={v}>{v}</option>)}</select></div>
          <div><label>志望度</label><select value={form.vote || 'B'} onChange={set('vote')}><option>A</option><option>B</option><option>C</option></select></div>
        </div>
        <div className="field"><label>選考ステータス</label><select value={form.status || '検討中'} onChange={set('status')}>{STATUSES.map((v) => <option key={v}>{v}</option>)}</select></div>
        <div className="field"><label>マイページ URL</label><input value={form.mypage_url || ''} onChange={set('mypage_url')} placeholder="https://..." /></div>
        <div className="field"><label>ES下書きリンク</label><input value={form.es_doc_url || ''} onChange={set('es_doc_url')} placeholder="https://..." /></div>
        <div className="field"><label>メモ</label><textarea value={form.memo || ''} onChange={set('memo')} /></div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button className="btn primary" onClick={onSave}>保存</button>
        </div>
      </div>
    </div>
  );
}

function ESPanel({ companies, onSaveDrafts, showToast }) {
  const [companyId, setCompanyId] = useState('');
  const co = companies.find((c) => c.id === companyId);
  const drafts = co?.es_drafts || [];

  function updateDraft(i, text) {
    const next = drafts.map((d, j) => (j === i ? { ...d, text, savedAt: new Date().toISOString() } : d));
    onSaveDrafts(companyId, next);
    showToast('保存しました');
  }
  function removeDraft(i) {
    if (!confirm('この下書きを削除しますか？')) return;
    onSaveDrafts(companyId, drafts.filter((_, j) => j !== i));
  }

  return (
    <>
      <div className="note">
        ES下書きの<strong>生成は Claude Code（サブスク）が行います</strong>（API課金なし）。Claude に
        <code> tools/playbooks/es-generate.md </code>を渡し「○○社の設問〜を書いて」と頼むと、台帳・マスター資料を文脈にルール適用で下書きし、
        <code> jobctl save-es </code>でここに保存されます。<strong>このタブは保存された下書きを確認・微修正する場所です。</strong>
      </div>
      <div className="es-card" style={{ marginBottom: 16 }}>
        <div className="field"><label>企業</label>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">（企業を選択）</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}（ES {(c.es_drafts || []).length}件）</option>)}
          </select>
        </div>
      </div>
      {!companyId ? (
        <div className="emptystate">企業を選ぶと、保存済みのES下書きが表示されます。</div>
      ) : drafts.length === 0 ? (
        <div className="emptystate">{co.name} の保存済みESはまだありません。Claude Code で生成すると、ここに入ります。</div>
      ) : (
        drafts.map((d, i) => <ESDraft key={d.id || i} draft={d} onSave={(t) => updateDraft(i, t)} onRemove={() => removeDraft(i)} />)
      )}
    </>
  );
}

function ESDraft({ draft, onSave, onRemove }) {
  const [val, setVal] = useState(draft.text || '');
  const limit = draft.limit || 0;
  const len = jpLen(val);
  const target = limit ? Math.round(limit * 0.9) : 0;
  const cls = limit && len > limit ? 'hi' : (limit && len / limit >= 0.85 ? 'ok' : 'lo');
  return (
    <div className="es-card" style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{draft.question || '（設問未記録）'}</h3>
      <textarea className="es-out" value={val} onChange={(e) => setVal(e.target.value)} />
      <div className="charbar">
        <span>{limit ? <><span className={cls}>{len}</span> / {limit}（目標 {target}）</> : `${len}字`}{draft.savedAt ? ` ・ ${new Date(draft.savedAt).toLocaleDateString('ja-JP')}` : ''}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onSave(val)}>保存</button>
          <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onRemove}>削除</button>
        </span>
      </div>
    </div>
  );
}
