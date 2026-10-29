"""Offline regression tests for failures that would corrupt national coverage."""
from __future__ import annotations
import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import zipfile
import discover as d
import pipeline as p
import review_periods as periods


def source(**kw):
    s=d.new_source('population','11223','municipal_direct','https://example.jp/page','https://example.jp/data.csv','csv','test',**kw)
    return s


def workbook(ref, data=True):
    b=io.BytesIO()
    with zipfile.ZipFile(b,'w') as z:
        z.writestr('xl/workbook.xml','<workbook/>')
        z.writestr('xl/worksheets/sheet1.xml',f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="{ref}">{"<v>1</v>" if data else ""}</c></row></sheetData></worksheet>')
    return b.getvalue()


class Response(io.BytesIO):
    url='https://example.jp/data.csv';headers={'Content-Type':'text/csv'}


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.work=Path(self.temp.name)
        self.gov=[{'code':'11223','name':'蕨市','type':'municipality','scope_review_required':False}]
    def tearDown(self): self.temp.cleanup()
    def fetched(self,s=None):
        s=s or source();digest,rel=p.write_original(self.work,b'place,population\na,10\n')
        f={'source':s,'status':'downloaded','sha256':digest,'original_path':rel,'size_bytes':22}
        f['size_bytes']=len(gzip.decompress((self.work/rel).read_bytes()))
        p.write_json(self.work/'fetch'/(s['id']+'.json'),f);return f
    def assessment(self,f,**changes):
        lock=p.read_json(p.ROOT/'engine-lock.json');ident=p.assessment_id(f['sha256'],lock['implementation_sha256'],f['source']['format'])
        a={'id':ident,'original_sha256':f['sha256'],'engine_sha256':lock['implementation_sha256'],'engine':p.POLICY['engine'],
           'format':f['source']['format'],'created_at':'2026-01-01','status':'evaluated','scores':{'1':100,'2':100,'3':90},'dependencies':lock['runtime_dependencies']}
        a.update(changes);p.write_json(self.work/'assessments'/(ident+'.json'),a)
    def test_successful_resume_never_fetches_again(self):
        f=self.fetched()
        with patch('urllib.request.urlopen',side_effect=AssertionError('network')):
            self.assertEqual(p.fetch_one(f['source'],self.work),f)
    def test_failed_refresh_keeps_good_snapshot(self):
        f=self.fetched()
        with patch('urllib.request.urlopen',side_effect=urllib.error.URLError('offline')):
            attempt=p.fetch_one(f['source'],self.work,refresh=True)
        self.assertEqual(attempt['status'],'download_failed')
        self.assertEqual(p.read_json(self.work/'fetch'/(f['source']['id']+'.json')),f)
        self.assertEqual(len(list((self.work/'attempts').glob('*.json'))),1)
    def test_failed_initial_fetch_is_null_not_zero(self):
        s=source()
        with patch('urllib.request.urlopen',side_effect=urllib.error.URLError('offline')):
            f=p.fetch_one(s,self.work)
        self.assertEqual(p.score_one(f,self.work,self.work)['scores'],{'1':None,'2':None,'3':None})
    def test_original_tampering_is_fatal(self):
        f=self.fetched();(self.work/f['original_path']).write_bytes(gzip.compress(b'changed'))
        with self.assertRaises(ValueError):p.raw_bytes(self.work,f)
    def test_original_path_cannot_escape(self):
        with self.assertRaises(ValueError):p.raw_bytes(self.work,{'original_path':'../secret'})
    def test_xlsx_reader_row_limit_blocks_partial_score(self):
        self.assertEqual(p.preflight(workbook('A10001'),'xlsx')['status'],'reader_limit_exceeded')
        self.assertEqual(p.preflight(workbook('A10000'),'xlsx')['status'],'ready')
    def test_xlsx_reader_column_limit(self):
        self.assertEqual(p.preflight(workbook('SG1'),'xlsx')['status'],'reader_limit_exceeded')
    def test_empty_formatting_does_not_block(self):
        self.assertEqual(p.preflight(workbook('A10001',False),'xlsx')['status'],'ready')
    def test_native_xls_remains_unscored(self):
        self.assertEqual(p.preflight(b'not-converted','xls')['status'],'unsupported_format')
    def test_html_error_page_not_data(self):
        with self.assertRaises(ValueError):p.validate_container(b' <!DOCTYPE html>oops','csv')
    def test_format_in_assessment_cache_identity(self):
        self.assertNotEqual(p.assessment_id('a','b','csv'),p.assessment_id('a','b','xlsx'))
    def test_national_platform_never_counts_as_local(self):
        s=source();s['channel']='national_platform';s['id']=p.source_id(s['category'],s['owner_code'],s['channel'],s['url'])
        f=self.fetched(s);self.assessment(f);r=p.summarize(self.gov,[s],self.work)['scope'][0]
        self.assertEqual((r['files_evaluated'],r['direct_files_evaluated'],r['owners_direct_evaluated']),(1,0,0))
    def test_stale_engine_assessment_excluded(self):
        f=self.fetched();self.assessment(f,engine_sha256='changed')
        self.assertEqual(p.summarize(self.gov,[f['source']],self.work)['files'][0]['scores']['1'],None)
    def test_different_dependency_contract_excludes_old_scores(self):
        f=self.fetched();self.assessment(f,dependencies={'openpyxl':'different'})
        self.assertIsNone(p.summarize(self.gov,[f['source']],self.work)['files'][0]['scores']['1'])
    def test_changed_metadata_requires_refresh(self):
        f=self.fetched();self.assessment(f);s=dict(f['source'],declared_period='2026-02-01')
        r=p.summarize(self.gov,[s],self.work)['files'][0]
        self.assertEqual(r['status'],'source_metadata_changed_refresh_required');self.assertIsNone(r['scores']['1'])
    def test_planner_balances_fields_and_never_retries_ahead_of_new(self):
        pop=source();food=dict(pop,category='food_business');finance=dict(pop,category='finance')
        jobs=p.planned_jobs([('yesterday',food),('',pop),('',finance)])
        self.assertEqual([s['category'] for s in jobs],['population','finance'])
    def test_planner_spreads_prefectures(self):
        a=source();b=dict(a,owner_code='11224');c=dict(a,owner_code='12227')
        self.assertEqual([s['owner_code'][:2] for s in p.planned_jobs([('',a),('',b),('',c)])][:2],['11','12'])
    def test_source_not_found_is_pending(self):
        r=p.summarize(self.gov,[],self.work)['scope'][0]
        self.assertEqual(r['source_discovery_pending'],1);self.assertEqual(r['files_evaluated'],0)
    def test_publisher_identity_and_url_validation(self):
        s=source();s['url']='https://user:password@example.jp/data.csv'
        with self.assertRaises(ValueError):p.validate_source(s)
        with self.assertRaises(ValueError):p.validate_source(source(),{'99999'})


class PeriodTests(unittest.TestCase):
    def test_mixed_observation_dates_cannot_enter_same_date_comparison(self):
        r=periods.confirm_population('調査年月日,人口\n2026-01-01,10\n2026-02-01,20\n'.encode(),'csv')
        self.assertEqual(r['status'],'date_requires_review');self.assertNotIn('observation_date',r)
    def test_missing_date_is_counted_instead_of_assumed(self):
        r=periods.confirm_population('調査年月日,人口\n2026-01-01,10\n,20\n'.encode(),'csv')
        self.assertEqual(r['rows_missing_date'],1)
        self.assertFalse(r.get('observation_date')=='2026-01-01' and r['rows_missing_date']==0)
    def test_other_sheets_cannot_be_implicitly_assigned_first_sheet_date(self):
        from types import SimpleNamespace
        w=SimpleNamespace(worksheets=[object(),object()],sheetnames=['January','February'],close=lambda:None)
        with patch('openpyxl.load_workbook',return_value=w):r=periods.confirm_population(b'exact-original','xlsx')
        self.assertEqual(r['status'],'multiple_sheets_require_date_review');self.assertNotIn('observation_date',r)


class DiscoveryTests(unittest.TestCase):
    def test_official_http_locator_is_not_silently_dropped(self):
        g=[{'name':'鹿児島県','code':'46000','type':'prefecture'}]
        rows,indexes=d.finance_index('<meta charset="utf-8"><a href="http://www.pref.kagoshima.jp/finance.html">■鹿児島県</a>'.encode(),g)
        self.assertEqual(len(indexes),1);self.assertEqual(indexes[0]['prefecture_code'],'46')
    def test_check_digit_remainder_zero_and_real_codes(self):
        self.assertEqual(d.checksum('01213'),'1');self.assertEqual(d.checksum('11223'),'2')
    def test_gsi_distinguishes_emergency_sites_from_shelters(self):
        gov={f'{n:05}':{} for n in range(1,8)}
        data='00001,A,2020,2026,,\n00002,B,2020,2026,11,\n00003,C,2020,2026,12,\n00004,D,2020,2026,9,\n00005,E,,2026,,\n00006,F,2020,2026,2,\n00007,G,2020,2026,1,掲載保留\n'.encode()
        rows,availability=d.gsi_sources(data,gov)
        self.assertEqual([s['owner_code'] for s in rows],['00001','00002','00007'])
        self.assertTrue(all(s['url'].endswith('_2.csv') for s in rows));self.assertEqual(len(availability),7)
        self.assertEqual(rows[-1]['platform_status_flag'],'1')
    def test_truncated_catalog_is_rejected(self):
        with self.assertRaises(ValueError):d.bodik_sources({'success':True,'result':{'count':2,'results':[]}},'population',{})
    def test_catalog_date_is_not_observation_date(self):
        self.assertIsNone(d.new_source('population','11223','municipal_direct','p','u','csv','t')['declared_period'])
    def test_japanese_charset_decoding_preserves_labels(self):
        links=d.html_links('<meta charset="Shift_JIS"><a href="a.xlsx">蕨市</a>'.encode('cp932'),'https://example.jp/')
        self.assertEqual(links,[('https://example.jp/a.xlsx','蕨市')])

if __name__=='__main__':unittest.main()
