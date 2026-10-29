# データ構成一覧（公開用）

整理日: 2026-10-28

公開画面と、その出典・収録範囲を確認するための案内である。過去の保全記録から公開に必要な情報を整理したもので、内部分析DBや保存原本の配布一覧ではない。最新の年度、対象地域、欠測・秘匿、定義は各画面の説明と配布データのメタデータで確認する。

| 分野 | 内容・解釈 | 公開先 |
|---|---|---|
| 任意期間標準化死亡比 | 観察死亡数・期待死亡数・SMR・95％信頼区間。住基方式と国勢調査基準方式、任意期間の試算と国公式5年値を区別 | https://municipal-smr.jp/ |
| 静的SMR JSON | 掲載条件一覧にある1条件のみ。未掲載条件は死亡0・欠測を意味しない | https://municipal-smr.jp/smr-json/v1/index.json |
| 人口ピラミッド | 人口実績、社人研将来推計、独自の参考推計を区別 | https://municipal-smr.jp/population/ |
| 年齢調整死亡率（JMD） | 全国・47都道府県の公表値。死因分類・性別・年次を選択 | https://municipal-smr.jp/jmd/ |
| 平均寿命 | 公表値と市町村の独自試算を区別 | https://municipal-smr.jp/life-expectancy/ |
| 介護保険 | 粗認定率、性・年齢調整値、給付費等。保険者と市町村の単位を混同しない | https://municipal-smr.jp/care/ |
| 生活習慣・栄養 | 国民健康・栄養調査等。欠測を0にしない | https://municipal-smr.jp/lifestyle/ |
| 学校保健 | 年齢・性別・都道府県ごとの学校保健統計。年度ごとの収録範囲を確認 | https://municipal-smr.jp/school-dental/ |
| NDB | 特定健診、医療提供量等。年度・集計地域・秘匿を確認 | https://municipal-smr.jp/ndb/ |
| DPC | 急性期入院医療の公表分。患者住所地、全入院患者、治療成績を示す値ではない | https://municipal-smr.jp/dpc/ |
| 精神保健福祉 | 衛生行政報告例等。指定都市の再掲を都道府県へ二重加算しない | https://municipal-smr.jp/mental-health/ |
| 生活保護 | 粗保護率・年齢調整値等。定義と集計単位を確認 | https://municipal-smr.jp/welfare/ |
| 食中毒 | 厚生労働省の発生状況・発生事例。総数と事件詳細を区別 | https://municipal-smr.jp/food-poisoning/ |

## 公開データと確認資料

画面用のJSON・gzipデータ、CSVやExcel等の公開ダウンロード、記事の再現コード・方法説明は、用途を確認した個別のパスで公開する。内部の検索・結合用分析DB、原本保存台帳、保守手順、開発メモは静的配信しない。

介護の公開データは https://municipal-smr.jp/care/data/manifest.json 、JMDの公開メタデータは https://municipal-smr.jp/data/jmd/meta.json で確認できる。学校保健等の出典・原表識別子は各画面と公開用の来歴文書を参照する。

来歴の過去の監査結果は「原資料来歴監査」、専門レビューの対象と利益相反は「専門レビュー結果」、利用者に関係する変更は「更新履歴」を参照する。収録がない項目、欠測、秘匿は別の状態として扱い、推測で補完しない。
