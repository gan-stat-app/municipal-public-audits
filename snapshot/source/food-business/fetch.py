"""Acquire public sources. A failed fetch never replaces a source with zero rows."""
import argparse
import calendar
import datetime as dt
import gzip
import html
import http.cookiejar
import json
import re
import tempfile
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode,urljoin,urlsplit,urlunsplit,quote,unquote
from urllib.request import Request,build_opener,HTTPCookieProcessor,urlopen
from zoneinfo import ZoneInfo
import model
import build

class Page(HTMLParser):
    def __init__(self):super().__init__();self.inputs={};self.links=[];self.a=None;self.action=''
    def handle_starttag(self,t,attrs):
        a=dict(attrs)
        if t=='input' and a.get('type')=='hidden' and a.get('name'):self.inputs[a['name']]=a.get('value','')
        if t=='form':self.action=a.get('action','')
        if t=='a':self.a=[a.get('href',''),'']
    def handle_data(self,s):
        if self.a is not None:self.a[1]+=s
    def handle_endtag(self,t):
        if t=='a' and self.a is not None:self.links.append(self.a);self.a=None

def encoded_url(u):
    p=urlsplit(u)
    if p.scheme!='https':raise ValueError('Only official HTTPS downloads are accepted')
    return urlunsplit((p.scheme,p.netloc,quote(unquote(p.path),safe='/'),p.query,''))

def download(u,attempts=2):
    for attempt in range(attempts):
        try:
            with urlopen(Request(encoded_url(u),headers={'User-Agent':'municipal-smr.jp food-business archive; public-data research'}),timeout=45) as r:
                b=r.read()
                if not b:raise ValueError('Empty response')
                return b
        except Exception:
            if attempt+1==attempts:raise
            time.sleep(1)

def parse_page(b):
    s,_=model.decoded(b);p=Page();p.feed(s);return s,p

def national_catalog():
    op=build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    base='https://i2fas.mhlw.go.jp'
    with op.open(base+'/faspub/IO_S010303.do',timeout=45) as r:_,menu=parse_page(r.read())
    query=menu.inputs|{'method':'a_menu_o01Action','param':''}
    with op.open(base+menu.action+'?'+urlencode(query),timeout=45) as r:s,p=parse_page(r.read())
    labels=re.findall(r'name="_i_n(\d{5})_str" value="([^"]+)"',s)
    reference=unicodedata.normalize('NFKC',p.inputs.get('_outcotntext_str',''))
    m=re.search(r'(\d{4})年\s*(\d{1,2})月末',reference)
    if not m:raise ValueError('National reference date is unavailable')
    y,mn=map(int,m.groups());as_of=dt.date(y,mn,calendar.monthrange(y,mn)[1]).isoformat()
    if {code[:2] for code,name in labels if code.endswith('000')}!={f'{i:02}' for i in range(1,48)}:raise ValueError('National directory no longer lists 47 prefectures')
    available={code:bool(re.search(r'id="a_n'+code+r'_item" style=""',s)) for code,name in labels}
    return labels,as_of,available

def reference_date(url,label):
    path=unquote(urlsplit(url).path)
    m=re.search(r'(20\d{2})(\d{2})(\d{2})',path)
    if m:return dt.date(*map(int,m.groups())).isoformat()
    m=re.search(r'r(\d{2})(\d{2})(\d{2})',path,re.I)
    if m:return dt.date(int(m[1])+2018,int(m[2]),int(m[3])).isoformat()
    s=unicodedata.normalize('NFKC',label)
    m=re.search(r'令和(\d+)年(\d+)月(\d+)日',s)
    if m:return dt.date(int(m[1])+2018,int(m[2]),int(m[3])).isoformat()
    raise ValueError('Cannot determine the dated registry reference date')

def resolve_local(source,today):
    _,page=parse_page(download(source['page']))
    if source['parser']=='akita-pref':
        fiscal=today.year-(today.month<4);era=fiscal-2018
        candidates=[(urljoin(source['page'],u),t) for u,t in page.links if '.xlsx' in u.lower() and re.search(r'令和\s*'+str(era)+r'\s*年度',unicodedata.normalize('NFKC',t))]
        if len(candidates)!=1:raise ValueError('Fiscal-year attachment is missing or ambiguous')
        u,t=candidates[0];return source|{'url':encoded_url(u),'as_of':None,'period_start':f'{fiscal}-04-01'}
    candidates=[]
    for u,t in page.links:
        if not any(x in u.lower() for x in ('.csv','.xlsx')):continue
        if source['id']=='yamagata-city' and '時点' not in t:continue
        if source['id']=='morioka-city' and '.xlsx' not in u.lower():continue
        if '食品' not in t and source['id']!='morioka-city':continue
        u=urljoin(source['page'],u)
        try:as_of=reference_date(u,t)
        except ValueError:continue
        candidates.append((as_of,u))
    if not candidates:raise ValueError('Dated registry attachment not found')
    as_of,u=max(candidates)
    return source|{'url':encoded_url(u),'as_of':as_of,'format':'csv' if '.csv' in u.lower() else 'xlsx'}

def save_original(b,extension):
    sha=model.sha(b);p=build.DATA/'originals'/(sha+'.'+extension+'.gz')
    if p.exists():
        if gzip.decompress(p.read_bytes())!=b:raise ValueError('Archived original conflicts with its content hash')
    else:build.put(p,gzip.compress(b,mtime=0))
    return sha,p

def acquire(source,today):
    try:
        s=source if source['parser']=='ifas' else resolve_local(source,today)
        if not s['available']:raise ValueError('Official directory currently marks download unavailable')
        b=download(s['url'])
        if b.lstrip().lower().startswith((b'<!doctype',b'<html')):raise ValueError('Data URL returned an HTML page')
        # Validate before a source is admitted to the new snapshot.
        model.normalize(b,s)
        sha,p=save_original(b,s['format'])
        print(s['id'],len(b),flush=True)
        return s,{'source_id':s['id'],'url':s['url'],'as_of':s['as_of'],'period_start':s.get('period_start'),'fetched_at':today.isoformat(),'sha256':sha,'bytes':len(b),'format':s['format'],'original':str(p.relative_to(build.ROOT))}
    except Exception as exc:
        print('FAILED',source['id'],type(exc).__name__,str(exc)[:120],flush=True)
        return source,{'source_id':source['id'],'error':type(exc).__name__+': '+str(exc),'as_of':source.get('as_of')}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--workers',type=int,default=3);args=ap.parse_args()
    if not 1<=args.workers<=4:ap.error('--workers must be between 1 and 4')
    today=dt.datetime.now(ZoneInfo('Asia/Tokyo')).date()
    cfg=build.read(build.HERE/'sources.json');labels,as_of,available=national_catalog()
    current={s['id']:s for s in cfg['sources']};sample=next(s for s in cfg['sources'] if s['parser']=='ifas')
    for code,name in labels:
        source_id='ifas-'+code
        base=current.get(source_id,sample)
        current[source_id]=base|{'id':source_id,'publisher':html.unescape(name),'publisher_type':'prefecture' if code.endswith('000') else 'health_center_city_or_ward','authority_code':code,'prefecture_code':code[:2],'as_of':as_of,'available':available[code],'url':'https://i2fas.mhlw.go.jp/faspub/page/opendatadownload.jsp?param='+code+'_food_business_all.csv'}
    results=[];resolved=[]
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for s,result in ex.map(lambda s:acquire(s,today),sorted(current.values(),key=lambda s:s['id'])):
            results.append(result);resolved.append(s)
    if not any('error' not in r for r in results):raise ValueError('No source was acquired; keep the published version')
    _,history=build.load_history()
    changed=[]
    for r in results:
        if 'error' in r:continue
        previous=build.gzread(history[r['source_id']][-1][2])['source'] if r['source_id'] in history else None
        if previous and previous.get('as_of') and r.get('as_of') and r['as_of']<previous['as_of']:
            r['error']='Official reference date moved backwards; keep the previously saved version'
            continue
        if previous is None or r['sha256']!=previous['original_sha256'] or r.get('as_of')!=previous.get('as_of') or r.get('period_start')!=previous.get('period_start'):
            changed.append(r)
    if not changed:
        failures=[r['source_id'] for r in results if 'error' in r]
        if failures:raise RuntimeError('Acquisition failed; previous publication preserved: '+', '.join(failures))
        print('No original-byte or reference-date changes; no snapshot, article or branch is created.');return
    cfg['sources']=resolved;cfg['catalog_as_of']=as_of
    cfg['catalog_sha256']=model.sha(model.dumps({'labels':labels,'as_of':as_of,'available':available}).encode())
    build.put(build.HERE/'sources.json',json.dumps(cfg,ensure_ascii=False,indent=2)+'\n')
    with tempfile.TemporaryDirectory() as temp:
        p=Path(temp)/'acquisition.json';p.write_text(json.dumps(results,ensure_ascii=False))
        snapshot_id=today.isoformat()
        if (build.SNAPSHOTS/snapshot_id/'manifest.json').exists():
            raise ValueError('Snapshot for this date already exists; preserve it and review the revision separately')
        build.import_acquisitions([p],snapshot_id)
    print(json.dumps(build.build(),ensure_ascii=False,indent=2))
    import publish
    publish.update(False)
if __name__=='__main__':main()
