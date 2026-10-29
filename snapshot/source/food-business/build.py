"""Build the isolated, reproducible food-business database and static pages."""
import argparse
import gzip
import html
import json
import shutil
import sqlite3
import sys
from collections import Counter
from pathlib import Path
import model

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
DATA=ROOT/'data/food-business'
SNAPSHOTS=DATA/'snapshots'
PUBLIC=ROOT/'food-business'

def read(path):return json.loads(path.read_text(encoding='utf-8'))
def gzread(path):return json.loads(gzip.decompress(path.read_bytes()))
def put(path,b,check=False):
    if isinstance(b,str):b=b.encode('utf-8')
    if check:
        if not path.is_file() or path.read_bytes()!=b:raise ValueError(f'Generated output differs: {path.relative_to(ROOT)}')
    else:path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b)
def json_gz(obj):return gzip.compress((model.dumps(obj)+'\n').encode(),mtime=0)
def e(s):return html.escape(str(s),quote=True)

def import_acquisitions(files,snapshot_id):
    sources={s['id']:s for s in read(HERE/'sources.json')['sources']}
    results=[a for p in files for a in read(Path(p))]
    members=[];failures=[]
    for a in results:
        s=sources[a['source_id']]
        if 'error' in a:failures.append(a);continue
        raw=Path(a['original'])
        if not raw.is_absolute():raw=ROOT/raw if not str(raw).startswith('repo/') else ROOT/Path(*raw.parts[1:])
        b=gzip.decompress(raw.read_bytes())
        if len(b)!=a['bytes'] or model.sha(b)!=a['sha256']:raise ValueError('Original bytes/hash mismatch')
        try:rows,qa=model.normalize(b,s)
        except (ValueError,KeyError) as exc:
            failures.append({'source_id':s['id'],'error':'normalization: '+str(exc),'original':str(raw.relative_to(ROOT)),'sha256':a['sha256']});continue
        source_meta={k:s[k] for k in ('id','publisher','publisher_type','prefecture_code','authority_code','scope','page','url','parser','license','license_url','format')}
        # County fiscal-year lists have month sheets, not a dated active registry.
        source_meta['as_of']=None if s['parser']=='akita-pref' else a['as_of']
        source_meta['source_id']=s['id']
        if s.get('period_start'):source_meta['period_start']=s['period_start']
        source_meta['fetched_at']=a['fetched_at']
        source_meta['original']=str(raw.relative_to(ROOT))
        source_meta['original_sha256']=a['sha256'];source_meta['original_bytes']=a['bytes']
        path=SNAPSHOTS/snapshot_id/(s['id']+'.json.gz')
        payload={'schema_version':1,'snapshot_id':snapshot_id,'source':source_meta,'qa':qa,'records':rows}
        put(path,json_gz(payload))
        members.append({'source_id':s['id'],'path':str(path.relative_to(ROOT)),'sha256':model.sha(path.read_bytes()),'record_count':len(rows),'as_of':source_meta['as_of']})
    manifest={'schema_version':1,'snapshot_id':snapshot_id,'collection_date':snapshot_id,'sources':members,'failures':failures,
        'counting_unit':'published administrative record, not distinct physical establishment',
        'cross_domain_database':'separate; not joined to ai-data/v3'}
    put(SNAPSHOTS/snapshot_id/'manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return manifest

def load_history():
    history={};manifests=[]
    for p in sorted(SNAPSHOTS.glob('*/manifest.json')):
        m=read(p);manifests.append(m)
        for member in m['sources']:
            f=ROOT/member['path'];b=f.read_bytes()
            if model.sha(b)!=member['sha256']:raise ValueError(f'Snapshot hash differs: {f}')
            history.setdefault(member['source_id'],[]).append((m,member,f))
    if not manifests:raise ValueError('No saved source snapshots')
    return manifests,history

def database(history,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():path.unlink()
    con=sqlite3.connect(path)
    con.executescript('''
    PRAGMA user_version=1;
    CREATE TABLE sources(source_id TEXT PRIMARY KEY, publisher TEXT, prefecture_code TEXT, authority_code TEXT, scope TEXT, metadata_json TEXT);
    CREATE TABLE snapshots(snapshot_id TEXT,source_id TEXT,as_of TEXT,original_sha256 TEXT,record_count INTEGER,qa_json TEXT,PRIMARY KEY(snapshot_id,source_id));
    CREATE TABLE records(snapshot_id TEXT,source_id TEXT,record_key BLOB,record_kind TEXT,facility_name TEXT,facility_address TEXT,business_type TEXT,permit_number TEXT,permit_date TEXT,valid_from TEXT,valid_until TEXT,closed_on TEXT,business_detail TEXT,first_permit_date TEXT,application TEXT,notification_date TEXT,source_row TEXT,date_issues_json TEXT,PRIMARY KEY(snapshot_id,source_id,record_key)) WITHOUT ROWID;
    CREATE INDEX by_source ON records(source_id,snapshot_id,record_kind);
    CREATE INDEX by_name ON records(facility_name);
    CREATE VIEW latest_records AS SELECT r.* FROM records r WHERE r.snapshot_id=(SELECT MAX(s.snapshot_id) FROM snapshots s WHERE s.source_id=r.source_id);
    ''')
    count=0
    for source_id,versions in sorted(history.items()):
        s=gzread(versions[-1][2])['source']
        con.execute('INSERT INTO sources VALUES(?,?,?,?,?,?)',(source_id,s['publisher'],s['prefecture_code'],s['authority_code'],s['scope'],model.dumps(s)))
        for m,member,path_in in versions:
            p=gzread(path_in)
            s=p['source'];sid=m['snapshot_id']
            con.execute('INSERT INTO snapshots VALUES(?,?,?,?,?,?)',(sid,source_id,s['as_of'],s['original_sha256'],len(p['records']),model.dumps(p['qa'])))
            con.executemany('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[(sid,source_id,bytes.fromhex(r['key']),*[r[f] for f in ('record_kind','facility_name','facility_address','business_type','permit_number','permit_date','valid_from','valid_until','closed_on','business_detail','first_permit_date','application','notification_date','source_row')],model.dumps(r['date_issues'])) for r in p['records']])
            count+=len(p['records'])
    con.commit()
    assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert con.execute('SELECT COUNT(*) FROM records').fetchone()[0]==count
    con.close()
    return count

def shell(title,description,route,body):
    return f'''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(title)}｜全国市町村別標準化死亡比</title><meta name="description" content="{e(description)}"><link rel="canonical" href="https://municipal-smr.jp{route}"><link rel="stylesheet" href="/food-business/style.css"></head><body><header><a href="/">全国市町村別標準化死亡比</a><nav><a href="/food-business/">食品営業許可・届出</a><a href="/analysis/food-business/">毎月の記録</a><a href="/analysis/">解説記事</a></nav></header><main>{body}</main><footer>出典となる公表情報を加工して掲載しています。掲載状況と実際の営業状況は一致しない場合があります。</footer></body></html>\n'''

def article(payload,previous=None):
    s=payload['source'];qa=payload['qa'];rows=payload['records'];sid=payload['snapshot_id'];source_id=s['source_id']
    title=f'{s["publisher"]}の食品営業許可・届出情報'
    route=f'/analysis/food-business/{source_id}/{sid}/'
    detail='許可を受けている全施設数や新規開店数を表すものではありません。'
    if s['scope']=='fiscal_year_new_permits_and_notifications':detail='県型保健所が公表した年度内の新規許可・届出一覧です。現在営業中の全施設数は算出していません。'
    stats=f'<p class="lead">掲載情報は{len(rows):,}件。許可情報{qa["permit_count"]:,}件、届出情報{qa["notification_count"]:,}件を収録しました。</p>'
    date_note=f'資料の基準日：{s["as_of"]}' if s['as_of'] else f'{s.get("period_start",sid)[:4]}年度の新規一覧（資料ごとの掲載月を保持）'
    comparison='<h2>今回を比較の基準にする</h2><p>この公開元の初回保存です。次の版から掲載追加・掲載消失・記載変更を比較します。</p>'
    diff=None
    if previous and previous['source']['original_sha256']!=s['original_sha256']:
        try:diff=model.compare(previous['records'],rows,previous['source'],s)
        except ValueError:comparison='<h2>比較条件を確認する</h2><p>資料の基準日や対象年度・収録範囲が変わったため、通常の前月差分を作成していません。</p>'
        else:
            c=diff['counts'];comparison=f'<h2>前回からの掲載の変化</h2><p>掲載追加{c.get("added",0):,}件、掲載消失{c.get("removed",0):,}件、記載変更{c.get("changed",0):,}件。</p><p>新規開店・閉店の確認件数ではありません。同名・同所在地・同業種の許可入替候補は{diff["permit_replacement_candidates"]:,}組です。</p><p><a href="changes.json">全差分をJSONで保存</a></p>'
    elif previous:comparison='<h2>前回から掲載内容の変更なし</h2><p>取得した原本のバイト列は前回と一致しました。</p>'
    review_path=HERE/'reviews'/f'{sid}.json'
    if diff and review_path.is_file():
        review=read(review_path)
        audited=next((x for x in review['series'] if x['source_id']==source_id),None)
        if audited and audited['status']=='changed_records':
            assert audited['after_sha256']==s['original_sha256']
            assert audited['before_sha256']==previous['source']['original_sha256']
            title=f'{s["publisher"]}の食品営業情報：掲載追加{diff["counts"].get("added",0)}件'
            stats=f'<p class="lead">{previous["snapshot_id"]}保存版と{sid}保存版を比較し、掲載情報は{len(previous["records"]):,}件から{len(rows):,}件になりました。追加分は原本のシート・行と照合しています。</p>'
            entries=[]
            labels={'added':'掲載追加','removed':'掲載消失','changed':'記載変更'}
            for change in diff['changes']:
                r=change.get('after') or change['before']
                entries.append('<tr>'+''.join(f'<td>{e(v)}</td>' for v in
                    (labels[change['change']],r['facility_name'],r['facility_address'],r['business_type'],
                     '許可' if r['record_kind']=='permit' else '届出',r['source_row']))+'</tr>')
            comparison+='<h2>掲載内容が変わった全記録</h2><div class="tablewrap"><table><thead><tr><th>変更内容</th><th>施設名</th><th>所在地</th><th>営業の種類</th><th>区分</th><th>原本のシート・行</th></tr></thead><tbody>'+''.join(entries)+'</tbody></table></div>'
            if source_id=='akita-pref-noshiro':
                comparison+='<p>追加9件は、9月営業許可シートの3～10行（許可8件）と9月営業届出シートの3行（届出1件）です。飲食店営業3件、菓子製造業3件、そうざい製造業1件、みそ又はしょうゆ製造業1件、コップ式自動販売機の届出1件です。10月に開店した9施設を表すものではありません。</p><h2>原本で確認した日付表記</h2><ul>'
                for issue in review['date_issues']:
                    comparison+=f'<li>{e(issue["facility_name"])}：{e(issue["cell"])}の原表記は「{e(issue["original"])}」。{e(issue["decision"])}</li>'
                comparison+='</ul><p>9月・7月のシート名は掲載場所として示し、異常な日付の補正には使っていません。</p>'
    categories=Counter(r['business_type'] for r in rows if r['record_kind']=='permit')
    cat=''.join(f'<tr><th scope="row">{e(k)}</th><td>{v:,}</td></tr>' for k,v in categories.most_common())
    examples=[r for r in rows if r['facility_name'] and r['facility_address']][:10]
    table=''.join(f'<tr><td>{e(r["facility_name"])}</td><td>{e(r["facility_address"])}</td><td>{e(r["business_type"])}</td></tr>' for r in examples)
    body=f'''<p class="eyebrow">食品営業許可・届出の記録／保存日 {sid}</p><h1>{e(title)}</h1>{stats}<p>{e(date_note)}。{detail}</p>{comparison}<h2>営業の種類別の掲載許可件数</h2><div class="tablewrap"><table><thead><tr><th>営業の種類</th><th>掲載件数</th></tr></thead><tbody>{cat}</tbody></table></div><h2>施設名と所在地から探す</h2><p><a class="button" href="/food-business/?source={e(source_id)}">この公開元の全記録を検索する</a></p><div class="tablewrap"><table><thead><tr><th>掲載施設名（例）</th><th>施設所在地</th><th>営業の種類</th></tr></thead><tbody>{table}</tbody></table></div><h2>この数値を読むときに</h2><p>1施設が複数の許可・届出を持つ場合があるため、件数を施設数と読み替えません。公開への同意、更新手続き、掲載範囲の変更も掲載件数に影響します。ほかの公開元の件数とは重複する場合があるため合算していません。</p><p>日付表記の異常は{len(qa.get("date_issues",[]))}か所。元の表記を記録し、日付別集計から除外しています。</p><h2>出典と確認用データ</h2><p><a href="{e(s["page"])}" target="_blank" rel="noopener">{e(s["publisher"])}の公開ページ</a>／<a href="{e(s["license_url"])}" target="_blank" rel="noopener">利用条件</a></p><p>施設データは公開資料から加工しました。原資料そのものとしての利用には出典をご確認ください。</p><p><a href="provenance.json">基準日・原本ハッシュ・集計結果</a>／<a href="/food-business/?source={e(source_id)}">全記録の検索・CSV保存</a></p>'''
    return route,shell(title,f'{s["publisher"]}が公開する食品営業許可・届出情報を営業の種類別に確認します。',route,body),diff

def comparison_summary(payload, previous=None):
    if previous is None:
        return {'status': 'baseline'}
    source, old = payload['source'], previous['source']
    summary = {'before_snapshot_id': previous['snapshot_id'],
               'after_snapshot_id': payload['snapshot_id'],
               'before_as_of': old.get('as_of'), 'after_as_of': source.get('as_of')}
    if any(old.get(k) != source.get(k) for k in ('source_id', 'scope', 'parser', 'period_start')):
        return {'status': 'incompatible', **summary}
    if old['original_sha256'] == source['original_sha256']:
        return {'status': 'unchanged', **summary}
    try:
        diff = model.compare(previous['records'], payload['records'], old, source)
    except ValueError:
        return {'status': 'incompatible', **summary}
    return {'status': 'compared', **summary,
            'counts': {kind: diff['counts'].get(kind, 0) for kind in ('added', 'removed', 'changed')}}

def write_search(check=False):
    body = (HERE/'search.html').read_text(encoding='utf-8')
    page = shell('食品営業許可・届出施設を調べる',
                 '市区町村・営業の種類・施設名から食品営業許可・届出の公表情報を検索し、CSV保存と毎月の掲載変化を確認できます。',
                 '/food-business/', body)
    for base in (PUBLIC, ROOT/'source/public/food-business'):
        put(base/'index.html', page, check)
        for name in ('app.js', 'style.css', 'search-logic.js'):
            put(base/name, (HERE/name).read_bytes(), check)


def build(check=False):
    manifests,history=load_history();catalog=[];article_links=[]
    for source_id,versions in sorted(history.items()):
        m,member,path_in=versions[-1];payload=gzread(path_in);s=payload['source'];qa=payload['qa']
        # Public shards contain facility fields and provenance; applicant fields
        # remain only in the separately archived official original.
        if len(payload['records'])!=member['record_count']:raise ValueError('Snapshot record count differs')
        shard=f'data/{source_id}.json.gz'
        put(PUBLIC/shard,path_in.read_bytes(),check)
        catalog.append({**s,'record_count':len(payload['records']),'permit_count':qa['permit_count'],'notification_count':qa['notification_count'],'withheld_name_count':qa['withheld_name_count'],'snapshot_id':m['snapshot_id'],'data':shard,'bytes':path_in.stat().st_size,'comparison':comparison_summary(payload,gzread(versions[-2][2]) if len(versions)>1 else None)})
        previous=None
        for _,_,version_path in versions:
            p=gzread(version_path)
            route,page,diff=article(p,previous)
            for base in (ROOT,ROOT/'source/public'):
                dest=base/route.lstrip('/')
                put(dest/'index.html',page,check)
                provenance={'source':p['source'],'qa':p['qa'],'snapshot_id':p['snapshot_id'],'record_count':len(p['records']),'comparison':{k:v for k,v in (diff or {}).items() if k!='changes'},'counting_unit':'許可・届出の掲載情報件数。施設数ではない。'}
                put(dest/'provenance.json',json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',check)
                if diff:put(dest/'changes.json',json.dumps(diff,ensure_ascii=False,indent=2)+'\n',check)
            previous=p
        article_links.append((s,route,len(versions)))
    inventory=read(HERE/'sources.json')
    failed={x['source_id']:x['error'] for x in manifests[-1]['failures']}
    catalog_json={'schema_version':1,'collection_date':manifests[-1]['collection_date'],'unit':'published_record','sources':catalog,'acquisition_failures':failed,'authority_inventory':[{k:s[k] for k in ('id','publisher','publisher_type','prefecture_code','authority_code','scope','available')} for s in inventory['sources']]}
    put(PUBLIC/'catalog.json',json.dumps(catalog_json,ensure_ascii=False,indent=2)+'\n',check)
    write_search(check)
    rows=''.join(f'<tr><th scope="row">{e(s["publisher"])}</th><td>{e(s["as_of"] or "年度内の新規一覧")}</td><td><a href="{route}">掲載情報を読む</a></td></tr>' for s,route,_ in article_links)
    body=f'<p class="eyebrow">食品営業許可・届出の保存履歴</p><h1>地域の食品営業許可・届出情報を毎月記録する</h1><p class="lead">都道府県・保健所設置市・特別区の公開情報を保存し、同じ公開元の掲載内容の変化を追います。</p><p><a class="button" href="/food-business/">施設名・所在地から検索する</a></p><p>県型保健所の公表分と市・特別区の公表分を分けて確認できます。初回保存の公開元は比較の基準を掲載し、2回目以降に掲載差分を作成します。</p><div class="tablewrap"><table><thead><tr><th>公開元</th><th>資料の基準日・範囲</th><th>最新の記録</th></tr></thead><tbody>{rows}</tbody></table></div><p>取得・変換できなかった公開元は{len(failed)}件です。取得失敗を施設数0件とは扱いません。</p>'
    review_path=HERE/'reviews'/f'{manifests[-1]["snapshot_id"]}.json'
    if review_path.is_file():
        review=read(review_path)
        changed=[x for x in review['series'] if x['status']=='changed_records']
        links=''.join(f'<li><a href="/analysis/food-business/{e(x["source_id"])}/{e(review["snapshot_id"])}/">{e(x["publisher"])}：掲載追加{x["added"]}件・掲載消失{x["removed"]}件・記載変更{x["changed"]}件</a></li>' for x in changed)
        note=f'<section><h2>{e(review["snapshot_id"])}保存版で掲載内容が変わった公表元</h2><p>全{review["source_count"]}系列を前回保存版と照合。{review["unchanged_originals"]}系列は原本・掲載内容が一致し、{review["changed_sources"]}系列で掲載内容が変わりました。取得日ごとの記録ページが増えても、掲載内容が変わったとは限りません。</p><ul>{links}</ul></section>'
        body=body.replace('<div class="tablewrap">',note+'<div class="tablewrap">',1)
    for base in (ROOT,ROOT/'source/public'):
        put(base/'analysis/food-business/index.html',shell('地域の食品営業許可・届出情報を毎月記録する','食品営業許可・届出の公開元別の保存履歴と掲載変化。','/analysis/food-business/',body),check)
        # The build's public mirror must contain the independent functional page.
        if base!=ROOT:
            for p in PUBLIC.rglob('*'):
                if p.is_file():put(base/'food-business'/p.relative_to(PUBLIC),p.read_bytes(),check)
    return {'source_count':len(catalog),'latest_record_count':sum(s['record_count'] for s in catalog),'failed_sources':failed,'snapshot_count':len(manifests)}

def verify_originals():
    _,history=load_history()
    count=0
    for versions in history.values():
        for _,_,version_path in versions:
            p=gzread(version_path)
            s=p['source'];b=gzip.decompress((ROOT/s['original']).read_bytes())
            if model.sha(b)!=s['original_sha256'] or len(b)!=s['original_bytes']:raise ValueError('Original bytes changed')
            source_format=s.get('format') or Path(s['original']).suffixes[-2].lstrip('.')
            rows,qa=model.normalize(b,s|{'format':source_format})
            if rows!=p['records'] or qa!=p['qa']:raise ValueError(f'Original re-extraction differs: {s["source_id"]}')
            count+=len(rows)
    return count

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--import-acquisitions',nargs='+');ap.add_argument('--snapshot-id');ap.add_argument('--search-only',action='store_true');ap.add_argument('--check',action='store_true');ap.add_argument('--database',type=Path);ap.add_argument('--verify-originals',action='store_true');args=ap.parse_args()
    if args.search_only:
        write_search(args.check);print('Food-business search assets verified' if args.check else 'Food-business search assets generated');return
    if args.import_acquisitions:
        if not args.snapshot_id:ap.error('--snapshot-id is required')
        import_acquisitions(args.import_acquisitions,args.snapshot_id)
    if args.verify_originals:print('Original records verified:',verify_originals())
    print(json.dumps(build(args.check),ensure_ascii=False,indent=2))
    if args.database:
        _,history=load_history();print('SQLite records:',database(history,args.database))
if __name__=='__main__':main()



