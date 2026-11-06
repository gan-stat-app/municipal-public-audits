# DPC第2段階：最小単位の原本再生成

2026-11-05 JST。対象は `build-dpc-data.py` の `load_surgery_definitions` と `text` の抽出のみ。元の関数本文と計算・文字列・並び順は変更しない。5本全体や病院別・年度別生成の移行完了を意味しない。SMR、非公開原本、非公開履歴、認証情報は含まない。

出典：厚生労働省「令和６年度診療報酬改定について」
https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000188411_00045.html
第30項、令和7年3月18日 保医発0318第1号の定義テーブル（001452312.xlsx）を加工して作成。厚生労働省作成のJSONではない。

利用条件：https://www.mhlw.go.jp/chosakuken/index.html
確認時点でPDL1.0、出典と加工の明示が必要。定義表内に別の第三者権利表示は確認しなかった。原本全体を公開artifactへ出さず、既に公開済みの範囲のJSONとreceiptのみを保存する。後続原本にはこの確認を流用しない。

`inventory.json` に5本の依存、既存出力、公式URL、既存ハッシュを記録。未取得は `not-attempted` のまま。取得失敗と混同しない。歴史年度の施設・MDC・入院・救急車は既存コードにURLがあり、取得・原本ハッシュ照合は次段階。医療圏表の掲載ページ・利用条件は未確認。history/areas.xlsx は医療圏表、history/2024-{facility,mdc,admission,ambulance}.xlsx は2024年の対応原本を参照するため、別資料として二重計上しない。拡張生成器は原本manifestと2024年MDC01公開比較ファイルにも依存する。

実行環境：Python 3.12、openpyxl 3.1.5、et-xmlfile 2.0.0（CI固定）。Python標準ライブラリ以外の他の依存は5本ともopenpyxl。圧縮出力ではPython/zlibによるコンテナ差をJSONのバイト一致と区別する。本単位は非圧縮JSON。

限定検証：`python -m unittest discover -s stage2 -p 'test_stage2.py'`、`python stage2/run.py`。公式原本のサイズ/SHA-256、公開参照のGit blob、生成JSONの全バイトを検証。不一致は終了失敗。サイト全体ビルド・全体CI・非公開の検証省略は実施しない。

ローカル限定検証：4テスト成功。公式Excel 1,113,503バイト、SHA-256は既存summaryの記録と一致。JSON 131,031バイト、164疾患、320手術グループ。公開Git blob 074dca0005941bdbbe6bb3d8f8b1868977322448 と一致。検証receiptは `local-receipt.json`。

## Actionsと削減評価

この変更の自動全体CIを起動しないためコミットに `[skip ci]` を付ける。既存 `dpc-generation.yml` のworkflow_dispatchで第1段階と本単位の限定ジョブを実行できるようにした。PR作成時点では専用CI未実行、公開main成功・証拠採用・非公開側の省略も未実施。接続GitHubツールにworkflow_dispatch開始機能がなく、ローカル実行をActions成功と扱わない。

第1段階の公開main run 41807228318 は1ジョブ18秒（09:24:30Z–09:24:48Z）。これは本単位の移行前基準ではなく削減実績に流用しない。今回は公開・非公開とも新規Actions起動0件。移行前後の同じ入力・処理に対応する両repoの実測が未取得のため、合算削減量は未確定。0秒削減とも断定しない。PR・main・失敗/再試行・受渡しを含む全関連ジョブを合計し、丸め課金分と実行秒を分けて比較する。単に公開側へ移したことを実行時間削減とは報告しない。

次位置：本単位のDPC専用CI→公開main成功→同一入力の非公開処理で重複が存在するか確認。残る4本とbuild-dpc-data.py残部はnot-migratedを維持。公式原本が未取得の項目を完了数に含めない。

## Facility原本の限定移行（2026-11-05）

出典：厚生労働省「令和６年度DPCの評価・検証等に係る調査『退院患者調査』の結果報告について」
https://www.mhlw.go.jp/stf/shingi2/newpage_00203.html
施設概要表（2026-06-30差替え）、https://www.mhlw.go.jp/content/12404000/001717940.xlsx を加工して抽出する。厚生労働省作成のJSONではない。
利用条件 https://www.mhlw.go.jp/chosakuken/index.html はPDL1.0、出典・加工表示が必要。公式掲載箇所と全2シートのセル文字列に別の第三者権利表示は認めなかった。権利不存在を保証する判断ではない。

694,194バイトとSHA-256が既存台帳に一致。取得日時はfacility-local-receipt.json。原本は一時取得のみでコミットしない。
元build-dpc-data.pyのGit blob 168d60fceea4dab39001120d84ef528b2bd8aef4からtext/code/load_facilitiesを本文変更なしで抽出した。実原本について元関数と移行関数の辞書全体一致を確認。6,372キーの中間結果（最終公開病院件数ではない）、JSON 1,193,650バイト。受入ハッシュを固定し、原本や抽出結果の変更は失敗とする。

限定実行：`python -m unittest discover -s stage2 -p 'test_facilities.py'`、`python stage2/run_facilities.py --source /path/to/facility.xlsx`。公開統計・URL・既存最終JSONは変更しない。最終出力にはmdc.xlsx、admission.xlsx、ambulance.xlsx、medical-area-municipalities.xlsx等が必要で、未取得のまま。80原本参照中2件照合済み、78件未取得。本変更では全体CIを避けるため[skip ci]を付け、ローカルDPC限定検証のみ実施する。

PR #17/#18統合：同一URL・サイズ・SHA-256のfacility原本は1件として計上する。18:44:42 JSTと19:06:55 JSTの取得は別の確認履歴としてinventory.jsonのacquisition_historyに保持する。詳細な訂正情報・PDL1.0・例外・外部リンク先を含まない権利確認範囲はPR #18から採用。施設抽出の移行と6,372キー一致はPR #17のreceiptを参照。照合済み2/80、未取得78を維持する。

## MDC原本の限定移行（2026-11-06）

厚生労働省「令和６年度DPCの評価・検証等に係る調査『退院患者調査』」参考資料２（１）MDC別医療機関別件数（割合）を加工して中間抽出する。厚生労働省作成のJSONではない。
掲載ページ：https://www.mhlw.go.jp/stf/shingi2/newpage_00203.html
原本：https://www.mhlw.go.jp/content/12404000/001718078.xlsx
利用条件：https://www.mhlw.go.jp/chosakuken/index.html （PDL1.0、出典・加工表示）。別紙の例外一覧に当該表はない。掲載箇所と全2シートを含むXMLテキストの権利関連語を確認し、別の第三者権利表示は認めなかった。外部リンク先や権利不存在の保証を含まない。

原本2,573,930バイト、SHA-256 `d2c86dfebc9eb7c6f99306c6b69e30d8aca6fc7ce7b690a3268f92bbf067e588` は期待値と一致、ZIP CRC正常。取得日時・確認範囲はinventoryとmdc-local-receiptに保存。原本は一時取得し、コミットやartifactに含めない。

変更→影響先→限定検証：原本台帳と独立MDC抽出→中間辞書のみ→原本ハッシュ、元Git blobの定数・関数本文一致、実原本での辞書全体一致、抽出結果ハッシュ、抑制値・手術有無・施設/医療圏結合の固定入力テスト。公開JSON・統計値・URLの変更はない。

`mdc.py` は既存Git blob `168d60fceea4dab39001120d84ef528b2bd8aef4` のMDC_NAMES/text/code/public_number/load_mdcを本文変更なしで抽出。load_mdcは施設辞書・医療圏対応辞書を引数に取る。単独受入では両方に空辞書を明示し、未結合の6,372キー（最終公開病院数ではない）、9,831,751バイト、SHA-256 `c6f62bf70d1838af5135145ac5bc94bd09b77c56369dcf8e38321b114e27994e` を元関数と全件一致確認した。この未結合結果を公開統計には使わない。関数の引数は維持し、施設・医療圏情報を与えた結合は固定入力テストで確認する。

実行：`python -m unittest discover -s stage2 -p 'test_mdc.py'`（3テスト成功）、`python stage2/run_mdc.py --source /path/to/mdc.xlsx`（実原本PASS）。ローカルDPC限定検証であり、Actions成功とは扱わない。コミットには `[skip ci]` を付け、既存の抱き合わせジョブも起動しない。

照合済み3/80、未取得77。history/2024-mdc.xlsxは同一原本の別名で二重計上しない。最終生成の残依存はadmission.xlsx、ambulance.xlsx、diagnosis-groups.xlsx、medical-area-municipalities.xlsx、およびmanifest用death24h.xlsx。施設・定義表は照合済み。過年度生成器等4本は引き続き未移行。残る77原本の取得・全体CI・公開成果物再生成は行っていない。
