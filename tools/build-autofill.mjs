// profile-daicho.md → フォーム自動入力スクリプトを生成する。
// 生成物（public/ に出力。ポータルから配信され、いつでも入れ直せる）:
//   - public/jobhunt-autofill.user.js  … Tampermonkey 等に入れる userscript（推奨・常駐）
//   - public/jobhunt-autofill-bookmarklet.txt … ブックマークに登録する javascript: URL（インストール不要）
//   - public/jobhunt-autofill-dict.json … 確認用の素の辞書
//
// 仕組み: 台帳から「ラベル→値」を抽出し、各フォーム欄のラベル文字列に対して
// シノニム部分一致でマッピング。ランニングのトークンは一切かからない（完全機械処理）。
// 新しい設問が増えたら台帳に追記 → このスクリプトを再実行するだけ。
//
// 使い方: node tools/build-autofill.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILE_PATH, ROOT } from './env.mjs';

// 1) 台帳をパースして「台帳ラベル → 値」を作る。
//    〔　〕（中身が空白だけ）は未記入 → 飛ばす。〔値〕は中身を採用。
function parseDaicho(md) {
  const map = {};
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*([^:：]+)[:：]\s*(.*)$/);
    if (!m) continue;
    let key = m[1].trim();
    let val = m[2].trim();
    // 末尾の注記を除去
    val = val.replace(/※要確認.*$/, '').trim();
    // 〔...〕 を剥がす
    const bm = val.match(/〔([\s\S]*)〕/);
    if (bm) val = bm[1];
    val = val.replace(/[　\s]+/g, ' ').trim();
    if (!val) continue; // 空欄はスキップ
    // ラベルの括弧注記（漢字）（フリガナ）等は残す（後で識別に使う）
    map[key] = val;
  }
  return map;
}

// 2) フォーム欄の識別子（label / name / id / placeholder / aria-label）に現れる語 → 台帳の値。
//    値は台帳ラベルから引く。台帳に無ければそのフィールドは生成しない（＝勝手に推測しない）。
const SPECS = [
  { daicho: '氏名（漢字）',        syn: ['氏名', '名前', 'お名前', 'fullname', 'full name', '姓名'] , exclude:['フリガナ','カナ','ローマ','ふりがな','kana','英'] },
  { daicho: '氏名（フリガナ）',    syn: ['フリガナ', 'カナ', 'カタカナ', 'kana'] },
  { daicho: '氏名（ローマ字）',    syn: ['ローマ字', 'roma', 'alphabet', '英字氏名', '氏名（英'] },
  { daicho: '生年月日',            syn: ['生年月日', '誕生日', 'birth', 'birthday', 'dob'] },
  { daicho: '性別',                syn: ['性別', 'gender', 'sex'] },
  { daicho: '国籍',                syn: ['国籍', 'nationality'] },
  { daicho: 'メールアドレス（就活用）', syn: ['メール', 'mail', 'email', 'e-mail', '連絡先メール'] },
  { daicho: '電話番号（携帯）',    syn: ['電話', '携帯', 'tel', 'phone', 'mobile'] },
  { daicho: '郵便番号',            syn: ['郵便', 'zip', 'postal', '〒'] },
  { daicho: '現住所（都道府県）',  syn: ['都道府県', 'prefecture', 'pref'] },
  { daicho: '現住所（市区町村以降）', syn: ['市区町村', '住所', 'address', '番地'], exclude:['都道府県','建物','部屋','帰省','メール'] },
  { daicho: '建物名・部屋番号',    syn: ['建物', '部屋番号', 'マンション', 'building'] },
  { daicho: '大学院名',            syn: ['大学院名', '研究科', '大学院（'] , exclude:['学部','高校','研究科名なし'] },
  { daicho: '研究科',              syn: ['研究科', 'graduate school'] },
  { daicho: '専攻・コース',        syn: ['専攻', 'コース', 'major'] },
  { daicho: '大学名',              syn: ['大学名', '学校名', 'university', '在籍校'], exclude:['大学院','高校','研究科'] },
  { daicho: '学部',                syn: ['学部', 'faculty'] , exclude:['学部生でない']},
  { daicho: '学科',                syn: ['学科', 'department'] },
  { daicho: '高校名',              syn: ['高校', '高等学校', 'high school'] },
  { daicho: '研究室・ゼミ名',      syn: ['研究室', 'ゼミ', 'lab', '所属研究室'] },
  { daicho: '指導教員',            syn: ['指導教員', '指導教官', '担当教員'] },
  { daicho: '研究テーマ',          syn: ['研究テーマ', '研究内容', '研究課題'] },
  { daicho: 'プログラミング言語',  syn: ['プログラミング', '言語', 'スキル', 'skill'] },
  { daicho: '志望業界',            syn: ['志望業界', '希望業界', '業界'] },
  { daicho: '希望職種',            syn: ['希望職種', '志望職種', '職種'] },
  { daicho: '希望勤務地',          syn: ['希望勤務地', '勤務地'] },
  { daicho: '運転免許',            syn: ['運転免許', '免許'] },
];

const md = readFileSync(PROFILE_PATH, 'utf8');
const map = parseDaicho(md);

// 値が台帳にあるものだけを採用
const dict = [];
for (const s of SPECS) {
  const value = map[s.daicho];
  if (value === undefined) continue;
  dict.push({ value, syn: s.syn.map((x) => x.toLowerCase()), exclude: (s.exclude || []).map((x) => x.toLowerCase()), label: s.daicho });
}

const skipped = SPECS.filter((s) => map[s.daicho] === undefined).map((s) => s.daicho);

// 3) ブラウザ側ランタイム（userscript と bookmarklet で共有）。
function runtimeSource() {
  return `(function(){
  var DICT = __DICT__;
  function norm(s){ return (s||'').toLowerCase().replace(/[\\s\\u3000:：・（）()\\[\\]【】<>＜＞*＊]/g,''); }
  function labelText(el){
    var t='';
    if(el.id){ var lb=document.querySelector('label[for="'+CSS.escape(el.id)+'"]'); if(lb)t+=' '+lb.textContent; }
    var p=el.closest('label'); if(p)t+=' '+p.textContent;
    // 直近の見出し的テキスト（th, dt, 直前要素）
    var row=el.closest('tr,li,div,dd,p'); if(row){ var th=row.previousElementSibling; if(th)t+=' '+th.textContent; var thc=row.querySelector('th,dt,legend,.label'); if(thc)t+=' '+thc.textContent; }
    t+=' '+(el.name||'')+' '+(el.id||'')+' '+(el.placeholder||'')+' '+(el.getAttribute('aria-label')||'');
    return norm(t).slice(0,120);
  }
  function setVal(el,val){
    var proto = el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;
    var setter=Object.getOwnPropertyDescriptor(proto,'value').set; setter.call(el,val);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.style.outline='2px solid #2E3A8C'; el.style.outlineOffset='1px';
  }
  function fillSelect(el,val){
    var nv=norm(val); var opts=[].slice.call(el.options), best=null;
    for(var i=0;i<opts.length;i++){ var on=norm(opts[i].textContent); if(on&&(on===nv||on.indexOf(nv)>=0||nv.indexOf(on)>=0)){ best=opts[i]; break; } }
    if(best){ el.value=best.value; el.dispatchEvent(new Event('change',{bubbles:true})); el.style.outline='2px solid #2E3A8C'; return true; }
    return false;
  }
  function matchSpec(lt,d){
    for(var j=0;j<d.exclude.length;j++){ if(lt.indexOf(norm(d.exclude[j]))>=0) return false; }
    for(var k=0;k<d.syn.length;k++){ if(lt.indexOf(norm(d.syn[k]))>=0) return true; }
    return false;
  }
  var fields=[].slice.call(document.querySelectorAll('input,select,textarea'));
  var filled=0, used={};
  fields.forEach(function(el){
    var type=(el.type||'').toLowerCase();
    if(['hidden','password','submit','button','file','image','reset','checkbox'].indexOf(type)>=0) return;
    if(el.disabled||el.readOnly) return;
    if(el.tagName!=='SELECT' && el.value && el.value.trim()) return; // 既入力は触らない
    var lt=labelText(el);
    for(var i=0;i<DICT.length;i++){
      var d=DICT[i]; if(used[d.label]&&type!=='radio') continue;
      if(!matchSpec(lt,d)) continue;
      if(type==='radio'){
        var rn=norm(el.value+' '+lt);
        if(rn.indexOf(norm(d.value))>=0||norm(d.value).indexOf(norm(el.value))>=0){ el.checked=true; el.dispatchEvent(new Event('change',{bubbles:true})); el.style.outline='2px solid #2E3A8C'; filled++; used[d.label]=1; }
        break;
      }
      if(el.tagName==='SELECT'){ if(fillSelect(el,d.value)){ filled++; used[d.label]=1; } break; }
      setVal(el,d.value); filled++; used[d.label]=1; break;
    }
  });
  var unmatched=DICT.filter(function(d){return !used[d.label];}).map(function(d){return d.label;});
  showPanel(filled, unmatched);
  function showPanel(n, un){
    var id='jh-autofill-panel'; var old=document.getElementById(id); if(old)old.remove();
    var box=document.createElement('div'); box.id=id;
    box.style.cssText='position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:300px;background:#1A1D24;color:#fff;font:13px/1.6 system-ui,sans-serif;padding:12px 14px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.3)';
    box.innerHTML='<b>台帳入力: '+n+'項目に下書き</b><br><span style="color:#9AA0B0;font-size:11px">送信前に必ず内容を確認してください。'+(un.length?'<br>台帳にあるが未入力: '+un.join('、'):'')+'</span><br><button id="jh-x" style="margin-top:8px;background:#2E3A8C;color:#fff;border:0;padding:5px 12px;border-radius:6px;cursor:pointer">閉じる</button>';
    document.body.appendChild(box);
    document.getElementById('jh-x').onclick=function(){box.remove();};
  }
})();`;
}

const dictJson = JSON.stringify(dict);
const runtime = runtimeSource().replace('__DICT__', dictJson);

const outDir = join(ROOT, 'public');
mkdirSync(outDir, { recursive: true });

// userscript（常駐・推奨）: フローティングボタンを出し、押したら fill。
const userscript = `// ==UserScript==
// @name         就活台帳オートフィル
// @namespace    jobhunt-portal
// @version      ${new Date().toISOString().slice(0, 10)}
// @description  profile-daicho.md の内容で各社マイページ/ESの基本欄を下書き入力する（送信は手動）
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function(){
  var btn=document.createElement('button');
  btn.textContent='↧ 台帳入力';
  btn.style.cssText='position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#2E3A8C;color:#fff;border:0;padding:9px 14px;border-radius:99px;font:13px system-ui;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.2)';
  btn.onclick=function(){ ${runtime} };
  function add(){ if(!document.getElementById('jh-fill-btn')){ btn.id='jh-fill-btn'; document.body.appendChild(btn); } }
  if(document.body)add(); else window.addEventListener('DOMContentLoaded',add);
})();
`;

writeFileSync(join(outDir, 'jobhunt-autofill.user.js'), userscript, 'utf8');
writeFileSync(join(outDir, 'jobhunt-autofill-dict.json'), JSON.stringify(dict, null, 2), 'utf8');

// bookmarklet（インストール不要）: javascript: URL 一発。
const bookmarklet = 'javascript:' + encodeURIComponent(runtime);
writeFileSync(join(outDir, 'jobhunt-autofill-bookmarklet.txt'), bookmarklet, 'utf8');

console.log(`✓ 生成しました（${dict.length} 項目を辞書化）`);
console.log('  - public/jobhunt-autofill.user.js（Tampermonkey 推奨）');
console.log('  - public/jobhunt-autofill-bookmarklet.txt（ブックマーク登録用）');
console.log('  - public/jobhunt-autofill-dict.json（確認用）');
if (skipped.length) console.log(`  ※ 台帳が空でスキップ: ${skipped.join('、')}`);
