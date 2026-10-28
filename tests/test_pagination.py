import sys,unittest,tempfile,json
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'parser'))
import scrape


def field(name,value):
 return f'<div class="object-info-item"><div class="object-info_left">{name}</div><div class="object-info_right">{value}</div></div>'


class PaginationTests(unittest.TestCase):
 def run_pages(self, terminal):
  first='<div class="opendata__top"><p>2 записів</p></div><div class="datasets__list"><a href="document_detail/doc_id=1">1</a><a href="document_detail/doc_id=2">2</a></div><li class="pagination__next"><a filter-user="page=2"></a></li>'
  last='<div class="datasets__list"><a href="document_detail/doc_id=2">2</a></div>'
  if not terminal:last=first
  calls=[]
  def get(url,**kwargs):
   calls.append(url)
   if '/document/optype=' in url:html=last if '/page=2' in url else first
   else:
    n='1' if 'doc_id=1' in url else '2'
    html=''.join(field(k,v) for k,v in [('Реєстраційний номер в ЄДЕССБ','ІУ05126102700'+n),('Дата реєстрації в ЄДЕССБ','27.10.2026'),('Адреса','Львівська обл., м. Львів'),('Статус документу','Діючий'),('Назва об’єкта','Будівництво')])
   return Mock(text=html,raise_for_status=Mock())
  session=Mock();session.headers={};session.get.side_effect=get
  with tempfile.TemporaryDirectory() as folder,patch.object(scrape.requests,'Session',return_value=session),patch.object(scrape,'snapshot'),patch.object(sys,'argv',['scrape','--from-date','2026-10-21','--to-date','2026-10-28','--delay','0','--output-dir',folder]):
   if terminal:
    scrape.main();payload=json.loads((Path(folder)/'constructions.json').read_text());self.assertEqual(payload['count'],2)
    self.assertEqual(sum('/document_detail/' in url for url in calls),2)
   else:
    with self.assertRaisesRegex(RuntimeError,'non-final'):scrape.main()
    self.assertFalse((Path(folder)/'constructions.json').exists())
 def test_terminal_overlap_keeps_verified_records(self):self.run_pages(True)
 def test_repeated_nonterminal_page_still_fails(self):self.run_pages(False)
