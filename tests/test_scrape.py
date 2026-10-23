import importlib.util
import json
import tempfile
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'parser'))

spec = importlib.util.spec_from_file_location('scrape', Path(__file__).resolve().parents[1] / 'parser/scrape.py')
scrape = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scrape)


def row(label, value):
    return f'<div class="object-info-item"><div class="object-info_left">{label}</div><div class="object-info_right">{value}</div></div>'


class ParserTests(unittest.TestCase):
    def test_real_layout_fields_and_apostrophe(self):
        html = ''.join(row(k,v) for k,v in [
            ('Реєстраційний номер в ЄДЕССБ','ІУ051260922713'),
            ('Назва об’єкта', 'Нове будівництво'),
            ('Дата реєстрації в ЄДЕССБ','22.09.2026'),
            ('Адреса','Львівська обл., с. Волосянка'), ('Статус документу','Діючий')])
        result = scrape.parse_detail(html, 'https://e-construction.gov.ua/document_detail/doc_id=1')
        self.assertEqual(result['object_name'], 'Нове будівництво')
        self.assertTrue(scrape.eligible(result, '2026-09-01','2026-09-30'))
        result['address'] = 'Київська обл.'
        self.assertFalse(scrape.eligible(result, '2026-09-01','2026-09-30'))

    def test_duplicate_links_and_pagination(self):
        a = '<a href="document_detail/doc_id=1">Деталі</a>'
        links, more = scrape.list_links(f'<div class="datasets__list">{a}{a}</div><li class="pagination__next"><a filter-user="page=2"></a></li>')
        self.assertEqual(len(links), 1)
        self.assertTrue(more)
        with self.assertRaises(ValueError):
            scrape.list_links('<html>Access denied</html>')
        with self.assertRaises(ValueError):
            scrape.parse_detail('<html>Maintenance</html>', 'url')

    def test_merge_preserves_archive_and_updates_existing(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            (output / 'constructions.json').write_text(json.dumps({'items':[
                {'doc_number':'old','reg_date':'2026-01-01'},
                {'doc_number':'new','reg_date':'2026-09-01','customer':'before'}]}))
            scrape.save([{'doc_number':'new','reg_date':'2026-09-01','customer':'=unsafe'}], output, '2026-09-01','2026-09-30')
            result = json.loads((output / 'constructions.json').read_text())
            self.assertEqual(result['count'], 2)
            self.assertEqual(result['items'][0]['customer'], '=unsafe')
            self.assertIn("'=unsafe", (output/'constructions.csv').read_text())


if __name__ == '__main__':
    unittest.main()
