# 配信スケジュールサイト

視聴者に配信予定を共有するためのカード型Webサイトです。非公開Googleスプレッドシートを管理画面として使い、Cloudflare Pages Functionが読み取り専用で予定を取得します。表示と判定は閲覧者の端末設定にかかわらず、常に日本時間（`Asia/Tokyo`）を基準にします。

## 構成

```
functions/
└─ api/
   └─ schedules.js # Google Sheets読取API
public/
├─ index.html      # ページ本体
├─ style.css       # 見た目・レスポンシブ表示
├─ script.js       # API読込、日時表示、絞り込み
└─ schedules.json  # 移行前データ・形式の参考
```

予定はGoogleスプレッドシートで管理します。サービスアカウントには対象シートの閲覧権限だけを付与し、秘密鍵はCloudflareの暗号化されたSecretとして保存します。

## ローカル確認

Pages Functionを含むため、本番相当のローカル確認にはWranglerを使用します。

```bash
npx wrangler pages dev public
```

ローカルでGoogle Sheetsへ接続する場合は、リポジトリ直下に `.dev.vars` を作り、本番と同じ3変数を設定します。このファイルはGit管理対象外です。秘密鍵を含むファイルはコミットしないでください。

## Googleスプレッドシート

シート名を `schedules` にして、1行目に以下の列を作成します。

| 列 | 内容 | 入力例 |
| --- | --- | --- |
| A | 公開 | チェックボックス |
| B | タイトル | FF14 ルーレット |
| C | 開始日 | 2026-08-27 |
| D | 開始時刻 | 23:00 |
| E | 終了日 | 2026-08-28 |
| F | 終了時刻 | 01:00 |
| G | カテゴリー | 通常配信 |
| H | 対象コンテンツ | FINAL FANTASY XIV |
| I | 補足 | 今日ものんびりルレ消化 |
| J | YouTube URL | https://www.youtube.com/ |

- スプレッドシートのタイムゾーンは `（GMT+09:00）東京` にします。
- C・E列は `yyyy-MM-dd`、D・F列は `HH:mm` の表示形式にします。
- タイトル、開始日・時刻、終了日・時刻は必須です。入力途中の行は公開チェックを外してください。
- 日付をまたぐ配信は、終了日に翌日を指定します。月またぎ・年またぎにも対応します。
- 開始日時と終了日時を同じにすると、カードには開始時刻だけを表示します。
- YouTube URLは安全なHTTPSのYouTube URLだけが公開ページのボタンになります。
- シートの変更はAPIキャッシュの有効期間により、公開ページへ最大約60秒で反映されます。

## Cloudflareの変数とSecret

Pagesプロジェクトの `Settings > Variables and Secrets` で、本番環境に以下を設定します。

- `GOOGLE_SERVICE_ACCOUNT_JSON`：サービスアカウントJSON全文。必ず暗号化されたSecretにする
- `GOOGLE_SHEET_ID`：スプレッドシートURLの `/d/` と `/edit` の間のID
- `GOOGLE_SHEET_RANGE`：`schedules!A2:J`

サービスアカウントの `client_email` に対象スプレッドシートを閲覧者として共有します。変数を追加・変更した後は再デプロイが必要です。

## 表示ルール

- 初期表示は「７日間後まで」です。閲覧時刻から168時間以内に開始する予定を表示します。
- 「今日」「今週」は配信の**開始日**を日本時間で判定し、終了済みの予定も表示します。週は月曜日から日曜日までです。
- 「今後すべて」は終了済みの予定を除外します。
- `UPCOMING`（開始前）、`LIVE`（配信中）、`ENDED`（終了済み）を現在の日本時間で自動判定します。
- 終了済みの予定は通常の一覧には表示しません。`LIVE` は赤い枠で強調します。
- APIの読込または形式に失敗した場合は画面に案内を表示し、詳しいエラーはブラウザおよびCloudflare Functionsのログで確認できます。

## テーマ色の変更

[`public/style.css`](public/style.css) 冒頭の `:root` にあるCSS変数を変更してください。主な色は `--color-accent`（基調色）、`--color-live`（配信中）、`--color-page`（背景）です。

## Cloudflare Pages 設定

GitHubリポジトリを接続して、以下でデプロイします。

- Production branch: `main`
- Framework preset: `None`
- Build command: 空欄
- Build output directory: `public`

外部ライブラリやビルドは不要です。リポジトリ直下の `functions/` はPages Functionとして自動認識されます。
