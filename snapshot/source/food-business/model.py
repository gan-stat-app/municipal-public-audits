"""Food-permit records: source-scoped identities, provenance and conservative diffs.

No network access. No applicant names, residential addresses or phone numbers are
copied into normalized/public records. Original bytes remain separately hashed.
"""
import calendar
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

FIELDS = ('record_id', 'facility_name', 'facility_address', 'business_type',
          'business_detail', 'record_kind', 'permit_number', 'first_permit_date',
          'permit_date', 'valid_from', 'valid_until', 'closed_on', 'application',
          'source_row', 'notification_date', 'date_issues')
NATIONAL_HEADER = ['自治体コード','行番号','都道府県名','市区町村名',
    '営業施設名称、屋号又は商号','営業施設名称、屋号又は商号（フリガナ）',
    '営業の種類','業態','営業施設所在地','営業施設方書','緯度','経度',
    '営業施設電話番号','法人名','法人番号','法人住所','許可番号','初回許可年月日',
    '許可年月日','許可開始日','許可満了日','廃業年月日','申請区分','許可条件','備考']

def text(v):
    return '' if v is None else str(v).strip()

def normal(v):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text(v)))

def dumps(v):
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def sha(b):
    return hashlib.sha256(b).hexdigest()

def date(v, excel=False):
    if v in (None, ''): return ''
    if isinstance(v, dt.datetime): return v.date().isoformat()
    if isinstance(v, dt.date): return v.isoformat()
    if isinstance(v, (int, float)):
        if excel and 25000 <= v <= 100000:
            return (dt.datetime(1899,12,30)+dt.timedelta(days=v)).date().isoformat()
        raise ValueError(f'Unexpected numeric date: {v}')
    s = unicodedata.normalize('NFKC', text(v))
    if s in ('-', '―', 'ー', '－'): return ''
    m = re.fullmatch(r'(令和|平成|昭和|R|H|S)\s*(元|\d+)[年./-]\s*(\d+)[月./-]\s*(\d+)日?',s,re.I)
    if m:
        era,y,mn,d = m.groups();y=(1 if y=='元' else int(y))+{'令和':2018,'平成':1988,'昭和':1925,'R':2018,'H':1988,'S':1925}[era.upper()]
        return dt.date(y,int(mn),int(d)).isoformat()
    m = re.fullmatch(r'(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})日?(?: 00:00:00)?',s)
    if m: return dt.date(*map(int,m.groups())).isoformat()
    raise ValueError(f'Unrecognized date: {s}')

def decoded(b):
    for encoding in ('utf-8-sig', 'cp932'):
        try:return b.decode(encoding),encoding
        except UnicodeDecodeError:pass
    raise ValueError('Neither UTF-8 nor CP932; do not replace invalid characters')

def csv_rows(b):
    s,enc=decoded(b)
    return list(csv.reader(io.StringIO(s))),enc

def identity(source, row):
    # National row ID is an application/facility identifier shared by categories.
    # Permit numbers alone repeat across years in several local registries.
    if source['parser']=='ifas':
        parts=[row['record_id'],row['business_type'],row['record_kind']]
    elif row['permit_number']:
        parts=[row['permit_number'],row['valid_from'] or row['permit_date'],row['business_type']]
    else:
        parts=[row['facility_name'],row['facility_address'],row['business_type'],row['permit_date'],row['record_kind']]
    if not any(parts):raise ValueError('Empty record identity')
    return sha(dumps([source['id'],parts]).encode())

def national(b, source):
    rows,encoding=csv_rows(b)
    if not rows or rows[0] != NATIONAL_HEADER:raise ValueError('IFAS header changed')
    out=[]
    for n,values in enumerate(rows[1:],2):
        if len(values)!=len(NATIONAL_HEADER):raise ValueError(f'IFAS row length: {n}')
        r=dict(zip(NATIONAL_HEADER,values))
        expected=source['authority_code']
        if r['自治体コード'] != '0'+expected:raise ValueError(f'IFAS authority mismatch at {n}')
        kind=r['申請区分']
        if kind not in ('許可','届出','許可(廃業)','届出(廃業)'):
            raise ValueError(f'Unknown IFAS record kind: {kind}')
        out.append(dict(zip(FIELDS,(
            r['行番号'],r['営業施設名称、屋号又は商号'],
            ' '.join(x for x in (r['営業施設所在地'],r['営業施設方書']) if x),
            r['営業の種類'],r['業態'],'permit' if kind.startswith('許可') else 'notification',
            r['許可番号'],date(r['初回許可年月日']),date(r['許可年月日']),
            date(r['許可開始日']),date(r['許可満了日']),date(r['廃業年月日']),kind,str(n),'',[]))))
    return out, {'encoding':encoding,'input_rows':len(rows)-1,'table_count':1}

ALIASES={
 'facility_name':['営業所名','施設名称','施設名','営業施設名称、屋号又は商号','営業所名称','施設の名称','施設の名称、屋号又は商号','屋号商号'],
 'facility_address':['営業所住所','所在地_連結表記','施設所在地','営業所所在地','営業施設所在地','所在地','施設の所在地','施設住所'],
 'business_type':['業種名','営業の種類','許可業種','業種','営業の種類（業種）'],
 'business_detail':['業態名','業態','営業の形態','営業の形態（業態）（営業許可のみ）'],
 'record_kind':['許可届出区分','許可・届出区分'],
 'permit_number':['指令番号','許可番号','営業許可番号'],
 'permit_date':['許可年月日','許可年⽉⽇','許可日','許可年月日（有効期間始期）','許可・届出年月日'],
 'valid_from':['許可期間（開始）','許可開始日','有効期間始期','許可年月日（有効期間始期）','有効期間開始日'],
 'valid_until':['許可期間（満了）','許可満了日','有効期間終期','許可期限','有効期間終了日','満了年月日'],
 'application':['申請区分','新規・更新区分','新規更新区分'],
 'closed_on':['廃業年月日','廃業日'],
 'first_permit_date':['初回許可年月日','初回許可日'],
 'notification_date':['届出年月日'],
}

def columns(header):
    h=[normal(x) for x in header]
    return {field:next((h.index(normal(x)) for x in aliases if normal(x) in h),None) for field,aliases in ALIASES.items()}

def tabular(b,source):
    if source['format']=='csv':
        rr,encoding=csv_rows(b);tables=[('CSV',rr)];excel=False
    else:
        import openpyxl
        w=openpyxl.load_workbook(io.BytesIO(b),read_only=True,data_only=True)
        tables=[(s.title,list(s.values)) for s in w];encoding='xlsx';excel=True
    out=[]; headers=[]; skipped=[];date_issues=[]
    for sheet,rows in tables:
        # Some fiscal-year sheets contain a title and several category tables.
        active=None;header_row=None;default_kind='notification' if '届出' in sheet and '許可' not in sheet else 'permit'
        for n,values in enumerate(rows,1):
            nonempty=[text(v) for v in values if text(v)]
            if len(nonempty)==1 and len(nonempty[0])<55 and ('営業許可' in nonempty[0] or '営業届出' in nonempty[0] or '新規届出' in nonempty[0]):
                default_kind='notification' if '届出' in nonempty[0] and '許可' not in nonempty[0] else 'permit'
                active=None
            c=columns(values)
            # Notification headers themselves identify the record kind, even in
            # workbooks with two tables per sheet and an unlabelled separator.
            if c['notification_date'] is not None and c['permit_number'] is None:
                default_kind='notification'
            if default_kind=='notification' and c['business_type'] is None and c['business_detail'] is not None:
                c['business_type']=c['business_detail']
            if c['facility_name'] is not None and c['facility_address'] is not None and c['business_type'] is not None:
                active=c;header_row=n;headers.append({'sheet':sheet,'row':n,'values':[text(v) for v in values]});continue
            if not active:continue
            if not any(v is not None and text(v) for v in values):continue
            def get(field):
                ix=active.get(field)
                return values[ix] if ix is not None and ix<len(values) else None
            identifiable=(text(get('permit_number')) or
                (text(get('facility_name')) and text(get('business_type'))) or
                (text(get('business_type')) and text(get('notification_date'))))
            if not identifiable:
                skipped.append(f'{sheet}:{n}');continue
            r={f:'' for f in FIELDS}
            for f in ALIASES:
                if f not in ('record_kind',):r[f]=text(get(f))
            r['record_id']=''
            r['date_issues']=[]
            r['source_row']=f'{sheet}:{n}'
            r['record_kind']=default_kind
            if source['id']=='morioka-city':
                head=[normal(v) for v in rows[header_row-1]]
                for field in ('市町村名','ビル名称'):
                    ix=head.index(normal(field)) if normal(field) in head else None
                    val=text(values[ix]) if ix is not None and ix<len(values) else ''
                    if val and val not in r['facility_address']:
                        r['facility_address']=(val+r['facility_address']) if field=='市町村名' else r['facility_address']+' '+val
            if get('record_kind'):
                k=text(get('record_kind'))
                r['record_kind']='notification' if '届出' in k else 'permit'
            for f in ('permit_date','valid_from','valid_until','closed_on','first_permit_date','notification_date'):
                try:r[f]=date(get(f),excel=excel)
                except ValueError:
                    issue={'source_row':r['source_row'],'field':f,'original':text(get(f))}
                    r['date_issues'].append(issue);date_issues.append(issue);r[f]=''
            out.append(r)
    if not headers or not out:raise ValueError(f'No verified facility table in {source["id"]}')
    return out, {'encoding':encoding,'input_rows':len(out),'table_count':len(headers),'headers':headers,'nonrecord_rows_after_headers':skipped,'date_issues':date_issues}

def normalize(b,source):
    rows,qa = national(b,source) if source['parser']=='ifas' else tabular(b,source)
    seen={};duplicates=[]
    for row in rows:
        key=identity(source,row)
        if key in seen:
            a={k:v for k,v in seen[key].items() if k!='source_row'}
            z={k:v for k,v in row.items() if k!='source_row'}
            if a!=z:raise ValueError(f'Conflicting duplicate identity {source["id"]}:{row["source_row"]}')
            duplicates.append(row['source_row']);continue
        seen[key]=row
    qa['exact_duplicate_rows']=duplicates
    result=[dict(key=k,**v) for k,v in sorted(seen.items())]
    qa['record_count']=len(result)
    qa['permit_count']=sum(x['record_kind']=='permit' for x in result)
    qa['notification_count']=len(result)-qa['permit_count']
    qa['closed_count']=sum(bool(x['closed_on']) or '(廃業)' in x['application'] for x in result)
    qa['withheld_name_count']=sum(not x['facility_name'] for x in result)
    qa['withheld_address_count']=sum(not x['facility_address'] for x in result)
    return result,qa

def compare(old,new,old_meta,new_meta):
    for k in ('source_id','scope','parser','period_start'):
        if old_meta.get(k)!=new_meta.get(k):raise ValueError(f'Incompatible comparison: {k}')
    if old_meta.get('as_of') and new_meta.get('as_of') and old_meta['as_of']>=new_meta['as_of']:
        raise ValueError('Comparison requires a later source reference date')
    a={r['key']:r for r in old};b={r['key']:r for r in new}
    changes=[]
    for key in sorted(a.keys()|b.keys()):
        if key not in a:changes.append({'change':'added','key':key,'before':None,'after':b[key]})
        elif key not in b:changes.append({'change':'removed','key':key,'before':a[key],'after':None})
        else:
            fields=[f for f in FIELDS if f!='source_row' and a[key][f]!=b[key][f]]
            if fields:changes.append({'change':'changed','key':key,'fields':fields,'before':a[key],'after':b[key]})
    # Preserve every addition/removal. Flag one-to-one renewal candidates only.
    pairs={}
    for c in changes:
        if c['change'] not in ('added','removed'):continue
        r=c['after'] or c['before']
        if not r['facility_name'] or not r['facility_address']:continue
        sig=tuple(normal(r[f]) for f in ('facility_name','facility_address','business_type','record_kind'))
        pairs.setdefault(sig,{'added':[],'removed':[]})[c['change']].append(c)
    candidates=0
    for v in pairs.values():
        if len(v['added'])==len(v['removed'])==1:
            candidates+=1
            for c in v['added']+v['removed']:c['permit_replacement_candidate']=True
    reconstructed=dict(a)
    for c in changes:
        if c['change']=='removed':del reconstructed[c['key']]
        else:reconstructed[c['key']]=c['after']
    def substantive(records):return {k:{f:r[f] for f in FIELDS if f!='source_row'} for k,r in records.items()}
    if substantive(reconstructed)!=substantive(b):raise AssertionError('Diff cannot reconstruct new snapshot')
    return {'source_id':new_meta['source_id'],'before':old_meta.get('as_of'),'after':new_meta.get('as_of'),
        'before_count':len(old),'after_count':len(new),'counts':dict(Counter(c['change'] for c in changes)),
        'permit_replacement_candidates':candidates,'changes':changes,
        'interpretation':'Published-record differences; additions/removals are not verified openings/closures.'}

def safe_csv(rows,fields):
    out=io.StringIO(newline='');w=csv.writer(out,lineterminator='\r\n');w.writerow(fields)
    for row in rows:
        cells=[]
        for f in fields:
            v=text(row.get(f,''))
            if v.lstrip().startswith(('=','+','-','@')):v="'"+v
            cells.append(v)
        w.writerow(cells)
    return ('\ufeff'+out.getvalue()).encode('utf-8')
