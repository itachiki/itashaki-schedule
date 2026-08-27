# 配信スケジュールサイト

視聴者に配信予定を共有するための、カード型の静的Webサイトです。表示と判定は閲覧者の端末設定にかかわらず、常に日本時間（`Asia/Tokyo`）を基準にします。

## 構成

```
public/
├─ index.html      # ページ本体
├─ style.css       # 見た目・レスポンシブ表示
├─ script.js       # JSON読込、日時表示、絞り込み
└─ schedules.json  # 配信予定データ
```

公開対象は `public/` のみです。HTMLを編集せず、`schedules.json` を編集するだけで予定を管理できます。

## ローカル確認

`fetch()` でJSONを読むため、`index.html` をファイルとして直接開かず、`public` をWebサーバーで配信してください。例えば Python が利用できる場合は、リポジトリ直下で次を実行します。

```bash
python -m http.server 8000 --directory public
```

その後、`http://localhost:8000` を開きます。

## `schedules.json` の編集・追加

予定は配列の1要素が1配信です。日時はタイムゾーン付きISO 8601形式で入力してください。日本時間なら末尾を `+09:00` にします。

```json
{
  "id": "20260827-main",
  "title": "FF14 ルーレット",
  "start": "2026-08-27T23:00:00+09:00",
  "end": "2026-08-28T01:00:00+09:00",
  "category": "通常配信",
  "content": "FINAL FANTASY XIV",
  "description": "今日ものんびりルレ消化",
  "youtubeUrl": "https://www.youtube.com/"
}
```

- `id`、`title`、`start`、`end` は必須です。
- `category`、`content`、`description`、`youtubeUrl` は任意です。
- `youtubeUrl` には `https://youtube.com/`、`https://www.youtube.com/`、または `https://youtu.be/` のURLだけを指定できます。空欄またはそれ以外はボタンを表示しません。
- 予定を追加する場合は、同じ形式のオブジェクトを配列に加えます。開始日時の順序は自動で整列されます。
- 日付をまたぐ予定も1件だけを入力します。たとえば終了が翌日01:00なら、画面では開始日のカードに `25:00` と表示されます。月またぎ・年またぎにも対応します。

## 表示ルール

- 初期表示は「今週」です。週は月曜日から日曜日までです。
- 「今日」「今週」は配信の**開始日**を日本時間で判定します。
- `UPCOMING`（開始前）、`LIVE`（配信中）、`ENDED`（終了済み）を現在の日本時間で自動判定します。
- 終了済みの予定は通常の一覧には表示しません。`LIVE` は赤い枠で強調します。
- JSONの読込または形式に失敗した場合は画面に案内を表示し、詳しいエラーはブラウザのコンソールで確認できます。

## テーマ色の変更

[`public/style.css`](public/style.css) 冒頭の `:root` にあるCSS変数を変更してください。主な色は `--color-accent`（基調色）、`--color-live`（配信中）、`--color-page`（背景）です。

## Cloudflare Pages 設定

GitHubリポジトリを接続して、以下でデプロイします。

- Production branch: `main`
- Framework preset: `None`
- Build command: 空欄
- Build output directory: `public`

静的ファイルだけで動作するため、依存関係のインストールやビルドは不要です。
