# 北海道サウナ手帳：現地レポート共有機能（Cloudflare導入用）

このパッケージは、既存の北海道サウナ手帳に、利用者からの現地レポート投稿・管理者承認・施設別公開を追加するものです。

## この版に反映済みの環境情報

- Worker名：`souna`
- 公開先：`https://souna.daikioka1014.workers.dev/`
- D1データベース名：`souna-community`
- D1 database_id：`a023e52b-1708-4e07-a893-db78e4bf1508`
- D1 binding名：`DB`
- 静的アセットbinding名：`ASSETS`
- Worker entry point：`src/index.js`
- Turnstile hostname：`souna.daikioka1014.workers.dev`

## 既に実施済みの作業（再実行不要）

1. Cloudflare D1 `souna-community` の作成
2. D1 Consoleで `migrations/0001_create_reports.sql` と同じSQLを実行し、reportsテーブルとインデックスを作成
3. Turnstile widget `souna-community-report` の作成（Managed）
4. Worker `souna` にSecret `TURNSTILE_SECRET` と `ADMIN_TOKEN` を登録・保存

**D1のSQLはすでに実行済みです。今回は再実行しないでください。**（SQLは履歴・今後の管理用として同梱しています。）

## GitHubへ反映する前に行うCloudflare設定

Worker `souna` の Settings → Builds で次の値にします。

- Build command：`None` のまま
- Root directory：`/` のまま
- Deploy command：`npx wrangler deploy`
- Git repository：`daikioka1014-ctrl/souna`
- Production branch：`main`

変更後にSaveします。保存しても、その場で再デプロイする必要はありません。GitHubへの次のコミットで反映されます。

次に Worker `souna` の Settings → Variables and Secrets に、通常のText変数を1つ追加します。

- Type：Text（Secretではありません）
- Variable name：`TURNSTILE_SITE_KEY`
- Value：Turnstile widget `souna-community-report` の Sitekey

既に登録済みの2つのSecretはそのまま使います。

- `TURNSTILE_SECRET`：再発行後のSecret key
- `ADMIN_TOKEN`：管理者用のランダムな秘密文字列

`wrangler.jsonc` には `keep_vars: true` を設定し、ダッシュボードで設定した `TURNSTILE_SITE_KEY` などの通常変数が次回デプロイ時に削除されないようにしています。Cloudflare公式仕様では、`keep_vars` がない場合、Wranglerは設定ファイル内にない通常変数をデプロイ時に削除します。Secretは別扱いで、通常のデプロイでは削除されません。

Secret keyやADMIN_TOKENをGitHubのファイルに書かないでください。Sitekeyは公開用ですが、今回はCloudflareのText変数で管理します。

## GitHubへアップロードするファイル

ZIPを展開し、**展開先フォルダの中身**を、GitHubリポジトリ `daikioka1014-ctrl/souna` の `main` ブランチのルートへ、できるだけ1回のアップロード・1回のコミットで反映してください。フォルダ構成を保ってください。

- `public/index.html`：既存ファイルを差し替え
- `public/sauna_data.json`：今回受領した最新版と同一内容（SHA-256一致）。差し替えてもデータ内容は変わりません
- `public/admin.html`：新規追加
- `src/index.js`：新規追加
- `migrations/0001_create_reports.sql`：新規追加（SQLの再実行は不要）
- `wrangler.jsonc`：リポジトリ直下に新規追加
- `README.md`、`.gitignore`、`TEST_REPORT.txt`：リポジトリ直下に追加

GitHubの `Add file` → `Upload files` で、展開フォルダ内の `public`、`src`、`migrations` フォルダとルート直下のファイルをまとめてアップロードできます。コミット前に、プレビューでパスが上記のとおりになっていることを確認してください。

**重要：`souna-community-release/` のような外側のフォルダ名をGitHubに作らず、その中身をリポジトリ直下へ置いてください。**

## コミット後の流れ

1. `main` へのコミットをCloudflare Workers Buildsが検知してデプロイします。
2. デプロイ成功後、Worker Settings → Bindings にD1 binding `DB` が表示されることを確認します。
3. `/api/config` が `postingEnabled: true` を返すことを確認します。
4. サイトで投稿フォーム・Turnstile・承認待ち投稿をテストします。
5. `/admin.html` で `ADMIN_TOKEN` を入力し、承認・公開・非公開・編集・削除を確認します。

## 機能

- 施設詳細ごとの現地レポート表示
- 利用者のレポート投稿（ニックネーム任意・メールアドレス不要）
- 訪問日、浴場、サウナ温度、水風呂温度、混雑、設備タグ、コメント
- Turnstileによる投稿前検証とWorker側のSiteverify
- D1に承認待ちとして保存し、管理者承認後にのみ公開
- `/admin.html` の管理者画面から公開・非公開・編集・削除
- 既存の個人メモ保存キー `hokkaidoSaunaNote.v500` は維持

## 注意

- ZIPに含む `public/sauna_data.json` は今回受領したファイルとバイト単位で一致しています。
- `public/index.html` は共有レポート機能を組み込んだ改修版です。
- このパッケージのJavaScript構文、JSON、SQLの形式検査とAPIモックテストは実施済みです。
- Cloudflare本番への接続・実データベース・Turnstile実検証・実機ブラウザ確認は、デプロイ後に必要です。
- 既存の個人メモは各利用者のブラウザ内に残ります。共有レポートはD1に別管理されます。
