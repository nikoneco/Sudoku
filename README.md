# SUDOKU

iPhone向け数独PWA。候補整理とNaked Singleの連鎖だけを自動化し、推理はプレイヤーに残します。

[アプリを開く](https://nikoneco.github.io/Sudoku/)

## 使い方

難易度を選び、マスをタップして数字を入力します。MEMOまたは同じマスのダブルタップで候補編集へ切り替えます。Undoは自分の1手とそこから起きた自動連鎖をまとめて戻します。DELは数字または候補を消し、その操作では自動確定しません。

入力済みのマスでも、MEMOで別の数字を押せば元の数字と合わせた候補へ戻せます（1→MEMO 9で1・9）。固定数字は変更できません。

ホームに戻っても途中状態は保存されます。新しい問題を選ぶと途中問題を確認なしで入れ替えます。成績は保持されます。

iPhoneではSafariで開き、共有メニューから「ホーム画面に追加」。最初にオンラインで開いた後は、取得済みの問題をオフラインでも遊べます。端末間同期はありません。サイトデータ削除で途中状態と成績も消えるため注意してください。

## 開発

Node.js 22以上（動作確認環境は24）。本番はHTML/CSS/Vanilla JS、ビルド不要です。

```sh
npm ci
npm test
npm run serve
```

開発URLは `http://127.0.0.1:4173/Sudoku/`。本番同様サブパスで確認します。

```sh
npm run generate -- --seed sudoku-v1-seed-2026 --count-per-tier 500
npm run validate
## 管理用JSONのないcloneでは公開問題を独立検証
npm run validate -- --client-only
node tools/export-puzzles.mjs --help
```

生成物は `data/puzzles.json`、解答入り管理データはGit対象外の `.local/puzzles-admin.json`。外部の問題集はコピーしません。一意解を全件検証します。解答はPWAへ配信しません。

難易度は初級=Hidden Singleまで、中級=Locked Candidates、上級=Pair、超上級=実装済み論理手法では解けず探索を要する問題。空きマス数だけでは分類しません。人間の体感難易度は暫定で、X-Wing等の未実装手法で解ける問題も超上級へ含まれます。

## Google連携と公開

GASのコードは `gas/`。指定したスプレッドシートのPuzzles/Configから問題集を読み取ります。Script Propertiesの `SUDOKU_SPREADSHEET_ID` に参照先を設定します。`.clasp.json` と管理IDはローカル専用です。

更新手順: テスト → 全問題検証 → 差分と独立レビュー → GASソース反映／既存デプロイ更新 → mainへcommit/push → PagesとAPIを確認。問題データを変えたらConfigと同梱JSONのdatasetVersionを上げます。UIを変えたらService Workerのキャッシュ版も更新します。

GASは公開読取APIのみ。Sheetsの管理データ、解答、認証情報は公開しません。APIは通常JSON取得を試し、クロスオリジン通信失敗時は許可したコールバック形式のJSONPへ切り替えます。仕組みは[Google公式Content Service](https://developers.google.com/apps-script/guides/content)に基づきます。

## 資料

- [仕様](docs/SPEC.md)
- [データ構造](docs/DATA_MODEL.md)
- [検証計画](docs/TEST_PLAN.md)
- [検証結果](docs/VERIFICATION.md)

Daily Sudokuは今後の拡張対象です。iPhone実機の確認状態は検証結果を参照してください。
