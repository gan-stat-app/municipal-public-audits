# 調剤行為・標準化比の原表

## NDBオープンデータ

| 年度 | 系列 | ファイル | SHA-256 | 出典 |
|---|---|---|---|---|
| 2022 | 算定回数・性年齢別 | `2022/count-age-sex.xlsx` | `74d883505f5874b80966e1826cf91065db1834aa95b098411ac92e64bd584b5a` | 第9回NDB |
| 2022 | 算定回数・都道府県別 | `2022/count-prefecture.xlsx` | `90fd869eda820649446b3f1e008066898cd60c0f8855014049898c97dc4297aa` | 第9回NDB |
| 2022 | 患者数・性年齢別 | `2022/patients-age-sex.xlsx` | `e7d31505db8d5af43df11c7b8cd0234959da576211dcf3b71a5fa260d064cc7f` | 第9回NDB |
| 2022 | 患者数・都道府県別 | `2022/patients-prefecture.xlsx` | `a357023cdadcf1866acc97019cb27c762ee80166ad4fcc097246348337a322f3` | 第9回NDB |
| 2023 | 算定回数・性年齢別 | `2023/count-age-sex.xlsx` | `cdac2d361e1dfa43db960f378a5ca49840348c6b4f923c2d2f93be6bfcfcfe9d` | 第10回NDB |
| 2023 | 算定回数・都道府県別 | `2023/count-prefecture.xlsx` | `37061c46a4b5c2058b21d5047972dbab681792c038ef011692364ba567e864fc` | 第10回NDB |
| 2023 | 患者数・性年齢別 | `2023/patients-age-sex.xlsx` | `1064761452ee74fb7f985565b4bc615f8a9b8963c4b5714a864a603a24b1cebf` | 第10回NDB |
| 2023 | 患者数・都道府県別 | `2023/patients-prefecture.xlsx` | `236a91b06d74d9c511a250f21d4a06b105035d790144bc6f41984a06a3800b86` | 第10回NDB |
| 2024 | 算定回数一式 | `2024/counts.zip` | `56ab61ad2465845b107f57842853a6af4ded0a73012ae1a6b40690b2c9e91c8e` | 第11回NDB（公費含む） |
| 2024 | 患者数一式 | `2024/patients.zip` | `a33405aa68eb16b34596cc9c8749a26452533141ee498d289438c05858063cf7` | 第11回NDB（公費を含まない） |

第9回: <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000177221_00014.html>  
第10回: <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000177221_00016.html>  
第11回: <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000177221_00017.html>

## 標準人口

- `../population/population-2024-table10.xlsx`
- 総務省統計局「人口推計」第10表（2024年10月1日現在）
- SHA-256: `01eb89479ecfe24b072c6bd5e93a3d34efbb1bc7c1f7cba1aba0fe1ad9d14c53`
- 出典: <https://www.e-stat.go.jp/stat-search/files?layout=datalist&lid=000001457290&page=1>

人口表の公表区分に合わせ、NDBの85～89歳と90歳以上は、生成時に85歳以上へ統合する。
