# データモデル

## 種類の追加（1.6.0）

- 設定 `mode` は normal／jigsaw。既存値の欠落はnormal。端末appは `currentGames:{normal,jigsaw}` に各1件と、互換用の `currentGame` を保持。途中盤面・領域・履歴はクラウドへ送らない。
- ジグソー問題は `mode:'jigsaw'`、`regions`（0〜8の81文字）を追加し、IDは `jigsaw_` 接頭辞。成績の既存問題ID空間で両種類を保持し、画面では種類ごとに集計する。旧集計・旧ベストは通常へ帰属。経験値イベントは両種類で共通。
- `preferences/app` の旧3項目を維持し、別の `users/{uid}/preferences/mode` に `{mode}` を同期。新旧アプリが同居しても旧版による設定書込みでmodeを消さない。
- `Puzzles_Jigsaw` はPuzzlesの12管理列＋M列 `regions`。`puzzle`・`solution`・`regions` は文字列で先頭0を維持。公開時はpuzzleId/difficulty/puzzle/mode/regionsだけを返す。Configの `jigsaw_dataset_version=1`、同梱 `data/puzzles-jigsaw.json` と独立キャッシュ `dataset-jigsaw` を使用。
- Levelsシートおよび称号定義は本機能の対象外。

## 端末内
IndexedDB `sudoku-v1` / object store `kv`。

- `app`: `{currentGame,stats,settings,scoreProfiles,settingsProfiles}` を1回のトランザクションで置換。
- `dataset`: `{schemaVersion,datasetVersion,puzzles}`。

盤面は0=空の81要素配列。候補は各マスに9bit整数の手動追加／除外を保持し、合法候補は都度計算する。履歴は盤面・候補・sourceの前後スナップショット（最大100手）。時間と問題識別子はUndoで巻き戻さない。途中のelapsedTimeは端数を含む累積秒数を保存し、設定画面やバックグラウンドでの停止時間を除く。最終クリア記録と時間表示だけ秒未満を切り捨てる。

成績は重複しないクリア済みID、難易度別クリア数とベスト秒数、総数、問題別recordsと旧版由来legacyBest。同じ問題のUndo→Redoや端末間統合で重複計上しない。scoreProfilesはguestとUID別accounts、activeKeyを保持。Googleログイン時は成績と設定を同期できる。Safariとホーム画面PWAで保存領域が異なる場合があり、未同期の成績や盤面はブラウザデータ削除で消える。

## 成績クラウド
数独専用Firebase AuthenticationとFirestore。GoogleアカウントのUIDを所有者として、`users/{uid}/scores/{puzzleId}` に `{difficulty,elapsedTime}` を保存。旧版で個別時間が不明な場合はnull。`users/{uid}/scoreMeta/legacy` のbestTimesで旧版の難易度別最短時間を保持する。Firestoreへ盤面・メモ・履歴・メールアドレスは保存しない。クリアIDは和集合、時間は最小値をトランザクションで統合する。ルールは所有者UIDとフィールド型・値域を検証し、その他の領域を拒否する。

経験値は `experienceEvents: { [UUID]: {difficulty,hintsUsed?} }` を各成績プロファイルに保持する。ヒント0回は従来の `{difficulty}` のまま保存する。hintsUsedは整数0〜5だけを許可し、経験値は基礎報酬×100/80/60/40/20/5%で計算する。合計と進捗は0.5Exp単位も保持する。クラウドは `users/{uid}/experience/{UUID}` に同じ内容を作成専用で保存し、既存文書は変更・削除できない。既存成績に記録がなければ0Exp。問題IDではなくプレイごとのUUIDで統合するため、再クリアは加算・再送は非加算となる。既存UUIDではクラウドで確認した内容を優先する。合計経験値やLvは記録から算出する。完成結果の表示用スナップショットは盤面と一緒に端末内だけへ保存する。

途中盤面には任意の `hintsUsed`（整数0〜5）と `lastHint:{board,cell,digit}|null` を端末内だけへ保持する。旧保存の欠落は使用0回と扱い、元の保存を起動だけで書き換えない。直前と同じ盤面・対象なら再表示は無料、盤面が変われば古い強調を解除する。使用回数はUndo/Redoの対象外。再開では合法候補から対象を再検証して強調を復元する。保存された数字をそのまま正解として使用しない。

## 設定クラウド
`users/{uid}/preferences/app` は `{autoCandidates:boolean,autoFill:boolean,theme:string}` の3項目だけを保持する。themeはclassic/forest/rose/night。所有者だけが読取・作成・更新でき、余分なフィールドや別文書・盤面データは拒否する。

端末内のsettingsProfilesはゲストとUID別の設定・未送信項目を保持する。既存保存は自動入力ONを補い、盤面・メモ・履歴は保持する。新端末の既定値でクラウドを上書きせず、変更した項目だけをトランザクションで統合する。通信中の追加変更はその項目の版で識別し、確認済み送信だけを未送信一覧から外す。同一項目の競合は後から成功した同期を採用する。設定の同期は盤面を変更しない。

## 問題DB
Google Sheets `Puzzles`: puzzle_id / difficulty / puzzle / solution / difficulty_score / seed / generator_version / enabled / daily_eligible / created_at / validated / note。

管理用 `Levels`: Lv / 表示する称号 / 基準cm（管理用） / 対象の目安cm / 比較する部分。Lv1〜200、近い大きさのLvには同じ称号を使用。長さはゲーム用の概算で製品差あり。アプリ同梱の称号定義に管理ID・参照URLは含めない。

`puzzle`、`solution`は先頭0を維持する81文字の文字列。enabled / validated / daily_eligibleは真偽値。Configのschema_version=1、dataset_versionは問題集更新時に増やす。Dailyは無効。

GASはScript PropertiesのSUDOKU_SPREADSHEET_IDを参照。ソースや公開リポジトリにはIDを記載しない。通常配信はpuzzleId / difficulty / puzzleだけ。

## 公開API
- health: 生存確認、schemaVersion
- meta: datasetVersion、4難易度ごとの件数
- sync?version=N: 同一版ならunchanged、新版なら全問題
- puzzles: 全問題

読み取り専用。未定義actionはUNKNOWN_ACTION、POSTはREAD_ONLY。JSONPはsudoku_接頭辞を持つ英数字／アンダースコアのコールバックのみ。エラー応答に内部IDや例外を含めない。

## 初回／オフライン
IndexedDBの有効な問題集 → 同梱JSONの順に読み込む。通信同期の失敗は取得済みの問題に影響しない。Service Workerがアプリと同梱問題集をキャッシュ。プレイデータはService WorkerではなくIndexedDBで保管する。
