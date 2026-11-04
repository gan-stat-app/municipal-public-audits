# DPC生成器の段階移行

## 第1段階の範囲

`dpc-generation.yml` は公開済み病院別集計52ファイルから、2021–2024年度の医療圏別・MDC別集計1ファイルを再生成する。コード2本は元Git blobと同一。利用者の2026-11-04の明示指示を、このコード・公開集計の公開リポジトリへの複製根拠とする。一般利用者への新しいライセンスは付与しない。原資料の権利・条件は引き続き提供元に従う（https://municipal-smr.jp/data-use/ 、https://municipal-smr.jp/dpc/provenance.html ）。公開URL、算式、公表抑制の扱い、収集時刻を変更しない。

入力と出力のパス・Git blob・サイズは `dpc-generation-inputs.json` に固定。入力は公式原本ではなく、サイトで既に配信中の派生集計。非公開原本・SMR・未確認の文書指摘・元Git履歴・非公開repoの認証情報を移さない。入力取得は最大2並列。リダイレクト・サイズ・ハッシュ検証は既存 `common.py` を使用する。

既存 `verify-dpc-area-mdc-summary.mjs` は4年度×335医療圏×18MDC×11値=265,320セルを再計算・照合する。その後、既存生成器を実行し、展開後のJSONが公開版と1バイトも違わず、再生成したミラーも一致することを検証。Node 22.23.2を固定し、生成・照合時間をreceiptへ保存する。公開gzipには作成時刻と元ファイル名が埋め込まれ、再圧縮コンテナはバイト不一致になることを実測した。JSON自体はバイト一致する。receiptではdecoded_byte_identityとcontainer_byte_identityを区別し、公開版コンテナを変更せず、再生成版も別名で保存する。JSONの意味的一致だけでは成功扱いにしない。

専用workflowだけを狭いパスで起動し、19分野の保存処理やサイト全体ビルドを起動しない。定期トリガーは追加しない。成果物は公開済み集計・その再生成集計とreceiptだけ、保存1日。非公開側が証拠として使うのは固定main pushのジョブ・対象ステップ成功と、HEADおよび作業ファイルの全入力一致。14日経過、API失敗、不一致では既存検証を実行する。UI・出典・原本検査の成功を代用しない。

## 現行生成器と残作業

| 生成器 | 入力・依存 | 状態 |
|---|---|---|
| scripts/build-dpc-area-mdc-summary.mjs | 公開済み52集計、Node標準fs/zlib/url/path | 第1段階の移行対象 |
| source/scripts/build-dpc-data.py | 令和6年度施設・MDC・入院・救急車・死亡・診断群・定義表・医療圏Excel、openpyxl | 原本再生成は未移行 |
| source/scripts/build-dpc-history.py | 2021–2023年度施設・MDC・入院・救急車、医療圏Excel、openpyxl | 同上 |
| source/scripts/build-dpc-hospital-history.py | 2021–2024年度施設・MDC・入院・救急車Excel、openpyxl | 同上 |
| source/scripts/build-dpc-year-payloads.py | 2021–2023年度施設・MDC・入院・救急車・24時間死亡、医療圏Excel、openpyxl | 同上 |
| source/scripts/build-dpc-extended-data.py | 診断群・年度定義表・MDC別手術Excel、extended-source-manifest、2024比較用集計、openpyxl | 同上 |

原本ディレクトリ `source/raw/dpc` と `source/raw/dpc/history` は現在のGitHub contentsで存在を確認できない。これらを推測で公開入力にしない。既存公開 `summary.json`・`year-source-manifest.json` と生成コードには厚労省URL・原本ハッシュの記録がある。後続段階では原本ごとに公式掲載ページ、利用条件URL、第三者権利、取得時刻・サイズ・SHA-256を確認し、同一ハッシュの公式公開入力だけを一時取得して比較する。変更・取得不能なら移行未完了。非公開保管原本はコピーしない。`datasets.json` のDPC generation=not-migratedは原本生成器について引き続き正しい。

## 使用量の評価と横展開

移行前後の同じ入力・同じ範囲で、両repoの全関連run（PR検証、main検証、失敗・再実行、公開artifact処理、非公開証拠照合を含む）のjobsの開始・終了時刻を合算する。並列ジョブの壁時計時間だけで比較しない。実行秒とGitHubのジョブ単位の分丸めを区別し、ストレージbyte-daysと課金対象額も別に記録する。公開repoに移したという理由だけで実行量削減・費用削減と結論しない。

この再集計自体は軽いため、公開CI起動・入力取得の増分が非公開で省略できる時間を上回る可能性がある。実測がない段階の判定は「削減未証明」。既存19分野のdataset(dpc)の27秒を、この新しい生成処理の削減実績として流用しない。

他分野も、(1)公開条件の確認、(2)最小の生成単位と完全な依存集合、(3)コード・入力・環境固定、(4)既存回帰検証とバイト一致、(5)公開main成功を固定、(6)同一入力の場合だけ重複検証省略、(7)両repo合算評価、の順に進める。失敗・部分範囲を完全移行と記録しない。

## 第2段階の最小単位（2026-11-05）

`stage2/README.md`・`stage2/inventory.json` に5本の依存と原本参照80件を整理。公式取得・ハッシュ照合済みは定義テーブル1件、他は未取得79件。`build-dpc-data.py` の手術定義抽出のみを計算変更なしで切り出した。公開JSON131,031バイト・164疾患・320手術グループの全バイト一致、限定4テスト成功。DPC専用workflowに独立ジョブを追加。全体CI抑止のため自動CIをskipし、専用Actionsは未実行。公開mainの証拠採用と非公開側の省略は未実施。5本全体とdatasets.jsonの原本生成not-migratedは維持する。非公開原本・SMRは移していない。合算削減効果は未証明。次位置は専用CIと残原本の公式取得。
