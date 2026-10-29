import copy
import csv
import datetime as dt
import io
import json
import gzip
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import model
import fetch
import build

class FoodBusinessTests(unittest.TestCase):
    def source(self):return {'id':'ifas-05000','parser':'ifas','authority_code':'05000'}
    def raw(self,**changes):
        r={x:'' for x in model.NATIONAL_HEADER}
        r.update({'自治体コード':'005000','行番号':'fBizTest','都道府県名':'秋田県','市区町村名':'秋田市','営業施設名称、屋号又は商号':'検証用施設','営業施設所在地':'秋田県大館市御成町1-1','営業の種類':'飲食店営業','申請区分':'許可','許可番号':'1-1','許可開始日':'2026/09/01'})
        r.update(changes);out=io.StringIO();w=csv.writer(out);w.writerow(model.NATIONAL_HEADER);w.writerow([r[x] for x in model.NATIONAL_HEADER]);return out.getvalue().encode()
    def record(self,**kw):
        r={f:'' for f in model.FIELDS};r.update(key='a',record_id='A',record_kind='permit',facility_name='店',facility_address='所在地',business_type='飲食店営業',date_issues=[]);r.update(kw);return r
    def meta(self,as_of):return {'source_id':'x','scope':'published_permit_registry','parser':'generic','as_of':as_of}
    def test_facility_location_does_not_use_authority_city(self):
        r,q=model.normalize(self.raw(),self.source());self.assertEqual(r[0]['facility_address'],'秋田県大館市御成町1-1');self.assertNotIn('municipality',r[0]);self.assertEqual(q['permit_count'],1)
    def test_withheld_fields_stay_blank(self):
        r,q=model.normalize(self.raw(**{'営業施設名称、屋号又は商号':'','営業施設所在地':''}),self.source());self.assertEqual(r[0]['facility_name'],'');self.assertEqual(r[0]['facility_address'],'');self.assertEqual(q['withheld_name_count'],1)
    def test_wrong_authority_rejected(self):
        with self.assertRaisesRegex(ValueError,'authority'):model.normalize(self.raw(**{'自治体コード':'003000'}),self.source())
    def test_notification_and_official_closure(self):
        r,q=model.normalize(self.raw(**{'申請区分':'届出(廃業)','廃業年月日':'2026/09/15'}),self.source());self.assertEqual(r[0]['record_kind'],'notification');self.assertEqual(r[0]['closed_on'],'2026-09-15');self.assertEqual(q['closed_count'],1)
    def test_unknown_record_kind_and_changed_header_fail(self):
        with self.assertRaises(ValueError):model.normalize(self.raw(**{'申請区分':'不明'}),self.source())
        with self.assertRaises(ValueError):model.normalize(self.raw().replace('営業施設所在地'.encode(),'施設住所'.encode()),self.source())
    def test_dates_and_excel_serial(self):
        self.assertEqual(model.date('令和８年９月１日'),'2026-09-01');self.assertEqual(model.date('R8.9.1'),'2026-09-01');self.assertEqual(model.date(46266,True),(dt.date(1899,12,30)+dt.timedelta(days=46266)).isoformat())
        with self.assertRaises(ValueError):model.date('2026年7年15日')
    def test_key_scopes_publisher_category_and_year(self):
        s=self.source();r=self.record();self.assertNotEqual(model.identity(s,r),model.identity(s|{'id':'ifas-05201'},r));self.assertNotEqual(model.identity(s,r),model.identity(s,r|{'business_type':'菓子製造業'}))
        s={'id':'local','parser':'generic'};r.update(permit_number='100',valid_from='2025-01-01');self.assertNotEqual(model.identity(s,r),model.identity(s,r|{'valid_from':'2026-01-01'}))
    def test_diff_reconstructs_and_preserves_permit_replacement(self):
        old=[self.record(key='old',permit_number='1')];new=[self.record(key='new',permit_number='2')]
        d=model.compare(old,new,self.meta('2026-08-31'),self.meta('2026-09-30'));self.assertEqual(d['counts'],{'added':1,'removed':1});self.assertEqual(d['permit_replacement_candidates'],1);self.assertTrue(all(x['permit_replacement_candidate'] for x in d['changes']))
    def test_diff_ignores_row_reordering_but_finds_name_change(self):
        old=[self.record(source_row='3')];new=[self.record(source_row='8')];self.assertEqual(model.compare(old,new,self.meta('2026-08-31'),self.meta('2026-09-30'))['changes'],[])
        new[0]['facility_name']='改称';d=model.compare(old,new,self.meta('2026-08-31'),self.meta('2026-09-30'));self.assertEqual(d['changes'][0]['fields'],['facility_name'])
    def test_mixed_scope_same_date_and_backwards_comparison_rejected(self):
        for newer in (self.meta('2026-08-31'),self.meta('2026-07-31'),self.meta('2026-09-30')|{'scope':'monthly_new'}):
            with self.assertRaises(ValueError):model.compare([],[],self.meta('2026-08-31'),newer)
        with self.assertRaises(ValueError):model.compare([],[],self.meta(None)|{'period_start':'2026-04-01'},self.meta(None)|{'period_start':'2027-04-01'})
    def test_blank_names_never_form_renewal_candidate(self):
        d=model.compare([self.record(key='old',facility_name='')],[self.record(key='new',facility_name='')],self.meta('2026-08-31'),self.meta('2026-09-30'));self.assertEqual(d['permit_replacement_candidates'],0)
    def test_csv_has_bom_quotes_and_formula_neutralization(self):
        b=model.safe_csv([{'name':'=1+1'},{'name':'店,本館'}],['name']);self.assertTrue(b.startswith(b'\xef\xbb\xbf'));rows=list(csv.reader(io.StringIO(b.decode('utf-8-sig'))));self.assertEqual(rows[1],["'=1+1"]);self.assertEqual(rows[2],['店,本館'])
    def test_only_actual_registry_date_is_used(self):
        self.assertEqual(fetch.reference_date('https://example.test/r081001.xlsx','更新日10月6日'),'2026-10-01');self.assertEqual(fetch.reference_date('https://example.test/20260930.csv',''),'2026-09-30')
        with self.assertRaises(ValueError):fetch.reference_date('https://example.test/latest.csv','2026年10月6日更新')
    def test_extraction_excludes_applicant_fields(self):
        r,q=model.normalize(self.raw(**{'法人名':'非公開テスト','法人住所':'申請者住所テスト','営業施設電話番号':'000-0000-0000'}),self.source());self.assertNotIn('非公開テスト',model.dumps(r));self.assertNotIn('申請者住所テスト',model.dumps(r));self.assertNotIn('000-0000',model.dumps(r))
    def test_local_withheld_facility_is_counted_by_permit(self):
        b='屋号商号,市町村名,営業所所在地,業種,許可番号,許可年月日\n,,,飲食店営業,100,2026-09-01\n'.encode()
        r,q=model.normalize(b,{'id':'morioka-city','parser':'generic','format':'csv'});self.assertEqual(len(r),1);self.assertEqual(r[0]['facility_name'],'');self.assertEqual(q['withheld_name_count'],1)
    def test_local_bad_date_is_retained_without_guessing(self):
        b='施設名称,施設所在地,業種,許可番号,許可年月日\n検証用,所在地,飲食店営業,100,2026年7年15日\n'.encode()
        r,q=model.normalize(b,{'id':'local','parser':'generic','format':'csv'});self.assertEqual(r[0]['permit_date'],'');self.assertEqual(q['date_issues'][0]['original'],'2026年7年15日');self.assertEqual(q['record_count'],1)
    def test_existing_original_is_immutable_even_if_gzip_header_differs(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(fetch.build,'DATA',Path(temp)):
            b=self.raw();p=Path(temp)/'originals'/(model.sha(b)+'.csv.gz');p.parent.mkdir();original=gzip.compress(b,mtime=123);p.write_bytes(original)
            h,saved=fetch.save_original(b,'csv');self.assertEqual(saved,p);self.assertEqual(p.read_bytes(),original)

    def test_search_comparison_status_preserves_scope_and_dates(self):
        old={'snapshot_id':'2026-09-18','source':self.meta('2026-08-31')|{'original_sha256':'old'},'records':[self.record()]}
        new={'snapshot_id':'2026-10-18','source':self.meta('2026-09-30')|{'original_sha256':'new'},'records':[self.record(facility_name='改称'),self.record(key='b')]}
        self.assertEqual(build.comparison_summary(new),{'status':'baseline'})
        s=build.comparison_summary(new,old)
        self.assertEqual(s['status'],'compared');self.assertEqual(s['counts'],{'added':1,'removed':0,'changed':1})
        self.assertEqual(s['before_snapshot_id'],'2026-09-18');self.assertEqual(s['after_as_of'],'2026-09-30')
        for field,value in [('scope','monthly_new'),('parser','different'),('period_start','2027-04-01'),('as_of','2026-08-31')]:
            other=copy.deepcopy(new);other['source'][field]=value
            self.assertEqual(build.comparison_summary(other,old)['status'],'incompatible')
        same=copy.deepcopy(old);same['snapshot_id']='2026-10-18'
        self.assertEqual(build.comparison_summary(same,old)['status'],'unchanged')

if __name__=='__main__':unittest.main()

