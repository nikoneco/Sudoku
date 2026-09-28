# データモデル

## 端末内
IndexedDB `sudoku-v1` / object store `kv`。

- `app`: `{currentGame,stats,settings,scoreProfiles}` を1回のトランザクションで置換。
- `dataset`: `{schemaVersion,datasetVersion,puzzles}`。

盤面は0=空の81要素配列。候補は各マスに9bit整数の手動追加／除外を保持し、合法候補は都度計算する。履歴は盤面・候補・sourceの前後スナップショット（最大100手）。時間と問題識別子はUndoで巻き戻さない。

成績は重複しないクリア済みID、難易度別クリア数とベスト秒数、総数、問題別recordsと旧版由来legacyBest。同じ問題のUndo→Redoや端末間統合で重複計上しない。scoreProfilesはguestとUID別accounts、activeKeyを保持。Googleログイン時は成績のみ同期できる。Safariとホーム画面PWAで保存領域が異なる場合があり、未同期の成績や盤面はブラウザデータ削除で消える。

## 成績クラウド
数独専用Firebase AuthenticationとFirestore。GoogleアカウントのUIDを所有者として、`users/{uid}/scores/{puzzleId}` に `{difficulty,elapsedTime}` を保存。旧版で個別時間が不明な場合はnull。`users/{uid}/scoreMeta/legacy` のbestTimesで旧版の難易度別最短時間を保持する。Firestoreへ盤面・メモ・設定・メールアドレスは保存しない。クリアIDは和集合、時間は最小値をトランザクションで統合する。ルールは所有者UIDとフィールド型・値域を検証し、その他の領域を拒否する。

## 問題DB
Google Sheets `Puzzles`: puzzle_id / difficulty / puzzle / solution / difficulty_score / seed / generator_version / enabled / daily_eligible / created_at / validated / note。

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
