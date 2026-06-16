'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

const CATS = ['大手SIer', '金融IT子会社', 'AI・Web系', '事業会社（内製）', '非IT', 'その他'];
const STATUSES = ['検討中', 'エントリー済', 'ES提出', 'Webテスト', '一次面接', '二次面接', '最終面接', '内定', '見送り'];
const LIVE = new Set(['エントリー済', 'ES提出', 'Webテスト', '一次面接', '二次面接', '最終面接']);
const TASK_LABELS = ['ES締切', 'Webテスト', '説明会', '一次面接', '二次面接', '最終面接', '面談'];
const OTHER_LABEL = 'その他（自由入力）';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const jpLen = (s) => [...(s || '')].length;
function dayDiff(d) { if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(d + 'T00:00:00') - t) / 86400000); }
function urgency(x) { if (x === null) return ''; if (x < 0) return 'over'; if (x <= 3) return 'urgent'; if (x <= 7) return 'warn'; return ''; }
function countText(x) { if (x === null) return ['—', '']; if (x < 0) return [String(-x), '日超過']; if (x === 0) return ['今日', '']; return [String(x), '日後']; }
function statusClass(s) { if (s === '内定') return 'win'; if (s === '見送り') return 'lose'; if (LIVE.has(s)) return 'live'; return ''; }
const blank = { name: '', category: CATS[0], vote: 'B', status: '検討中', mypage_url: '', es_doc_url: '', login_id: '', links: [], memo: '' };
// 締切タスクの日時表示。時刻未設定（=23:59）は日付のみ、明示時刻のときだけ時刻を出す。
function fmtWhen(t) {
  if (!t.date) return '';
  const md = t.date.slice(5).replace('-', '/');
  return (t.time && t.time !== '23:59') ? `${md} ${t.time}` : md;
}

export default function Portal() {
  const router = useRouter();
  const [session, setSession] = useState(undefined);
  const [companies, setCompanies] = useState([]);
  const [docs, setDocs] = useState({ master_doc: '', profile: '' });
  const [logs, setLogs] = useState([]);
  const [tab, setTab] = useState('dash');
  const [filters, setFilters] = useState({ cat: '', status: '', sort: 'deadline' });
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [quickName, setQuickName] = useState('');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null); // { msg, actionLabel?, action? }
  const fileRef = useRef(null);

  const showToast = useCallback((m) => { setToast({ msg: m }); setTimeout(() => setToast((t) => (t && t.msg === m ? null : t)), 2300); }, []);

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

  // 手動のステータス変更も履歴に残す（AIの自動更新と同じ場所で追える）
  async function setStatus(id, status) {
    const c = companies.find((x) => x.id === id);
    if (!c || c.status === status) return;
    await patchCompany(id, { status });
    const row = { user_id: session.user.id, company_id: id, company_name: c.name, field: 'status', old_value: c.status, new_value: status, source: 'manual' };
    await supabase.from('status_log').insert(row);
    setLogs((prev) => [{ ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...prev]);
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

  async function quickAdd() {
    const name = quickName.trim();
    if (!name) return;
    const row = { user_id: session.user.id, name, category: CATS[0], vote: 'B', status: '検討中', tasks: [], es_drafts: [] };
    const { data, error } = await supabase.from('companies').insert(row).select().single();
    if (error) { showToast('追加に失敗: ' + error.message); return; }
    setCompanies((cs) => [...cs, data]);
    setQuickName('');
    showToast(`${name} を追加`);
  }

  // 削除は確認ダイアログではなく Undo 方式（誤操作してもすぐ戻せる）
  async function deleteCompanies(ids) {
    if (ids.length === 0) return;
    const rows = companies.filter((c) => ids.includes(c.id));
    const { error } = await supabase.from('companies').delete().in('id', ids);
    if (error) { showToast('削除に失敗: ' + error.message); return; }
    setCompanies((cs) => cs.filter((c) => !ids.includes(c.id)));
    setSelected(new Set());
    const msg = `${ids.length}社を削除`;
    setToast({
      msg,
      actionLabel: '元に戻す',
      action: async () => {
        const { data, error: e2 } = await supabase.from('companies').insert(rows).select();
        if (e2) { showToast('復元に失敗: ' + e2.message); return; }
        setCompanies((cs) => [...cs, ...(data || [])]);
        setToast(null);
      },
    });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 6000);
  }

  function toggleSelect(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function addTask(c, label, date, time) {
    if (!date) { showToast('日付を選んで'); return; }
    // 時刻未設定はその日の締切として 23:59 に丸める
    const task = { id: crypto.randomUUID(), label, date, time: time || '23:59', done: false };
    patchCompany(c.id, { tasks: [...(c.tasks || []), task] });
  }
  function updateTask(c, tid, patch) {
    patchCompany(c.id, { tasks: (c.tasks || []).map((t) => (t.id === tid ? { ...t, ...patch } : t)) });
  }
  function removeTask(c, tid) { patchCompany(c.id, { tasks: (c.tasks || []).filter((t) => t.id !== tid) }); }
  // 完了 ↔ 未完了 をトグル（誤クリックしても再クリックで戻せる）
  function toggleTask(c, tid) { patchCompany(c.id, { tasks: (c.tasks || []).map((t) => (t.id === tid ? { ...t, done: !t.done } : t)) }); }

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
          login_id: c.login_id ?? c.loginId ?? null,
          links: c.links || [],
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
  let list = companies.filter((c) =>
    (!filters.cat || c.category === filters.cat) &&
    (!filters.status || c.status === filters.status) &&
    (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())));
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
          <div className="quick-add">
            <input value={quickName} onChange={(e) => setQuickName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && quickAdd()} placeholder="社名を入力して Enter で追加" />
            <button className="btn primary" onClick={quickAdd}>＋</button>
          </div>
          <button className="btn" onClick={exportJson}>書き出し</button>
          <button className="btn" onClick={() => fileRef.current.click()}>読み込み</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
                 onChange={(e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; }} />
          <button className="btn" onClick={() => supabase.auth.signOut()}>ログアウト</button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'dash' ? 'on' : ''} onClick={() => setTab('dash')}>ダッシュボード</button>
        <button className={tab === 'calendar' ? 'on' : ''} onClick={() => setTab('calendar')}>カレンダー</button>
        <button className={tab === 'kanban' ? 'on' : ''} onClick={() => setTab('kanban')}>カンバン</button>
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

          <FunnelStats companies={companies} onPick={(s) => setFilters({ ...filters, status: filters.status === s ? '' : s })} active={filters.status} />

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
                    <button className="linkbtn" onClick={() => toggleTask(companies.find((c) => c.id === t.cid), t.id)}>完了にする</button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="filters">
            <input className="searchbox" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 企業名で検索" />
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
            <div className="emptystate">まだ企業がありません。上の入力欄か「読み込み」から。</div>
          ) : (
            <div className="cards">
              {list.map((c) => (
                <CompanyCard key={c.id} c={c}
                  selected={selected.has(c.id)} onToggleSelect={() => toggleSelect(c.id)}
                  onStatus={(s) => setStatus(c.id, s)}
                  onEdit={() => setModal({ ...c })} onDelete={() => deleteCompanies([c.id])}
                  onAddTask={addTask} onRemoveTask={removeTask} onToggleTask={toggleTask} onUpdateTask={updateTask} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'calendar' && <CalendarView companies={companies} onToggle={toggleTask} />}

      {tab === 'kanban' && <KanbanView companies={companies} onStatus={setStatus} />}

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
            <textarea className="es-out" style={{ minHeight: 120 }} value={docs.profile} onChange={(e) => setDocs({ ...docs, profile: e.target.value })} placeholder="氏名・学歴・スキルなどの台帳本文を貼り付け（tools/sync-profile.mjs で台帳から自動同期も可）" />
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

      {selected.size > 0 && (
        <div className="bulkbar">
          <span>{selected.size}社を選択中</span>
          <button className="btn" onClick={() => setSelected(new Set())}>選択解除</button>
          <button className="btn danger" onClick={() => deleteCompanies([...selected])}>まとめて削除</button>
        </div>
      )}

      {modal && <CompanyModal form={modal} setForm={setModal} onSave={() => saveCompanyForm(modal)} onClose={() => setModal(null)} />}
      {toast && (
        <div className="toast">
          {toast.msg}
          {toast.action && <button className="toast-action" onClick={toast.action}>{toast.actionLabel}</button>}
        </div>
      )}
    </div>
  );
}

function FunnelStats({ companies, onPick, active }) {
  if (companies.length === 0) return null;
  const counts = STATUSES.map((s) => [s, companies.filter((c) => c.status === s).length]);
  return (
    <div className="stats">
      {counts.map(([s, n]) => (
        <button key={s} className={`statchip ${statusClass(s)} ${active === s ? 'on' : ''}`} onClick={() => onPick(s)} disabled={n === 0}>
          <span className="statn">{n}</span><span className="stats-label">{s}</span>
        </button>
      ))}
    </div>
  );
}

function TaskRow({ c, t, onToggle, onRemove, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const preset = TASK_LABELS.includes(t.label);
  const [label, setLabel] = useState(preset ? t.label : OTHER_LABEL);
  const [custom, setCustom] = useState(preset ? '' : t.label);
  const [date, setDate] = useState(t.date || '');
  const [time, setTime] = useState(t.time && t.time !== '23:59' ? t.time : '');

  function startEdit() {
    setLabel(preset ? t.label : OTHER_LABEL);
    setCustom(preset ? '' : t.label);
    setDate(t.date || '');
    setTime(t.time && t.time !== '23:59' ? t.time : '');
    setEditing(true);
  }
  function save() {
    const lab = label === OTHER_LABEL ? custom.trim() : label;
    if (!lab || !date) return;
    onUpdate(c, t.id, { label: lab, date, time: time || '23:59' });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="trow editing">
        <select value={label} onChange={(e) => setLabel(e.target.value)}>
          {TASK_LABELS.map((l) => <option key={l}>{l}</option>)}
          <option value={OTHER_LABEL}>{OTHER_LABEL}</option>
        </select>
        {label === OTHER_LABEL && <input type="text" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="種別" />}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title="時刻（任意・空なら23:59）" />
        <button className="tsave" onClick={save} title="保存">保存</button>
        <button className="tx" onClick={() => setEditing(false)} title="キャンセル">✕</button>
      </div>
    );
  }

  const diff = dayDiff(t.date); const [n, u] = countText(diff);
  return (
    <div className={`trow ${t.done ? 'done' : urgency(diff)}`}>
      <span className="tdot" />
      <span className="tlabel">{t.label}{t.date ? ` ${fmtWhen(t)}` : ''}</span>
      <button className="tedit" onClick={startEdit} title="編集">✎</button>
      <button className="tdone" onClick={() => onToggle(c, t.id)} title={t.done ? '未完了に戻す' : '完了にする'}>{t.done ? '↩' : '✓'}</button>
      <span className="tcount">{t.done ? '完了' : (diff !== null ? n + u : '')}</span>
      <button className="tx" onClick={() => onRemove(c, t.id)}>✕</button>
    </div>
  );
}

function CompanyCard({ c, selected, onToggleSelect, onStatus, onEdit, onDelete, onAddTask, onRemoveTask, onToggleTask, onUpdateTask }) {
  const [label, setLabel] = useState(TASK_LABELS[0]);
  const [custom, setCustom] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const tasks = (c.tasks || []).slice().sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  return (
    <div className={`card ${selected ? 'sel' : ''}`}>
      <div className="row1">
        <div className="row1-left">
          <input type="checkbox" className="card-check" checked={selected} onChange={onToggleSelect} title="選択（一括削除用）" />
          <div><h3 className="name">{c.name}</h3><div className="cat">{c.category}</div></div>
        </div>
        <span className="vote">{c.vote || '-'}</span>
      </div>
      <select className={`status-select ${statusClass(c.status)}`} value={c.status || '検討中'} onChange={(e) => onStatus(e.target.value)}>
        {STATUSES.map((s) => <option key={s}>{s}</option>)}
      </select>
      <div className="tasks">
        {tasks.length === 0 && <div className="muted">締切タスクなし</div>}
        {tasks.map((t) => (
          <TaskRow key={t.id} c={c} t={t} onToggle={onToggleTask} onRemove={onRemoveTask} onUpdate={onUpdateTask} />
        ))}
      </div>
      <div className="add-task-mini">
        <select value={label} onChange={(e) => setLabel(e.target.value)}>
          {TASK_LABELS.map((l) => <option key={l}>{l}</option>)}
          <option value={OTHER_LABEL}>{OTHER_LABEL}</option>
        </select>
        {label === OTHER_LABEL && <input type="text" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="種別を入力" autoFocus />}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title="時刻（任意）" />
        <button className="btn" style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => {
          const lab = label === OTHER_LABEL ? custom.trim() : label;
          if (!lab) return;
          onAddTask(c, lab, date, time);
          setDate(''); setTime(''); setCustom(''); if (label === OTHER_LABEL) setLabel(TASK_LABELS[0]);
        }}>＋</button>
      </div>
      {(c.mypage_url || c.es_doc_url || (c.links || []).length > 0) && (
        <div className="links">
          {c.mypage_url && <a href={c.mypage_url} target="_blank" rel="noopener noreferrer">マイページ ↗</a>}
          {c.es_doc_url && <a href={c.es_doc_url} target="_blank" rel="noopener noreferrer">ES下書き ↗</a>}
          {(c.links || []).map((l, i) => l.url && <a key={i} href={l.url} target="_blank" rel="noopener noreferrer">{l.label || 'リンク'} ↗</a>)}
        </div>
      )}
      {c.login_id && (
        <div className="login-id">
          <span className="li-key">ID</span>
          <span className="li-val">{c.login_id}</span>
          <button className="li-copy" title="コピー" onClick={() => { navigator.clipboard?.writeText(c.login_id); }}>⧉</button>
        </div>
      )}
      {(c.es_drafts || []).length > 0 && <div className="es-tag">保存済みES {(c.es_drafts || []).length}件</div>}
      {c.memo && <div className="memo">{c.memo}</div>}
      <div className="actions"><button onClick={onEdit}>編集</button><button onClick={onDelete}>削除</button></div>
    </div>
  );
}

function CalendarView({ companies, onToggle }) {
  const today = new Date();
  const [cur, setCur] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const byDate = {};
  companies.forEach((c) => (c.tasks || []).forEach((t) => { if (t.date) (byDate[t.date] = byDate[t.date] || []).push({ ...t, co: c.name, cid: c.id }); }));

  const first = new Date(cur.y, cur.m, 1);
  const startDow = first.getDay();
  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const ymd = (d) => `${cur.y}-${String(cur.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const shift = (n) => { let m = cur.m + n, y = cur.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } setCur({ y, m }); };

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="btn" onClick={() => shift(-1)}>‹ 前月</button>
        <strong>{cur.y}年 {cur.m + 1}月</strong>
        <button className="btn" onClick={() => shift(1)}>翌月 ›</button>
        <button className="btn" onClick={() => setCur({ y: today.getFullYear(), m: today.getMonth() })}>今日</button>
      </div>
      <div className="cal-grid cal-dow">{WEEKDAYS.map((w, i) => <div key={w} className={`cal-dowcell ${i === 0 ? 'sun' : ''} ${i === 6 ? 'sat' : ''}`}>{w}</div>)}</div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="cal-cell empty" />;
          const key = ymd(d);
          const items = (byDate[key] || []).slice().sort((a, b) => Number(a.done) - Number(b.done));
          const dow = (startDow + d - 1) % 7;
          return (
            <div key={i} className={`cal-cell ${key === todayStr ? 'today' : ''}`}>
              <div className={`cal-day ${dow === 0 ? 'sun' : ''} ${dow === 6 ? 'sat' : ''}`}>{d}</div>
              {items.map((t) => {
                const diff = dayDiff(t.date);
                return (
                  <div key={t.id} className={`cal-chip ${t.done ? 'done' : urgency(diff)}`} title={`${t.co} ${t.label}（クリックで完了/未完了）`}
                       onClick={() => onToggle(companies.find((c) => c.id === t.cid), t.id)}>
                    {t.time && t.time !== '23:59' && <span className="cal-chip-time">{t.time}</span>}<span className="cal-chip-co">{t.co}</span> {t.label}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ marginTop: 10 }}>チップをクリックで完了/未完了を切り替え（誤クリックも再クリックで戻せます）。色：<span className="legend over">超過</span> <span className="legend urgent">3日内</span> <span className="legend warn">7日内</span></div>
    </div>
  );
}

function KanbanView({ companies, onStatus }) {
  const [drag, setDrag] = useState(null);
  return (
    <div className="kanban">
      {STATUSES.map((s) => {
        const cs = companies.filter((c) => (c.status || '検討中') === s);
        return (
          <div key={s} className={`kcol ${drag ? 'droppable' : ''}`}
               onDragOver={(e) => e.preventDefault()}
               onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('id'); setDrag(null); if (id) onStatus(id, s); }}>
            <div className={`kcol-h ${statusClass(s)}`}>{s}<span className="kcount">{cs.length}</span></div>
            {cs.map((c) => (
              <div key={c.id} className="kcard" draggable
                   onDragStart={(e) => { e.dataTransfer.setData('id', c.id); setDrag(c.id); }}
                   onDragEnd={() => setDrag(null)}>
                <span className="kvote">{c.vote || '-'}</span>
                <span className="kname">{c.name}</span>
              </div>
            ))}
            {cs.length === 0 && <div className="kempty">—</div>}
          </div>
        );
      })}
    </div>
  );
}

function ESPanel({ companies, onSaveDrafts, showToast }) {
  const [mode, setMode] = useState('company');
  const totalDrafts = companies.reduce((n, c) => n + (c.es_drafts || []).length, 0);
  return (
    <>
      <div className="note">
        ES下書きの<strong>生成は Claude Code（サブスク）が行います</strong>（API課金なし）。Claude に
        <code> tools/playbooks/es-generate.md </code>を渡し「○○社の設問〜を書いて」と頼むと、台帳・マスター資料を文脈にルール適用で下書きし、
        <code> jobctl save-es </code>でここに保存されます。<strong>「設問別」タブで過去ESを設問ごとに横断参照すれば、似た設問は生成し直さず流用でき、トークンを節約できます。</strong>
      </div>
      <div className="es-modeswitch">
        <button className={mode === 'company' ? 'on' : ''} onClick={() => setMode('company')}>企業別</button>
        <button className={mode === 'question' ? 'on' : ''} onClick={() => setMode('question')}>設問別（横断）{totalDrafts ? ` ・ 全${totalDrafts}件` : ''}</button>
      </div>
      {mode === 'company'
        ? <ESByCompany companies={companies} onSaveDrafts={onSaveDrafts} showToast={showToast} />
        : <ESByQuestion companies={companies} showToast={showToast} />}
    </>
  );
}

function ESByCompany({ companies, onSaveDrafts, showToast }) {
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

// 設問別の横断ビュー：全企業のESを設問でグルーピングし、検索・コピーで再利用しやすくする
function ESByQuestion({ companies, showToast }) {
  const [query, setQuery] = useState('');
  const all = companies.flatMap((c) => (c.es_drafts || []).map((d) => ({ ...d, company: c.name })));
  const q = query.trim().toLowerCase();
  const filtered = q ? all.filter((d) => (d.question || '').toLowerCase().includes(q) || (d.text || '').toLowerCase().includes(q)) : all;

  const groups = {};
  filtered.forEach((d) => { const k = (d.question || '（設問未記録）').trim(); (groups[k] = groups[k] || []).push(d); });
  const ordered = Object.entries(groups).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'));

  function copy(text) { navigator.clipboard?.writeText(text); showToast('本文をコピーしました'); }

  if (all.length === 0) return <div className="emptystate">保存済みのESがまだありません。Claude Code で生成すると、ここに設問別で集まります。</div>;

  return (
    <>
      <input className="searchbox" style={{ width: '100%', marginBottom: 14 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 設問・本文で検索（例: ガクチカ / 志望動機）" />
      {ordered.length === 0 ? (
        <div className="emptystate">「{query}」に一致するESはありません。</div>
      ) : ordered.map(([question, items]) => (
        <div key={question} className="es-qgroup">
          <h3 className="es-q">{question}<span className="es-qn">{items.length}件</span></h3>
          {items.map((d, i) => (
            <div key={d.id || i} className="es-pastitem">
              <div className="es-pasthead">
                <span className="es-pastco">{d.company}</span>
                <span className="muted">{jpLen(d.text)}字{d.limit ? ` / ${d.limit}` : ''}{d.savedAt ? ` ・ ${new Date(d.savedAt).toLocaleDateString('ja-JP')}` : ''}</span>
                <button className="btn" style={{ padding: '3px 10px', fontSize: 12, marginLeft: 'auto' }} onClick={() => copy(d.text)}>本文コピー</button>
              </div>
              <div className="es-pasttext">{d.text}</div>
            </div>
          ))}
        </div>
      ))}
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

function CompanyModal({ form, setForm, onSave, onClose }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const links = form.links || [];
  const setLink = (i, k, v) => setForm({ ...form, links: links.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const addLink = () => setForm({ ...form, links: [...links, { label: '', url: '' }] });
  const removeLink = (i) => setForm({ ...form, links: links.filter((_, j) => j !== i) });
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
        <div className="field">
          <label>ログインID（パスワードは入れない）</label>
          <input value={form.login_id || ''} onChange={set('login_id')} placeholder="例: katsurayamajob@gmail.com / 会員番号など" />
        </div>
        <div className="field">
          <label>任意リンク（見返したいページなど）</label>
          {links.map((l, i) => (
            <div className="link-row" key={i}>
              <input value={l.label || ''} onChange={(e) => setLink(i, 'label', e.target.value)} placeholder="ラベル（例: 説明会資料）" />
              <input value={l.url || ''} onChange={(e) => setLink(i, 'url', e.target.value)} placeholder="https://..." />
              <button className="btn" type="button" onClick={() => removeLink(i)}>✕</button>
            </div>
          ))}
          <button className="btn" type="button" onClick={addLink} style={{ fontSize: 12, padding: '5px 10px' }}>＋ リンクを追加</button>
        </div>
        <div className="field"><label>メモ</label><textarea value={form.memo || ''} onChange={set('memo')} /></div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button className="btn primary" onClick={onSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
