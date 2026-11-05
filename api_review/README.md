# 公開側の継続API処理

公開可視抜粋だけをこの公開repo自身の標準Ubuntuで処理する。
原本・非表示内容・個人情報・私的検査台帳・未確認の指摘は入力として公開しない。
API結果はAES-256-GCMで暗号化し、公開するのは件数・状態・tokensと暗号文だけ。
非公開repoにアクセスするトークンは公開側へ登録しない。APIはstore:false。

## 稼働条件

公開repoのSecret `OPENAI_API_KEY` と `API_RESULT_KEY` が必要。
前者は既存APIキーを利用可。後者はランダム32バイトをbase64にした専用鍵。
鍵の値はチャット・Git・ログに出さず、受信する非公開側のSecretにも同じ値を設定する。
公開側のVariable `PUBLIC_API_ENABLED=true` は設定が完了するまで有効にしない。
APIキー作成・Secretの移送・課金設定変更をこのコードは行わない。

`api-public-state` ブランチの `api-runtime/ledger.json` を
`{"schema_version":1,"requests":{}}` で初期化してから有効にする。
既存台帳を空にして上書きしない。暗号鍵の変更時は旧鍵を保管し、旧結果の受信完了後に切り替える。

## キューと重複防止

`api_review/queue.json` は公開レビュー済み抜粋だけをPRで追加する。
各entryはid、executor=public、public_export_approved=true、documentsのみ。
documentsはid/title/text/url/source_sha256のみ、1要求3資料・16KB・出力1200tokens・通信45秒。
本文は可視範囲とセル/節位置、前後の文脈を含める。公開承認フラグは自動判定ではない。
公開本文であることと、抜粋を公開repoに再配布してよいことの両方を確認する。

今回の初期キューは空。非公開側の7件19資料を二重登録しない。
移管時は非公開側の自然runと最新ledgerを先に照合し、実行中は移管しない。
非公開queueに`held/reason=delegated_to_public`と公開entry ID・元payload SHAをCAS記録してから
公開PRを統合する。旧失敗の訂正再確認は今回許可済み各1回だけで、無条件再送は不可。
公開PRが失敗しても自動的に非公開pendingへ戻さず、再開条件を記録する。

6時間ごとの自然実行で、未処理がある間は最大40分連続して消化する。
空キューでは待機せず終了。未処理は次回へ残す。API提供側/通信エラーはその回を止める。
失敗・中断・結果保存不明の予約は再送せず、独立資料を次回処理する。
IDを変えても同一原本SHA＋可視本文は重複送信しない。
予約のCAS保存が成功してからAPIを呼ぶ。並行実行はconcurrencyで直列化する。
状態ファイル1.6MB到達時は新規送信を止め、復号・私的保全後に別途レビューして世代更新する。
独自の日/月要求回数上限は設けない。残高不足・rate limit等は失敗として停止する。

## 非公開側への受け渡し

公開 `api-public-state/api-runtime/ledger.json` を読み取り、非公開環境で
`API_RESULT_KEY` を使い `python api_review/receive.py --checkpoint <保存JSON> --out <私的出力JSON>`。
受信コードはレビュー済みcommitへ固定する。出力先は非公開作業領域のみ。
暗号認証・request digest・状態・tokens・source keyの一致を確認し、既存私的台帳へ接続する。
公開に復号鍵や平文結果をコミット/ログ出力しない。受信は公開承認ではない。
Workは必要な原本・表示・文脈の最終照合だけを行い、記事/X案を再生成しない。
自動収集・キュー補充・本番公開の工程はこのworker自体に含まれない。

## 限定検証

`python -m unittest discover -s api_review -p 'test_*.py'`

新workflowのPRジョブは固定応答テストだけ。PR・fork・手動起動にはSecretを渡さない。
実行ジョブは公開mainのscheduleかつ明示有効化時だけ。成果物アップロードやキャッシュは使わない。
既存の原本取得・採点・施設/食品・本番配信・全体CIを起動しない。
この仕組みの設置は、実API成功・非公開Actions削減・全国完了を意味しない。
