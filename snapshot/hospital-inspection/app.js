const CATEGORIES=['人事','診療体制','オンライン診療','個人情報','管理','施設・設備','給食','臨床検査','診療放射線','薬剤','医療機器'];
const SOURCES={
r8guide:['令和8年改正 立入検査要綱','https://www.mhlw.go.jp/content/10800000/001711282.pdf'],
r8annual:['令和8年度 立入検査実施通知','https://www.mhlw.go.jp/content/10800000/001711283.pdf'],
mhlwInspection:['厚労省 立入検査通知一覧','https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/i-anzen/tachiirikensa.html'],
medicalLaw:['医療法（e-Gov）','https://elaws.e-gov.go.jp/document?lawid=323AC0000000205'],
medicalRule:['医療法施行規則（e-Gov）','https://elaws.e-gov.go.jp/document?lawid=323M40000100050'],
cyber:['医療機関のサイバーセキュリティ対策','https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/johoka/cyber-security.html'],
privacy:['個人情報保護委員会 医療・介護ガイダンス','https://www.ppc.go.jp/personalinfo/legal/iryoukaigo_guidance/'],
online:['オンライン診療に関する厚労省資料','https://www.mhlw.go.jp/stf/index_0024.html']
};
const ITEMS=[
['hr1','人事','医療従事者の法定標準数を算定し、実人数と照合している','義務','医療法21条、医療法施行規則19条・21条','患者数、病床区分、常勤換算を同じ基準日で再計算できること。',['医療従事者名簿','勤務表','標準数算定表']],
['hr2','人事','採用時に医師・看護師等の免許証原本を確認している','義務','各医療関係職種法、医療法25条','写しの保管だけでなく、原本確認日と確認者を記録する。',['資格免許確認記録','医療従事者名簿']],
['hr3','人事','労働時間を客観的な方法で把握している','義務','労働基準法、労働安全衛生法、関係通知','勤務表、出退勤、時間外申請、宿日直中の実働の差異を確認する。',['就業規則','勤務表','出退勤記録','時間外労働記録']],
['hr4','人事','時間外・休日労働が月100時間以上となる見込みの医師への面接指導体制がある','義務','医療法108条、医療法施行規則','対象者の抽出、面接指導、就業上の措置と記録保存を確認する。',['面接指導実施要領','対象者抽出記録','面接指導記録']],
['hr5','人事','特例水準対象医師の勤務間インターバルと代償休息を管理している','条件付き義務','医療法、医療法施行規則','指定対象業務・医師を特定し、勤務予定と実績の双方で確認する。',['指定通知書','勤務間インターバル記録','代償休息管理簿'],'labor'],
['med1','診療体制','医療安全管理指針を策定し、実態に合わせて見直している','義務','医療法6条の12、医療法施行規則1条の11','最新版、承認手続、改訂履歴、院内周知を確認する。',['医療安全管理指針','改訂履歴','周知記録']],
['med2','診療体制','医療安全管理委員会を定期開催し、改善状況まで審議している','義務','医療法施行規則1条の11','事故件数の報告だけでなく、原因分析、対策、効果確認を議事録で追えること。',['委員会規程','医療安全管理委員会議事録']],
['med3','診療体制','医療安全研修を全職員に実施し、未受講者を補完している','義務','医療法施行規則1条の11','委託・派遣を含む対象範囲、出席、欠席者対応、研修内容を確認する。',['年間研修計画','研修資料','出席・未受講者対応記録']],
['med4','診療体制','インシデント等の報告、分析、再発防止、効果確認の仕組みがある','義務','医療法施行規則1条の11','報告しやすさ、重大度判断、管理者への報告、対策後評価を確認する。',['院内報告規程','報告様式','集計・分析資料','改善記録']],
['med5','診療体制','院内感染対策指針、委員会、研修、発生時対応を整備している','義務','医療法施行規則1条の11、院内感染対策通知','部署横断の監視、アウトブレイク判断、行政連絡を含めて確認する。',['院内感染対策指針','感染対策委員会議事録','研修記録','発生時連絡網']],
['med6','診療体制','身体拘束最小化の方針、判断手順、記録、解除検討が整備されている','適用確認','医療法・診療報酬関係規定、関係通知','対象患者ごとの必要性、代替手段、説明、継続時間、解除検討を確認する。',['身体拘束最小化指針','検討記録','職員研修記録']],
['med7','診療体制','意思決定支援と説明・同意の手順が整備されている','適用確認','医療法1条の4、関係ガイドライン','本人の意思、理解、家族等との関係、説明内容が記録されているか確認する。',['説明・同意に関する規程','意思決定支援指針','説明同意書式']],
['med8','診療体制','高難度新規医療技術・未承認新規医薬品等の審査体制がある','条件付き義務','医療法施行規則9条の20の2等','提供前の審査、説明、実施後報告の対象と手順を確認する。',['審査規程','審査委員会記録','対象技術等の台帳'],'special'],
['med9','診療体制','無痛分娩の急変対応、研修、情報公開を点検している','条件付き','厚生労働省通知・関係学会提言','麻酔担当、急変対応、搬送、研修実績、ウェブ公開内容を確認する。',['無痛分娩マニュアル','急変対応手順','研修記録','自主点検記録'],'epidural'],
['pi1','個人情報','個人情報の利用目的を特定・公表し、目的外利用を管理している','義務','個人情報保護法、医療・介護関係事業者ガイダンス','院内掲示、ウェブ表示、研究・教育利用の手続を確認する。',['個人情報保護規程','利用目的の院内掲示']],
['pi2','個人情報','アクセス権限、持出し、廃棄、漏えい時対応を定めている','義務','個人情報保護法、安全管理ガイダンス','権限棚卸し、媒体管理、事故連絡と報告判断の手順を確認する。',['情報安全管理規程','アクセス権限一覧','漏えい対応手順']],
['pi3','個人情報','個人データを扱う委託先を選定・監督している','義務','個人情報保護法25条','再委託、事故報告、監査、契約終了時の返却・消去まで確認する。',['委託先一覧','個人情報取扱契約','委託先確認記録']],
['mg1','管理','消防計画を整備し、消火・避難訓練を定期実施している','義務','消防法8条、消防法施行規則','夜間・休日の人員、避難困難患者の搬送を含む実効性を確認する。',['消防計画','訓練計画','訓練実施記録']],
['mg2','管理','災害・大規模障害時の事業継続計画と連絡体制がある','重要','医療法、災害対策関係通知','電力、水、医療ガス、通信、診療継続、復旧優先順位を確認する。',['事業継続計画','緊急連絡網','非常用設備点検記録']],
['mg3','管理','水害・土砂災害に係る避難確保計画と訓練を整備している','条件付き義務','水防法・土砂災害防止法','対象区域・施設への該当、行政提出、訓練記録を確認する。',['避難確保計画','提出記録','訓練記録'],'hazard'],
['mg4','管理','医療ガス、給水、非常電源、エレベーター等を保守管理している','義務・重要','医療法20条、医療ガス安全管理通知等','点検頻度、異常時対応、外部委託、改善完了を確認する。',['設備台帳','保守点検計画','点検・修理記録']],
['mg5','管理','感染性廃棄物等を分別・保管し、委託処理を追跡できる','義務','廃棄物処理法、感染性廃棄物処理マニュアル','保管場所、表示、マニフェスト、委託業者の許可を確認する。',['廃棄物管理規程','委託契約書','マニフェスト']],
['mg6','管理','医療情報システムの資産・接続先・委託先を把握している','義務','医療法施行規則14条2項、サイバーセキュリティ関係通知','端末・サーバー・IoT・VPN・クラウドと責任分界を一覧化する。',['情報資産台帳','ネットワーク構成図','委託先との責任分界表']],
['mg7','管理','多要素認証、脆弱性対策、バックアップ、復旧訓練を実施している','義務','医療法施行規則14条2項、医療情報システム安全管理ガイドライン','バックアップの取得だけでなく、隔離性と復元可能性を確認する。',['サイバーセキュリティチェックリスト','パッチ管理記録','バックアップ・復旧試験記録']],
['mg8','管理','許可・届出内容、院内掲示、実際の施設使用が一致している','義務','医療法7条・14条の2等','病室用途、病床数、診療科、管理者、掲示事項の不一致を確認する。',['開設許可書・届出控え','施設平面図','院内掲示一覧']],
['mg9','管理','東京都の防火・震災関係条例に基づく追加事項を確認している','地域固有','東京都火災予防条例、東京都震災対策条例','規模等に応じた防火管理技能者、事業所防災計画等を所轄消防署に確認する。',['東京都条例対応確認票','消防署への届出控え'],'tokyo'],
['fd1','給食','給食従事者の健康・衛生管理とHACCPに沿った管理を行っている','条件付き義務','食品衛生法、健康増進法、関係通知','検収、保管、加熱、配膳、保存食、清掃と記録を現場で確認する。',['給食衛生管理マニュアル','温度・検食・保存食記録','従事者健康記録'],'food'],
['fd2','給食','患者の食事指示から調理・配膳まで誤配防止策がある','条件付き重要','医療法、給食関係通知','食事箋、アレルギー、禁止食品、患者確認の連結を確認する。',['食事箋運用手順','アレルギー対応手順','誤配防止記録'],'food'],
['lab1','臨床検査','検体検査の精度確保責任者と標準作業書を整備している','条件付き義務','医療法15条の2、医療法施行規則9条の7等','作業書の対象検査、改訂、周知、実施との一致を確認する。',['検体検査精度確保規程','標準作業書','責任者選任記録'],'lab'],
['lab2','臨床検査','内部精度管理、外部精度管理、異常時是正を記録している','条件付き義務','医療法施行規則9条の7等','結果の評価だけでなく、不適合時の原因・是正・再確認を追う。',['内部精度管理記録','外部精度管理結果','是正記録'],'lab'],
['rad1','診療放射線','診療用放射線安全管理責任者と安全利用指針を整備している','条件付き義務','医療法施行規則1条の11','研修、線量管理、患者への説明を指針と実績で確認する。',['診療用放射線安全利用指針','責任者選任記録','研修記録'],'xray'],
['rad2','診療放射線','装置の届出、使用許可、漏えい線量測定、区域表示を管理している','条件付き義務','医療法15条、医療法施行規則24条以下','新設・移設・更新・廃止時の手続と現況を装置単位で照合する。',['放射線装置届出控え','使用許可書','漏えい線量測定記録','装置台帳'],'xray'],
['rad3','診療放射線','放射線従事者の被ばく線量と健康診断を管理している','条件付き義務','医療法施行規則、電離放射線障害防止規則','対象者登録、線量限度、異常値対応、配置変更時確認を行う。',['放射線従事者名簿','個人線量記録','健康診断記録'],'xray'],
['rad4','診療放射線','RI・PET等について医療法と放射性同位元素規制を両方確認している','条件付き義務','医療法施行規則、放射性同位元素等規制法','許可・届出、使用・保管・廃棄、汚染、緊急時措置を確認する。',['RI等許可・届出書','使用・保管・廃棄記録','緊急時対応手順'],'ri'],
['ph1','薬剤','医薬品安全管理責任者と安全使用のための業務手順書を整備している','義務','医療法施行規則1条の11','採用から投与・廃棄まで、院内実務と手順書の一致を確認する。',['医薬品安全使用手順書','責任者選任記録','研修記録']],
['ph2','薬剤','麻薬、向精神薬、毒薬・劇薬等の在庫・鍵・帳簿を管理している','義務','麻薬及び向精神薬取締法、医薬品医療機器等法','帳簿と実在庫、廃棄、事故時届出、鍵管理を確認する。',['麻薬等管理規程','受払簿','在庫点検記録','廃棄・事故届']],
['eq1','医療機器','医療機器安全管理責任者を配置し、職員研修を実施している','義務','医療法施行規則1条の11','新規導入時と継続研修の対象機器・対象職種・受講状況を確認する。',['責任者選任記録','医療機器研修計画・実績']],
['eq2','医療機器','医療機器の保守点検計画を作成し、実施・修理履歴を管理している','義務','医療法施行規則1条の11','生命維持管理装置等を優先し、委託分を含め未実施を把握する。',['医療機器台帳','保守点検計画','点検・修理記録']],
['eq3','医療機器','安全性情報・不具合情報を収集し、必要な措置を記録している','義務','医療法施行規則1条の11、医薬品医療機器等法','回収・改修情報の対象機器確認、使用停止、周知を追跡する。',['安全性情報管理記録','回収・改修対応記録']],
['hr6','人事','全職員の健康診断、安全衛生教育及び結核健康管理を実施している','法令・年度確認','労働安全衛生法、令和8年度立入検査実施通知','雇入れ時・定期健康診断の対象者と未受診者対応、安全衛生教育、結核検診を確認する。',['職員健康診断結果一覧','未受診者対応記録','安全衛生教育記録']],
['hr7','人事','産業医の選任とストレスチェックを適切に実施している','条件付き義務','労働安全衛生法、令和8年度立入検査実施通知','産業医の選任届・巡視・勧告対応と、ストレスチェックの実施体制を確認する。',['産業医選任届','産業医活動記録','ストレスチェック実施記録'],'largeworkplace'],
['hr8','人事','腰痛予防及び暴言・暴力・ハラスメント対策を整備している','年度確認','令和8年度立入検査実施通知','看護・介護業務の腰痛予防教育、暴言・暴力発生時の報告・支援・再発防止を確認する。',['腰痛予防教育記録','暴言・暴力対応手順','職員支援記録']],
['med10','診療体制','死亡・死産事例を管理者が速やかに把握し、医療事故該当性を組織的に判断している','義務','医療法6条の10、医療法施行規則1条の10の2等','全死亡・死産の把握、関係者聴取、判断者、判断理由、遺族申出への説明を記録で確認する。',['死亡・死産事例一覧','医療事故該当性判断手順','判断記録']],
['med11','診療体制','医療事故発生時の遺族説明、センター報告、院内調査及び結果報告の手順がある','義務','医療法6条の10・6条の11、令和8年改正立入検査要綱','遅滞ない報告、調査計画、検体保存、匿名性への配慮、結果報告前の遺族説明を確認する。',['医療事故調査制度対応規程','遺族説明記録','センター報告控え','院内事故調査報告書']],
['med12','診療体制','事故等事案を登録分析機関へ期限内に報告する体制がある','条件付き義務','医療法施行規則9条の20の2等、令和8年改正立入検査要綱','対象事案を抽出し、原則2週間以内に日本医療機能評価機構へ提出できることを確認する。',['事故等報告対象判定記録','登録分析機関への提出控え'],'accidentreport'],
['med13','診療体制','医療事故の再発防止提言を院内対策へ反映している','年度確認','令和8年度立入検査実施通知','該当する再発防止提言や医療安全情報を選定し、周知・手順変更・効果確認につなげているか確認する。',['再発防止提言確認記録','医療安全情報周知記録','対策評価記録']],
['med14','診療体制','手指衛生と個人防護具を含む標準予防策を実施している','年度確認','令和8年度立入検査実施通知、院内感染対策通知','現場観察、手指衛生資材、PPEの選択・着脱、遵守状況の評価を確認する。',['標準予防策マニュアル','手指衛生評価記録','PPE研修記録']],
['med15','診療体制','将来義務化される管理者等の医療事故対応研修を把握している','施行準備','令和8年厚生労働省令27号、令和8年度立入検査実施通知','対象施設・受講対象者を確認し、令和11年4月1日の施行に向けた受講計画を整理する。',['対象施設確認記録','管理者等研修受講計画']],
['on1','オンライン診療','オンライン診療の診療計画を作成し2年間保存している','条件付き確認','令和8年4月改訂オンライン診療指針、令和8年度立入検査実施通知','事前の対面診療による医学的評価、診療計画の内容、患者同意、2年間の保存を診療録等で確認する。',['オンライン診療計画','患者同意記録','診療録'],'online'],
['on2','オンライン診療','チャットのみの診療を行わず、本人確認・緊急時対応を整備している','条件付き確認','医師法20条、オンライン診療指針、令和8年度立入検査実施通知','映像・音声による診察、患者・医師の本人確認、対面切替・急変時対応を確認する。',['オンライン診療運用規程','本人確認手順','緊急時対応手順'],'online'],
['pi4','個人情報','漏えい等発生時に個人情報保護委員会への報告と本人通知を判断できる','義務','個人情報保護法26条、令和8年度立入検査実施通知','報告対象、速報・確報、本人通知、証拠保全、再発防止の判断手順を確認する。',['漏えい等対応手順','報告要否判断票','委員会報告・本人通知記録']],
['pi5','個人情報','診療情報開示の申立てを妨げず、合理的な手数料を設定している','年度確認','診療情報の提供等に関する指針、令和8年度立入検査実施通知','申請窓口、本人確認、非開示判断、回答期限、実費を勘案した手数料を確認する。',['診療情報開示規程','申請書式','手数料算定資料']],
['mg10','管理','死亡診断書・死体検案書を医師法に沿って適切に交付している','年度確認','医師法20条、令和8年度立入検査実施通知','診察後24時間を超えた場合を含む取扱い、記載確認、偽造等が疑われる場合の連絡手順を確認する。',['死亡診断書等作成手順','記載確認記録','警察連絡手順']],
['mg11','管理','病床の一時的超過使用と常態的な増床を区別して管理している','年度確認','医療法7条、医療法施行規則10条、令和8年度立入検査実施通知','緊急時の超過使用理由・期間・患者安全を記録し、常態化時は増床手続を行う。',['病床稼働記録','超過収容記録','増床許可・届出控え']],
['mg12','管理','石綿の使用状況を把握し、調査・ばく露防止措置を進めている','条件付き年度確認','令和7年3月31日医政発0331第8号、令和8年度立入検査実施通知','石綿含有可能性、分析状況、劣化・飛散のおそれ、立入禁止・除去等の対応を確認する。',['石綿使用実態調査回答','分析調査結果','ばく露防止措置記録'],'asbestos'],
['fac1','施設・設備','病室の定員・床面積・採光・換気・清潔が構造設備基準に適合している','義務','医療法21条、医療法施行規則16条、令和8年改正立入検査要綱','許可図面と現況、病床配置、有効床面積、採光換気、物品による支障を実測・目視で確認する。',['開設許可図面','病室面積一覧','施設巡視記録']],
['fac2','施設・設備','手術室・診察室・処置室等を用途に応じて区画・管理している','義務','医療法21条、医療法施行規則20条、令和8年改正立入検査要綱','許可された用途、清潔区域、必要設備、他用途との共用、物品保管状況を確認する。',['施設平面図','各室用途一覧','施設巡視記録']],
['fac3','施設・設備','廊下・階段・避難経路の幅員と安全を確保している','義務','医療法施行規則16条、建築基準法、消防法、令和8年改正立入検査要綱','有効幅員、手すり、段差、障害物、防火戸、避難方向表示を現場で確認する。',['施設平面図','避難経路図','防火設備点検記録']],
['fd3','給食','食中毒発生時にも患者給食を確保できる代替手段がある','年度確認','令和8年度立入検査実施通知','厨房停止時の代替調達、食種・アレルギー対応、連絡先、備蓄、訓練・机上確認を行う。',['食中毒発生時対応手順','代替給食協定・連絡先','非常食一覧'],'food'],
['rad5','診療放射線','放射線治療の照射条件をダブルチェックし線量を測定している','条件付き義務','医療法施行規則30条の18、令和8年度立入検査実施通知','治療計画・装置設定の独立確認、患者照合、線量測定、エラー時の停止・報告を確認する。',['放射線治療ダブルチェック記録','線量測定記録','治療装置品質管理記録'],'radiotherapy'],
['ph3','薬剤','医薬品業務手順書に基づく業務を投与段階まで定期確認している','義務・年度確認','医療法施行規則1条の11、令和8年度立入検査実施通知','処方、調剤、払出し、患者照合、投与、効果・副作用確認まで監査しているか確認する。',['医薬品業務定期確認記録','与薬監査記録','改善記録']],
['ph4','薬剤','医薬品の仕入先・包装・流通経路を確認し偽造品混入を防止している','年度確認','医薬品医療機器等法、令和8年度立入検査実施通知','取引先の許可、未開封・包装状態、異常品の隔離、行政連絡、手順書への反映を確認する。',['仕入先許可確認記録','医薬品納品検収記録','異常医薬品対応手順']],
['eq4','医療機器','PMDA等の緊急安全性情報を迅速に取得し院内対応している','年度確認','医薬品医療機器等法、令和8年度立入検査実施通知','情報の受信担当、対象製品の特定、使用停止・改修、関係部署への周知完了を追跡する。',['PMDA情報受信記録','対象製品確認記録','安全対策実施記録']],
['hr9','人事','職種別の資格・業務内容・常勤非常勤区分を正しく整理している','詳細確認','令和8年改正立入検査要綱 第1表','資格だけでなく主たる業務で職種を区分し、常勤・非常勤・常勤換算を確認する。',['職員名簿','資格免許確認記録','業務分掌表']],
['hr10','人事','当直・宿直・日直を含む勤務体制で必要な診療要員を確保している','詳細確認','医療法16条、令和8年改正立入検査要綱','診療時間外を含む医師・看護職員等の配置、連絡、応援体制を勤務実績と照合する。',['当直表','勤務実績','緊急連絡網']],
['hr11','人事','非常勤職員の常勤換算を勤務実績から再現できる','詳細確認','医療法施行規則19条・21条、立入検査要綱別紙','所定労働時間と実勤務時間を用い、複数施設勤務や休暇の扱いを統一して算定する。',['雇用契約書','勤務実績','常勤換算計算表']],
['med16','診療体制','患者相談に対応する窓口・責任者・記録・院内連携を整備している','詳細確認','医療法6条の13、令和8年改正立入検査要綱','相談の受付、担当部署への連携、回答、重大事項の管理者報告、相談者保護を確認する。',['患者相談窓口規程','相談受付台帳','対応記録']],
['med17','診療体制','手術・検査・輸血等の説明と同意を診療録で確認できる','詳細確認','医療法1条の4、令和8年度立入検査実施通知','目的、方法、代替案、主な危険、撤回可能性を説明し、質問・同意の過程を記録する。',['説明同意手順','同意書様式','診療録監査記録']],
['med18','診療体制','輸血療法の適応判断、患者照合、副作用対応を管理している','詳細確認','医療法施行規則1条の11、血液製剤使用指針','輸血前検査、ダブルチェック、実施中観察、副作用報告、血液製剤の追跡を確認する。',['輸血療法委員会記録','輸血実施手順','血液製剤管理台帳']],
['med19','診療体制','患者の急変・院内救急に対応する招集、機器、訓練体制がある','詳細確認','医療法施行規則1条の11、令和8年度立入検査実施通知','急変コード、応援要請、救急カート・AED、記録、振り返り、訓練実績を確認する。',['院内急変対応手順','救急カート点検表','急変対応訓練記録']],
['med20','診療体制','患者確認を複数の識別子で行い誤認を防止している','詳細確認','医療安全関係通知、令和8年度立入検査実施通知','採血、投薬、輸血、検査、手術、配膳の各場面で氏名以外を含む照合方法を確認する。',['患者確認手順','現場監査記録','誤認事例改善記録']],
['on3','オンライン診療','オンライン診療の適否を患者ごとに評価し対面診療へ切り替えている','条件付き詳細','オンライン診療の適切な実施に関する指針','症状、疾患、通信環境、緊急性から適否を判断し、不適切な場合の対面受診先を確保する。',['適否判断基準','対面切替記録','連携医療機関一覧'],'online'],
['on4','オンライン診療','オンライン診療における処方制限と本人確認を遵守している','条件付き詳細','オンライン診療の適切な実施に関する指針','初診時の処方、向精神薬等、基礎疾患情報、医師・患者の本人確認方法を診療録で確認する。',['オンライン処方手順','本人確認記録','診療録監査記録'],'online'],
['on5','オンライン診療','通信の安全性、プライバシー及び録音録画の取扱いを定めている','条件付き詳細','オンライン診療指針、医療情報システム安全管理ガイドライン','利用端末、通信経路、場所、第三者の同席、録音録画への同意、データ保存を確認する。',['情報セキュリティ運用手順','録音録画同意書','システム確認記録'],'online'],
['on6','オンライン診療','オンライン診療受診施設との責任分担と緊急対応を確認している','条件付き詳細','医療法、令和8年度立入検査実施通知','受診施設の届出・設備・補助者、患者急変時の対応、実施医療機関との連絡手順を確認する。',['受診施設届出控え','連携契約・役割分担表','緊急対応手順'],'online'],
['on7','オンライン診療','オンライン診療の実施状況を定期的に監査している','条件付き詳細','オンライン診療指針、令和8年度立入検査実施通知','計画作成率、対面切替、通信障害、苦情、インシデント、処方を定期確認する。',['オンライン診療監査記録','インシデント一覧','改善記録'],'online'],
['pi6','個人情報','電子診療情報へのアクセス記録を取得し定期点検している','詳細確認','個人情報保護法、安全管理ガイドライン','特権ID、退職者、時間外、大量閲覧等の不審操作を抽出し、対応記録を残す。',['アクセスログ点検記録','特権ID一覧','異常アクセス対応記録']],
['pi7','個人情報','紙媒体・画像・可搬媒体を保管期限後に安全に廃棄している','詳細確認','個人情報保護法、医療・介護ガイダンス','保管場所、持出し、廃棄承認、溶解・裁断、委託先証明を確認する。',['文書保存規程','廃棄記録','溶解・消去証明書']],
['mg13','管理','診療録等の必要事項と保存期間を文書種別ごとに管理している','詳細確認','医師法24条、医療法21条、医療法施行規則20条','診療録、処方箋、手術記録、看護記録、検査記録等の作成、訂正、保存、閲覧を確認する。',['文書保存規程','診療録監査記録','保存文書一覧']],
['mg14','管理','院内掲示事項を患者が見やすい場所に正しく表示している','詳細確認','医療法14条の2、医療法施行規則9条の3','管理者、診療科、診療時間、病床、食事、相談等の必要事項を現況と照合する。',['院内掲示一覧','掲示写真','許可届出控え']],
['mg15','管理','業務委託の範囲、受託者要件、実施状況を監督している','詳細確認','医療法15条の3、医療法施行規則9条の8以下','検体検査、給食、滅菌、患者搬送、保守等について契約、資格、報告、現場確認を行う。',['業務委託一覧','委託契約書','受託者確認・監査記録']],
['mg16','管理','患者・家族からの苦情を分析し改善へつなげている','詳細確認','医療安全関係通知、令和8年改正立入検査要綱','受付経路、初動、回答、重大事案の管理者報告、再発防止、相談者への不利益防止を確認する。',['苦情対応規程','苦情台帳','改善記録']],
['mg17','管理','盗難、乳児連れ去り、暴力等に対する院内保安体制がある','詳細確認','医療機関における安全管理体制関係通知','入退館、鍵、防犯設備、通報、警察連携、被害者支援、訓練を確認する。',['院内保安規程','入退館管理記録','防犯訓練記録']],
['mg18','管理','事業継続計画に基づく訓練と計画見直しを行っている','詳細確認','災害対策関係通知、令和8年度立入検査実施通知','停電、断水、通信障害、供給途絶、情報システム停止を想定し、訓練後に改善する。',['BCP','訓練記録','訓練後改善計画']],
['fac4','施設・設備','調剤所を衛生的に区画し必要な設備・保管場所を確保している','詳細確認','医療法21条、医療法施行規則20条','調剤区域、照明、換気、手洗い、温湿度、施錠保管、清掃状況を確認する。',['施設平面図','調剤所点検記録','温湿度記録']],
['fac5','施設・設備','臨床検査施設の作業区域・設備・衛生を確保している','条件付き詳細','医療法21条、医療法施行規則20条','検体受付、前処理、測定、保管、廃棄の動線と汚染防止、設備点検を確認する。',['検査室平面図','設備台帳','環境点検記録'],'lab'],
['fac6','施設・設備','給食施設の汚染・非汚染動線と設備を適切に管理している','条件付き詳細','医療法施行規則20条、食品衛生法','検収、下処理、調理、盛付、配膳、洗浄の交差防止と防虫防鼠を確認する。',['厨房平面図','衛生巡視記録','防虫防鼠記録'],'food'],
['fac7','施設・設備','洗浄・消毒・滅菌区域を区分し工程を管理している','詳細確認','医療法施行規則20条、院内感染対策通知','汚染物の回収から洗浄、包装、滅菌、保管までの一方向性と工程記録を確認する。',['滅菌業務手順','滅菌器運転記録','インジケータ記録']],
['fac8','施設・設備','集中治療室等の設備・医療ガス・非常電源を点検している','条件付き詳細','医療法施行規則20条、医療機器安全管理通知','病床配置、監視装置、吸引・酸素、非常電源、感染対策、緊急時応援を確認する。',['集中治療室設備台帳','始業点検記録','非常電源試験記録'],'icu'],
['fac9','施設・設備','霊安室を診療区域と区分し衛生・尊厳・動線に配慮している','詳細確認','医療法施行規則20条、令和8年改正立入検査要綱','換気、清掃、施錠、搬送動線、遺体識別、面会時のプライバシーを確認する。',['霊安室管理手順','清掃記録','遺体識別記録']],
['fac10','施設・設備','給水設備と飲料水の衛生・非常時供給を管理している','詳細確認','水道法、建築物衛生法、災害対策関係通知','受水槽、残留塩素、水質検査、清掃、断水時の必要量と供給先を確認する。',['水質検査結果','受水槽清掃記録','非常用水計画']],
['fac11','施設・設備','医療ガス設備の保守点検と工事後確認を実施している','詳細確認','医療ガス安全管理通知、令和8年度立入検査実施通知','供給源、配管端末、警報、ボンベ、誤接続防止、工事後の使用前確認を記録で追う。',['医療ガス安全管理委員会記録','保守点検記録','工事後確認記録']],
['fd4','給食','患者ごとの栄養管理計画と食事指示を診療・調理へ連結している','条件付き詳細','医療法、健康増進法、病院給食関係通知','栄養評価、医師指示、食形態、アレルギー、変更・中止が厨房まで正確に伝わるか確認する。',['栄養管理計画','食事箋','食事変更記録'],'food'],
['fd5','給食','食品の検収・温度・保存食・検食を記録している','条件付き詳細','食品衛生法、大量調理施設衛生管理マニュアル','納品状態、冷蔵冷凍温度、加熱冷却、保存食量・期間、検食者・結果を確認する。',['検収記録','温度記録','保存食記録','検食簿'],'food'],
['lab3','臨床検査','検査工程、試薬、機器、結果報告の作業日誌・台帳を整備している','条件付き詳細','医療法施行規則9条の7等、令和8年改正立入検査要綱','検体受領、測定、再検、結果確認、報告、試薬ロット、機器異常を追跡できるか確認する。',['検査作業日誌','試薬管理台帳','検査機器保守台帳'],'lab'],
['lab4','臨床検査','異常値・パニック値を迅速かつ確実に診療側へ連絡している','条件付き詳細','検体検査精度確保関係通知','基準、連絡先、復唱、連絡時刻、受領者、未連絡時のエスカレーションを確認する。',['パニック値一覧','緊急連絡手順','連絡記録'],'lab'],
['rad6','診療放射線','患者ごとの医療被ばく線量を記録し最適化している','条件付き詳細','医療法施行規則1条の11、診療用放射線安全利用通知','対象検査、線量指標、診断参考レベルとの比較、過大線量時の評価を確認する。',['患者線量記録','線量評価資料','最適化検討記録'],'xray'],
['rad7','診療放射線','管理区域への立入り、標識、放射線測定を管理している','条件付き詳細','医療法施行規則30条の16以下','区域境界、標識、施錠、立入者、漏えい線量、測定器校正、異常時措置を確認する。',['管理区域図','立入記録','放射線測定記録'],'xray'],
['ph5','薬剤','医薬品の温度・期限・配置・施錠を定期点検している','詳細確認','医薬品医療機器等法、医療法施行規則1条の11','冷所品、救急薬、病棟配置薬、期限切れ、類似名称薬、高濃度薬の管理を確認する。',['医薬品保管点検表','温度記録','期限管理記録']],
['ph6','薬剤','麻薬等の受払、在庫、廃棄、事故届を相互確認している','詳細確認','麻薬及び向精神薬取締法','帳簿と現品を定期照合し、廃棄立会い、破損・紛失時の届出、鍵管理を確認する。',['麻薬帳簿','在庫照合記録','廃棄届・事故届']],
['ph7','薬剤','副作用・感染症等の安全性情報を収集し必要な報告を行っている','詳細確認','医薬品医療機器等法68条の10、令和8年度立入検査実施通知','院内報告、重篤性評価、PMDA報告、患者対応、類似事例防止を確認する。',['副作用報告手順','PMDA報告控え','安全対策記録']],
['eq5','医療機器','生命維持管理装置等の優先機器を定め始業・終業点検している','詳細確認','医療法施行規則1条の11、医療機器安全管理通知','人工呼吸器、除細動器、輸液ポンプ等の点検項目、異常時隔離、代替機確保を確認する。',['優先医療機器一覧','始業終業点検表','代替機一覧']],
['eq6','医療機器','貸出・リース・外部保守の機器も院内台帳で一元管理している','詳細確認','医療機器安全管理通知','所有形態にかかわらず機器識別、所在、保守期限、故障・回収対応を追跡する。',['医療機器台帳','リース契約書','外部保守報告書']]
].map(x=>({id:x[0],category:x[1],title:x[2],level:x[3],basis:x[4],verify:x[5],docs:x[6],condition:x[7]||null}));

const DETAIL_ONLY=new Set(['hr9','hr10','hr11','med16','med17','med18','med19','med20','on3','on4','on5','on6','on7','pi6','pi7','mg13','mg14','mg15','mg16','mg17','mg18','fac4','fac5','fac6','fac7','fac8','fac9','fac10','fac11','fd4','fd5','lab3','lab4','rad6','rad7','ph5','ph6','ph7','eq5','eq6']);

const ITEM_REFS={
hr1:['r8guide','medicalLaw','medicalRule'],hr2:['r8guide'],hr3:['r8annual'],hr4:['r8guide','r8annual'],hr5:['r8guide','r8annual'],hr6:['r8annual'],hr7:['r8annual'],hr8:['r8annual'],
med1:['r8guide','r8annual','medicalRule'],med2:['r8guide','r8annual'],med3:['r8guide','r8annual'],med4:['r8guide','r8annual'],med5:['r8guide','r8annual'],med6:['r8annual'],med7:['r8annual'],med8:['r8guide'],med9:['r8annual'],med10:['r8guide','r8annual','medicalLaw'],med11:['r8guide','r8annual','medicalLaw'],med12:['r8guide'],med13:['r8annual'],med14:['r8annual'],med15:['r8annual','medicalRule'],
on1:['r8annual','online'],on2:['r8annual','online'],pi1:['r8annual','privacy'],pi2:['r8annual','privacy'],pi3:['privacy'],pi4:['r8annual','privacy'],pi5:['r8annual','privacy'],
mg1:['r8annual'],mg2:['r8annual'],mg3:['r8annual'],mg4:['r8guide','r8annual'],mg5:['r8annual'],mg6:['r8annual','cyber','medicalRule'],mg7:['r8annual','cyber'],mg8:['r8guide','medicalLaw'],mg9:['r8annual'],mg10:['r8annual'],mg11:['r8annual','medicalLaw','medicalRule'],mg12:['r8annual'],
fac1:['r8guide','medicalLaw','medicalRule'],fac2:['r8guide','medicalRule'],fac3:['r8guide'],fd1:['r8guide','r8annual'],fd2:['r8annual'],fd3:['r8annual'],lab1:['r8guide'],lab2:['r8guide'],rad1:['r8guide','r8annual'],rad2:['r8guide'],rad3:['r8guide'],rad4:['r8guide'],rad5:['r8guide','r8annual'],ph1:['r8guide','r8annual'],ph2:['r8guide','r8annual'],ph3:['r8annual'],ph4:['r8annual'],eq1:['r8guide','r8annual'],eq2:['r8guide'],eq3:['r8annual'],eq4:['r8annual']
};

const CONDITION_KEYS=['special','labor','lab','food','xray','ri','epidural','hazard','online','radiotherapy','asbestos','largeworkplace','accidentreport','icu'];
const allConditions=()=>Object.fromEntries(CONDITION_KEYS.map(k=>[k,true]));
const KEY='hospital-inspection-v1';let state={conditions:allConditions(),statuses:{},docStatuses:{},docsPendingOnly:false,category:'すべて',mode:'quick',conditionSelectionSet:true};
const $=id=>document.getElementById(id);const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function load(){try{const v=JSON.parse(localStorage.getItem(KEY));if(v&&v.statuses){state={...state,...v,docStatuses:v.docStatuses||{}};if(!v.conditionSelectionSet)state.conditions=allConditions();if(v.region==='tokyo')state.conditions.tokyo=true;delete state.region;state.conditionSelectionSet=true;}}catch(_){}}
function save(){localStorage.setItem(KEY,JSON.stringify(state));}
function inMode(item){return state.mode==='detail'||!DETAIL_ONLY.has(item.id);}
function applies(item){if(item.condition)return !!state.conditions[item.condition];return true;}
function visibleItems(){const q=$('search').value.trim().toLowerCase(),f=$('statusFilter').value;return ITEMS.filter(inMode).filter(applies).filter(i=>state.category==='すべて'||i.category===state.category).filter(i=>!q||[i.title,i.category,i.basis,i.verify,...i.docs].join(' ').toLowerCase().includes(q)).filter(i=>f==='all'||(state.statuses[i.id]||'todo')===f||(f==='issue'&&state.statuses[i.id]==='partial'));}
function renderNav(){const modeItems=ITEMS.filter(inMode),counts=Object.fromEntries(CATEGORIES.map(c=>[c,modeItems.filter(i=>applies(i)&&i.category===c).length])),totals=Object.fromEntries(CATEGORIES.map(c=>[c,modeItems.filter(i=>i.category===c).length]));$('categoryNav').innerHTML=['すべて',...CATEGORIES].map(c=>{const n=c==='すべて'?modeItems.filter(applies).length:counts[c],label=c!=='すべて'&&n===0&&totals[c]>0?`${c} 条件選択で${totals[c]}項目`:`${c} ${n}`;return `<button type="button" data-category="${c}" class="${state.category===c?'active':''}">${label}</button>`}).join('');document.querySelectorAll('[data-category]').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.category;save();render();}));}
function sourceLinks(id){const item=ITEMS.find(i=>i.id===id),fallback=item?.category==='オンライン診療'?['r8annual','online']:item?.category==='個人情報'?['r8annual','privacy']:item?.category==='管理'&&id==='mg6'?['r8annual','cyber']:['r8guide','r8annual'];return (ITEM_REFS[id]||fallback).map(key=>{const s=SOURCES[key];return `<a href="${s[1]}" target="_blank" rel="noopener">${escapeHtml(s[0])}</a>`}).join('');}
function renderChecklist(){const rows=visibleItems(),empty=$('emptyState');empty.hidden=rows.length>0;if(!rows.length)empty.textContent=state.category!=='すべて'&&ITEMS.filter(inMode).some(i=>i.category===state.category&&i.condition)?`「施設条件」で該当する機能・設備を選ぶと、${state.category}の点検項目が表示されます。`:'検索・表示条件に一致する項目はありません。';$('checklist').innerHTML=rows.map(i=>{const status=state.statuses[i.id]||'todo';return `<article class="check-item" data-status="${status}"><div class="item-head"><div><h3>${escapeHtml(i.title)}</h3><div class="tags"><span class="tag">${i.category}</span><span class="tag ${i.level.includes('義務')?'required':''}">${i.level}</span></div></div><label>判定<select data-status-id="${i.id}"><option value="todo" ${status==='todo'?'selected':''}>未確認</option><option value="ok" ${status==='ok'?'selected':''}>適合</option><option value="partial" ${status==='partial'?'selected':''}>一部不備</option><option value="issue" ${status==='issue'?'selected':''}>不適合</option><option value="na" ${status==='na'?'selected':''}>対象外</option></select></label></div><div class="item-body"><div class="detail"><b>根拠</b><p>${escapeHtml(i.basis)}</p></div><div class="detail"><b>確認方法</b><p>${escapeHtml(i.verify)}</p></div><div class="detail"><b>適用</b><p>${i.condition?`施設条件「${conditionLabel(i.condition)}」に該当`:'原則として共通'}</p></div></div><div class="source-links"><b>公式根拠</b>${sourceLinks(i.id)}</div><div class="docs"><b>確認資料</b><ul>${i.docs.map(d=>`<li>${escapeHtml(d)}</li>`).join('')}</ul></div></article>`}).join('');document.querySelectorAll('[data-status-id]').forEach(s=>s.addEventListener('change',()=>{state.statuses[s.dataset.statusId]=s.value;save();render();}));}
function conditionLabel(k){return {special:'特定機能病院',labor:'特定労務管理対象機関',lab:'院内検体検査',food:'院内給食',xray:'X線・CT等',ri:'RI・PET等',epidural:'無痛分娩',hazard:'浸水・土砂災害区域',online:'オンライン診療',radiotherapy:'放射線治療装置',asbestos:'石綿調査・対応対象',largeworkplace:'常時50人以上',accidentreport:'事故等報告病院',icu:'ICU・HCU等'}[k]||k;}
function renderSummary(){const target=ITEMS.filter(inMode).filter(applies),counts={ok:0,partial:0,issue:0,todo:0,na:0};target.forEach(i=>counts[state.statuses[i.id]||'todo']++);$('targetCount').textContent=target.length;$('okCount').textContent=counts.ok;$('issueCount').textContent=counts.issue+counts.partial;$('todoCount').textContent=counts.todo;const done=target.length-counts.todo-counts.na;$('progressValue').textContent=target.length?Math.round(done/target.length*100)+'%':'0%';}
function currentDocs(){return [...new Set(ITEMS.filter(inMode).filter(applies).flatMap(i=>i.docs))].sort((a,b)=>a.localeCompare(b,'ja'));}
function renderDocs(){const all=currentDocs(),prepared=all.filter(d=>state.docStatuses[d]).length,docs=state.docsPendingOnly?all.filter(d=>!state.docStatuses[d]):all;$('docsCount').textContent=`準備済み ${prepared}／${all.length}`;$('pendingDocsOnly').checked=!!state.docsPendingOnly;$('documents').innerHTML=docs.map((d,index)=>`<label class="document-item ${state.docStatuses[d]?'prepared':''}"><input type="checkbox" data-doc-index="${index}" ${state.docStatuses[d]?'checked':''}><span>${escapeHtml(d)}</span></label>`).join('')||'<p class="documents-empty">表示条件に該当する未準備書類はありません。</p>';document.querySelectorAll('[data-doc-index]').forEach(input=>input.addEventListener('change',()=>{state.docStatuses[docs[Number(input.dataset.docIndex)]]=input.checked;save();renderDocs();}));}
function renderMode(){document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));$('modeHelp').textContent=state.mode==='detail'?`国要綱の検査基準・構造設備を細分化した全${ITEMS.length}項目から、施設条件に該当する項目を表示します。`:`主要事項${ITEMS.length-DETAIL_ONLY.size}項目から、施設条件に該当する項目を表示します。`;}
function render(){renderMode();renderNav();renderChecklist();renderSummary();renderDocs();}
function syncControls(){document.querySelectorAll('[data-condition]').forEach(x=>x.checked=!!state.conditions[x.dataset.condition]);}
function exportData(){const blob=new Blob([JSON.stringify({format:'hospital-inspection-v1',exportedAt:new Date().toISOString(),...state},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`hospital-inspection-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);}
load();syncControls();render();
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.mode;save();render();}));document.querySelectorAll('[data-condition]').forEach(x=>x.addEventListener('change',()=>{state.conditions[x.dataset.condition]=x.checked;if(x.dataset.condition==='ri'&&x.checked)state.conditions.xray=true;if(x.dataset.condition==='radiotherapy'&&x.checked)state.conditions.xray=true;syncControls();save();render();}));$('selectAllConditions').addEventListener('click',()=>{const tokyo=!!state.conditions.tokyo;state.conditions={...allConditions(),tokyo};syncControls();save();render();});$('clearAllConditions').addEventListener('click',()=>{const tokyo=!!state.conditions.tokyo;state.conditions=tokyo?{tokyo:true}:{};syncControls();save();render();});$('pendingDocsOnly').addEventListener('change',e=>{state.docsPendingOnly=e.target.checked;save();renderDocs();});$('prepareAllDocs').addEventListener('click',()=>{currentDocs().forEach(d=>state.docStatuses[d]=true);save();renderDocs();});$('clearAllDocs').addEventListener('click',()=>{currentDocs().forEach(d=>delete state.docStatuses[d]);save();renderDocs();});$('search').addEventListener('input',renderChecklist);$('statusFilter').addEventListener('change',renderChecklist);$('printBtn').addEventListener('click',()=>print());$('exportBtn').addEventListener('click',exportData);$('importInput').addEventListener('change',async e=>{try{const v=JSON.parse(await e.target.files[0].text());if(v.format!=='hospital-inspection-v1')throw new Error();state={...state,...v,docStatuses:v.docStatuses||{},conditionSelectionSet:true};delete state.region;delete state.format;delete state.exportedAt;save();syncControls();render();}catch(_){alert('このツールで保存した点検データを選んでください。')}e.target.value='';});$('resetBtn').addEventListener('click',()=>{if(confirm('この端末に保存した点検結果をすべて消去しますか？')){localStorage.removeItem(KEY);state={conditions:allConditions(),statuses:{},docStatuses:{},docsPendingOnly:false,category:'すべて',mode:'quick',conditionSelectionSet:true};syncControls();render();}});$('toggleSetup').addEventListener('click',()=>{const p=$('setupPanel'),hidden=p.hidden;p.hidden=!hidden;$('toggleSetup').textContent=hidden?'条件を閉じる':'条件を開く';});
