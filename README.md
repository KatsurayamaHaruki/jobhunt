# 就活ポータル（Next.js + Supabase + Claude Code ワーカー）

企業・締切・ES・選考状況を一元管理する自分用ポータル。**AI処理は Claude Code（サブスク）が行い、従量課金APIは使わない。**
人間の操作は「**認証情報の入力**」と「**AIの出力チェック**」だけ、を目標にした構成。

## 全体像

```
ブラウザ（ポータル）  …… 表示・手動編集。Supabase の anon キーのみ（RLSで保護）
        │ 見る/手で直す
        ▼
Supabase（Postgres）  …… companies / user_docs / status_log
        ▲
        │ 書く（service_role・ローカル専用）
Claude Code（サブスク）…… tools/ と tools/playbooks/ に従って AI 作業
        ├─ フォーム自動入力スクリプトの生成（機械処理・トークン0）
        ├─ Gmail 連携で選考状況を自動更新
        └─ ES下書きの生成
```

ポイントは**役割の逆転**：以前はポータルが Anthropic API を叩いて課金していた。今は AI 作業を
ローカルの Claude Code（サブスク内）が担い、結果を Supabase に書く。ポータルは表示と確認に専念する。

## データモデル
- `companies`: 企業1行。締切タスク `tasks` とES下書き `es_drafts` は JSONB 配列。
- `user_docs`: 自己分析マスター資料・プロフィール（台帳）をユーザーごとに1行。
- `status_log`: ステータス/締切/ESの**変更履歴**（source=gmail/manual/es、証跡つき）。AIの出力チェック用。

---

## セットアップ

### 1. Supabase
1. プロジェクトを作成し、SQL Editor で `supabase/schema.sql` を実行（テーブル＋RLS）。
2. Authentication は既定のメール（マジックリンク）でよい。
3. **一度ポータルにログイン**してユーザー行を作る（ワーカーがメールから user_id を引くため）。
4. Project Settings → API から `Project URL` / `anon public` / `service_role` を控える。

### 2. ローカル
```bash
cp .env.example .env.local   # 値を記入
npm install
npm run dev
```
`.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` … ブラウザ用（公開前提、保護はRLS）
- `SUPABASE_SERVICE_ROLE_KEY` … **ローカルのワーカー専用の全権キー**。`NEXT_PUBLIC` を付けない／Vercel に置かない。
- `JOBHUNT_USER_EMAIL` … 自分のログインメール（user_id 解決用）
- `PROFILE_PATH` … `profile-daicho.md` のパス

### 3. Vercel（任意）
ポータルだけデプロイする場合、登録する環境変数は `NEXT_PUBLIC_SUPABASE_URL` と
`NEXT_PUBLIC_SUPABASE_ANON_KEY` の**2つだけ**。service_role は絶対に登録しない。

---

## ワーカー（tools/）

| コマンド | 役割 |
|---|---|
| `node tools/sync-profile.mjs` | `profile-daicho.md`（唯一の正）→ ポータルの「資料」に同期 |
| `node tools/build-autofill.mjs` | 台帳 → フォーム自動入力スクリプトを `public/` に生成 |
| `node tools/jobctl.mjs …` | 企業/ステータス/締切/ESを更新（全変更を `status_log` に記録） |

`node tools/jobctl.mjs` を引数なしで実行すると使い方が出る。

### プレイブック（Claude Code に渡す手順書）
- `tools/playbooks/gmail-sync.md` … Gmail から選考状況を自動更新（差分＋ルール優先でトークン節約）
- `tools/playbooks/es-generate.md` … ES下書きを生成して保存
- `tools/playbooks/autofill-update.md` … 新しい設問が出たとき台帳を更新→スクリプト再生成

---

## フォーム自動入力（機械処理・トークン0）
1. `node tools/build-autofill.mjs` を実行（台帳更新のたびに）。
2. `public/jobhunt-autofill.user.js` を Tampermonkey 等に入れる（推奨）。
   または `public/jobhunt-autofill-bookmarklet.txt` をブックマークに登録。
3. 各社マイページでボタン/ブックマークレットを押す → 基本欄が下書きされる。**送信は手動**。
4. 何が入るかは `public/jobhunt-autofill-dict.json` で確認できる。

---

## 注意点
- `SUPABASE_SERVICE_ROLE_KEY` はローカル `.env.local`（`.gitignore` 済み）だけ。共有・公開・Vercel登録は厳禁。
- ES下書き・Gmail判定は AI の出力。**提出/送信前に必ず「履歴」タブと本文を確認**する。
- 台帳にパスワード・口座・マイナンバーを入れない（自動入力辞書にも入らない）。
- 文字数の正は画面のライブカウンタ（コードポイント数）。モデルの自己申告は当てにしない。
