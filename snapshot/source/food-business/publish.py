"""Idempotent navigation/sitemap integration; preserve unrelated article markup."""
import re
import build

CARD='<a data-keywords="食品衛生 食品営業許可 飲食店 菓子製造 保健所 都道府県 月次" href="/analysis/food-business/"><b>食品営業許可施設を調べ、毎月の掲載変化を追う</b><span>都道府県・保健所設置市・特別区の公表情報を検索し、公開元別の記録を読む</span></a>'
START='<!-- food-business-directory:start -->'
END='<!-- food-business-directory:end -->'

def update(check=False):
    paths=['/food-business/','/analysis/food-business/']
    for p in (build.ROOT/'analysis/food-business').rglob('index.html'):
        paths.append('/'+str(p.parent.relative_to(build.ROOT))+'/')
    paths=sorted(set(paths))
    index=(build.ROOT/'analysis/index.html').read_text()
    index=re.sub(re.escape(START)+r'.*?'+re.escape(END),'',index,flags=re.S)
    # Migrate the original card out of another generator's owned section.
    index=index.replace(CARD,'')
    marker='<!-- facility-monthly-directory:start -->'
    pos=index.find(marker)
    if pos<0:pos=index.find('<section aria-labelledby="baseup-notifications-title">')
    if pos<0:raise ValueError('Article index section insertion point is unavailable')
    section=START+'<section><h2>食品営業許可・届出の掲載情報を調べる</h2><div class="articlelist">'+CARD+'</div></section>'+END
    index=index[:pos]+section+index[pos:]
    sitemap=(build.ROOT/'sitemap.xml').read_text()
    for path in paths:
        sitemap=re.sub(r'^[ \t]*<url>\s*<loc>'+re.escape('https://municipal-smr.jp'+path)+r'</loc>.*?</url>[ \t]*\n?', '',sitemap,flags=re.S|re.M)
    # Keep this group before the independent facility and population URL groups.
    marker=re.search(r'<url>\s*<loc>https://municipal-smr\.jp/analysis/</loc>.*?</url>',sitemap,re.S)
    if not marker:raise ValueError('Article index sitemap entry is unavailable')
    pos=sitemap.index('\n',marker.end())+1
    items=''.join('  <url><loc>https://municipal-smr.jp'+path+'</loc></url>\n' for path in paths)
    sitemap=sitemap[:pos]+items+sitemap[pos:]
    for base in (build.ROOT,build.ROOT/'source/public'):
        build.put(base/'analysis/index.html',index,check)
        build.put(base/'sitemap.xml',sitemap,check)
    return len(paths)
if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('--check',action='store_true');args=ap.parse_args();print('Navigation/sitemap routes:',update(args.check))
