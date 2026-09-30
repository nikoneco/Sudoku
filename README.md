# SUDOKU

iPhone向け数独PWA。候補整理とNaked Singleの連鎖だけを自動化し、推理はプレイヤーに残します。

[アプリを開く](https://nikoneco.github.io/Sudoku/)

## 使い方

難易度を選び、マスをタップして数字を入力します。MEMOまたは同じマスのダブルタップで候補編集へ切り替えます。Undoは自分の1手とそこから起きた自動連鎖をまとめて戻します。DELは数字または候補を消し、その操作では自動確定しません。

入力済みのマスでも、MEMOで別の数字を押せば元の数字と合わせた候補へ戻せます（1→MEMO 9で1・9）。固定数字は変更できません。

ホームに戻っても途中状態は保存されます。新しい問題を選ぶと途中問題を確認なしで入れ替えます。成績は保持されます。

iPhoneではSafariで開き、共有メニューから「ホーム画面に追加」。最初にオンラインで開いた後は、取得済みの問題をオフラインでも遊べます。Googleログインで成績と設定を端末間同期できます。サイトデータ削除で途中状態と未同期の成績・設定は消えます。

設定の「候補が1つのとき自動入力」をOFFにすると、候補が1個でも自分で数字を入れられます。初期設定はONです。設定を切り替えても途中の盤面は変わらず、次の入力から適用します。

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

設定・成績画面の「Googleでログイン」で、成績と設定（自動候補表示・自動入力・テーマ）を端末間で同期できます。Googleログインは任意です。盤面・メモ・Undo履歴は端末内に残ります。ログイン前の成績を追加する場合は「この端末の成績を取り込む」を押します。

設定はアカウントごとに保持し、ログアウトするとログイン前の設定に戻ります。初回は保存済みのクラウド設定を優先し、なければ端末の設定を使います。オフライン変更は端末に保存し、オンライン復帰や「成績と設定を同期」で再試行します。変更した項目だけを統合し、同じ項目が競合した場合は後から成功した同期を採用します。

Google認証は[Firebase公式のポップアップ方式](https://firebase.google.com/docs/auth/web/google-signin)、成績保存はFirestoreのユーザー別領域を使用します。経験値も成績と一緒に同期されます。`js/firebase-config.js` は公開用Web構成で、管理者資格情報ではありません。アクセス制限は `firestore.rules` で行います。Google以外のプロバイダ・分析機能・課金プランは使用しません。

経験値は導入後のクリアだけが対象です。同じ問題でも新たにクリアすれば加算され、再読み込み・同期再試行では増えません。実装ではクリアごとのUUID記録を統合し、[Firestoreトランザクション](https://firebase.google.com/docs/firestore/manage-data/transactions)で未登録の記録だけを追加します。称号は管理用Levels表を基に `js/data/level-titles.js` へ同梱しており、表の編集は次回公開時に反映する方式です。

Firestoreルール変更時はローカルエミュレータで `tools/verify-firestore.mjs` を実行し、本人のみの読み書き・他人/未ログインの拒否・盤面・不正な設定の書込み拒否を確認してから、数独専用Firebaseに反映します。検証依存は `.local/firebase-qa` に `firebase-tools @firebase/rules-unit-testing firebase@12.16.0` をインストール（Java 21以降が必要）。`firebase emulators:exec --config firebase.emulator.json --project demo-sudoku --only firestore "node tools/verify-firestore.mjs"`。異なる依存配置は `SUDOKU_FIREBASE_QA_ROOT` で指定できます。本番DBにテスト成績を入れません。

GASのコードは `gas/`。指定したスプレッドシートのPuzzles/Configから問題集を読み取ります。Script Propertiesの `SUDOKU_SPREADSHEET_ID` に参照先を設定します。`.clasp.json` と管理IDはローカル専用です。

更新手順: テスト → 全問題検証 → 差分と独立レビュー → GASソース反映／既存デプロイ更新 → mainへcommit/push → PagesとAPIを確認。問題データを変えたらConfigと同梱JSONのdatasetVersionを上げます。UIを変えたらService Workerのキャッシュ版も更新します。

GASは公開読取APIのみ。Sheetsの管理データ、解答、認証情報は公開しません。APIは通常JSON取得を試し、クロスオリジン通信失敗時は許可したコールバック形式のJSONPへ切り替えます。仕組みは[Google公式Content Service](https://developers.google.com/apps-script/guides/content)に基づきます。

## 資料

- [仕様](docs/SPEC.md)
- [データ構造](docs/DATA_MODEL.md)
- [検証計画](docs/TEST_PLAN.md)
- [検証結果](docs/VERIFICATION.md)

Daily Sudokuは今後の拡張対象です。iPhone実機の確認状態は検証結果を参照してください。
