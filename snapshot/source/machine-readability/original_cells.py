"""Read immutable CSV/OOXML cell evidence without authoring or dense padding.

Only cell values, formulas and merged ranges are exposed. Charts and drawing
text are deliberately outside this reader; their absence is never a pass.
"""
from __future__ import annotations
import csv
import io
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile


def stored_date_evidence(sheet, cell):
    """Decode a stored date only with a real date format, not color/unit text."""
    from datetime import datetime
    from openpyxl.styles.numbers import BUILTIN_FORMATS, is_date_format
    from openpyxl.utils.datetime import from_excel, CALENDAR_MAC_1904, CALENDAR_WINDOWS_1900
    value = sheet['cells'].get(cell)
    style = sheet.get('cell_styles', {}).get(cell)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or style is None:
        return None
    form = sheet['number_formats'][style]
    code = form.get('custom_format_code') or BUILTIN_FORMATS.get(int(form['numFmtId']), '')
    if not is_date_format(code):
        return None
    try:
        decoded = from_excel(value, epoch=CALENDAR_MAC_1904 if sheet.get('date1904') else CALENDAR_WINDOWS_1900)
    except (ValueError, OverflowError):
        return None
    if not isinstance(decoded, datetime):
        return None
    return {'sheet': sheet['name'], 'cell': cell, 'stored_value': value,
            'date1904': bool(sheet.get('date1904')), 'format_code': code,
            'iso_date': decoded.date().isoformat()}

NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

def displayed_text(element):
    # rPh contains phonetic guides, not part of a cell's displayed string.
    return ''.join((child.text or '') if child.tag==NS+'t' else ''.join(t.text or '' for t in child.findall(NS+'t')) if child.tag==NS+'r' else '' for child in element)

def column(number):
    label=''
    while number:
        number,n=divmod(number-1,26);label=chr(65+n)+label
    return label

def position(cell):
    m=re.fullmatch(r'([A-Z]+)([1-9][0-9]*)',cell.replace('$',''))
    if not m:raise ValueError('Not a cell: '+cell)
    n=0
    for c in m[1]:n=n*26+ord(c)-64
    return int(m[2]),n

def table(raw,fmt):
    if fmt=='csv':
        for encoding in ['utf-8-sig','cp932','utf-16']:
            try:rows=list(csv.reader(io.StringIO(raw.decode(encoding))));break
            except UnicodeError:pass
        else:raise ValueError('Unrecognized CSV encoding')
        cells={column(j)+str(i):v for i,row in enumerate(rows,1) for j,v in enumerate(row,1) if v.strip()}
        return [{'name':'CSV','cells':cells,'merges':[],'formulas':{},'row_count':len(rows),
            'column_count':max(map(len,rows),default=0),'row_widths':dict(__import__('collections').Counter(map(len,rows))),
            'encoding':encoding,'row_settings':{},'column_settings':[],'cell_styles':{},'number_formats':[]}]
    if fmt!='xlsx':raise ValueError('Original format not supported for this review')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        shared=[]
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared=[displayed_text(el) for el in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        book=ET.fromstring(archive.read('xl/workbook.xml'))
        properties=book.find(NS+'workbookPr')
        date1904=properties is not None and properties.get('date1904') in {'1','true'}
        rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        formats=[]
        if 'xl/styles.xml' in archive.namelist():
            styles=ET.fromstring(archive.read('xl/styles.xml'))
            custom={x.attrib['numFmtId']:x.attrib['formatCode'] for x in styles.iter(NS+'numFmt')}
            xfs=styles.find(NS+'cellXfs')
            if xfs is not None:
                formats=[{'numFmtId':x.get('numFmtId','0'),'custom_format_code':custom.get(x.get('numFmtId','0'))} for x in xfs]
        result=[]
        for entry in book.find(NS+'sheets'):
            target=rels[entry.attrib[REL+'id']]
            path=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
            if not path.startswith('xl/'):raise ValueError('Worksheet outside OOXML package')
            tree=ET.fromstring(archive.read(path));cells={};formulas={};cell_styles={};errors={}
            for cell in tree.iter(NS+'c'):
                ref=cell.attrib['r'];kind=cell.get('t');v=cell.find(NS+'v');f=cell.find(NS+'f')
                if cell.get('s') is not None:cell_styles[ref]=int(cell.get('s'))
                if f is not None:formulas[ref]='='+(f.text or '')
                if kind=='s':value=shared[int(v.text)] if v is not None and v.text is not None else None
                elif kind=='inlineStr':value=displayed_text(cell.find(NS+'is'))
                elif v is None or v.text is None:value=None
                elif kind in {'str','e','d'}:value=v.text
                elif kind=='b':value=v.text=='1'
                else:
                    try:value=int(v.text)
                    except ValueError:
                        try:value=float(v.text)
                        except ValueError:value=v.text
                if value is not None and str(value).strip():cells[ref]=value
                if kind=='e':errors[ref]=value
            result.append({'name':entry.attrib['name'],'cells':cells,'formulas':formulas,'errors':errors,
                'merges':[r.attrib['ref'] for r in tree.iter(NS+'mergeCell')],
                'row_count':max((position(c)[0] for c in cells),default=0),
                'column_count':max((position(c)[1] for c in cells),default=0),
                'encoding':'OOXML','state':entry.get('state','visible'),'date1904':date1904,
                'row_settings':{int(x.attrib['r']):dict(x.attrib) for x in tree.iter(NS+'row') if x.get('hidden') in {'1','true'}},
                'column_settings':[dict(x.attrib) for x in tree.iter(NS+'col')],
                'cell_styles':cell_styles,'number_formats':formats})
        return result

def populated_rows(sheet,start=1):
    rows={}
    for cell,value in sheet['cells'].items():
        r,c=position(cell)
        if r>=start:rows.setdefault(r,{})[c]=value
    return sorted(rows.items())

def range_evidence(sheet,ref,limit=12):
    normalized=ref
    if match:=re.fullmatch(r'R(\d+)C(\d+)',ref):normalized=column(int(match[2]))+match[1]
    elif match:=re.fullmatch(r'行(\d+)(?:-(\d+))?',ref):normalized=f'A{match[1]}:{column(max(sheet["column_count"],1))}{match[2] or match[1]}'
    elif match:=re.fullmatch(r'列(\d+)(?:-(\d+))?',ref):normalized=f'{column(int(match[1]))}1:{column(int(match[2] or match[1]))}{max(sheet["row_count"],1)}'
    try:
        a,b=normalized.split(':') if ':' in normalized else (normalized,normalized)
        r1,c1=position(a);r2,c2=position(b)
    except ValueError:return {'reference':ref,'unsupported_reference':True}
    # A representative cell or small rectangle must not scan a whole large
    # population table for each of its many numeric-column findings. Preserve
    # the identical row/column ordering and evidence shape.
    if 0<=(r2-r1+1)*(c2-c1+1)<=1024 and r2>=r1 and c2>=c1:
        candidates=(column(c)+str(r) for r in range(r1,r2+1) for c in range(c1,c2+1))
        matches=[(cell,sheet['cells'][cell]) for cell in candidates if cell in sheet['cells']]
    else:
        matches=[(cell,value) for cell,value in sheet['cells'].items() if r1<=position(cell)[0]<=r2 and c1<=position(cell)[1]<=c2]
    matches.sort(key=lambda x:position(x[0]))
    overlap=lambda span:position(span.split(':')[0])[0]<=r2 and position(span.split(':')[-1])[0]>=r1 and position(span.split(':')[0])[1]<=c2 and position(span.split(':')[-1])[1]>=c1
    style_cells=[cell for cell in dict(matches[:limit]) if cell in sheet.get('cell_styles',{})]
    styles={cell:{'style_index':sheet['cell_styles'][cell],**sheet['number_formats'][sheet['cell_styles'][cell]]} for cell in style_cells}
    return {'reference':ref,'normalized_range':normalized,'populated_cells':len(matches),'values':dict(matches[:limit]),
        'sample_truncated':len(matches)>limit,'formulas':{k:v for k,v in sheet['formulas'].items() if k in dict(matches[:limit])},
        'merged_ranges':[span for span in sheet['merges'] if overlap(span)],
        'hidden_rows':[r for r in sheet.get('row_settings',{}) if r1<=r<=r2],
        'column_settings':[x for x in sheet.get('column_settings',[]) if int(x['min'])<=c2 and int(x['max'])>=c1],
        'cell_number_formats':styles}
