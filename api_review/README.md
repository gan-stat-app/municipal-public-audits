# 公開側の継続API処理

公開承認済みの公式資料の可視抜粋だけを処理する。非表示内容・個人情報・私的台帳は入力として公開しない。
2026-11-06の利用者指示により、新しいAPI結果は暗号化せず、version=2 / format=public-jsonで保存する。
結果は未確認の候補であり、fact_confirmed=false / publication_approved=falseを維持する。
公開候補には誤りがあり得る。本番記事の承認とは別であり、出典・引用・原本・表示を確認してから掲載する。
処理状態・件数・使用量は従来から平文であり、新方式でも公開する。APIキー・認証情報は公開しない。

## 稼働と重複防止

既存Secret OPENAI_API_KEYとVariable PUBLIC_API_ENABLED=trueを使う。新しい結果にAPI_RESULT_KEYは不要。
6時間schedule、キュー更新push、document-onceの起動条件、最大40分、1要求3資料/16KB/出力1200tokens、
送信前CAS予約、concurrency、原本SHA+本文の重複防止を維持する。失敗・中断・保存不明は自動再送しない。
APIはstore:false。空キューは待機せず終了する。課金・予算・原本収集・本番公開の設定は変更しない。

正本はapi-public-stateブランチのapi-runtime/ledger.json。既存台帳を空にして初期化しない。
api_review/queue.jsonには公開再配布を確認した抜粋をPRで追加する。
公開入力とAPIの下書き候補が公開repoで閲覧可能になることを確認する。
非公開側へ移管する場合は従来どおり委任台帳・原本SHA・本文・要求IDを照合し、二重投入しない。
自動収集・キュー補充・記事掲載の工程そのものはこのworkerに含まれない。

## 旧暗号化結果の復旧

API_RESULT_KEYは旧version=1結果の復旧にだけ任意使用する。新しい結果の必須条件ではない。
公開側の既存鍵で、現行承認キューと要求ID・出典・引用・状態・使用量が一致した旧結果だけを、
APIへ再送せずversion=2へ変換する。旧暗号文はlegacy_encrypted_reportに保持する。
鍵がない/読めない/一致しない旧結果はlegacy_heldに明記し、新規の独立資料を止めない。
既存結果・失敗・予約を消したりIDを変えて再送したりしない。

## 受信

サイト側は固定の公式GitHub HTTPS endpointから読み、委任要求・本文SHA・出典・引用・状態・使用量を再検証する。
version=2のSHAは転送破損の検出用であり、署名ではない。取得元と私的な委任台帳の照合を省かない。
新しい結果は鍵なしで受信できる。旧暗号化結果は鍵不在/不一致なら保留件数に示し、平文結果の取り込みを続ける。
api_review/receive.pyもversion=2を鍵なしで読み取れる。受信を本番公開承認とは扱わない。
非公開repoの資格情報を公開側へ渡さない。ログへAPIキーや結果本文を出さない。

## 限定検証

python -m unittest discover -s api_review -p 'test_*.py'
PRでは固定応答テストのみ。無関係な全体CI、原本の再取得、APIの再送は行わない。
key-checkは旧来の一度限りの診断経路として保持し、通常の新方式の稼働条件にはしない。
