import sys
import tempfile
import json
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'parser'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from regions import region_of, select_regions, REGIONS
from scrape import list_url, eligible
from merge_regions import merge


class RegionTests(unittest.TestCase):
    def test_country_requires_explicit_confirmation(self):
        self.assertEqual(select_regions('', ['lviv']), ['lviv'])
        self.assertEqual(select_regions('lviv,odesa,lviv', ['lviv']), ['lviv','odesa'])
        with self.assertRaises(ValueError): select_regions('all', ['lviv'])
        with self.assertRaises(ValueError): select_regions('', list(REGIONS))
        with self.assertRaises(ValueError): select_regions('all', ['lviv'], confirmed=True, manual=False)
        self.assertEqual(len(select_regions('all', ['lviv'], confirmed=True, manual=True)),len(REGIONS))

    def test_different_oblast_and_kyiv(self):
        self.assertEqual(region_of('Одеська обл., м. Одеса'),'odesa')
        self.assertEqual(region_of('Київська область, м. Бровари'),'kyiv-oblast')
        self.assertEqual(region_of('Україна, м.Київ, вулиця Хрещатик'),'kyiv-city')
        record={'address':'Одеська обл., м. Одеса','reg_date':'2026-10-22','status':'Діючий'}
        self.assertTrue(eligible(record,'2026-10-01','2026-10-23','odesa'))
        self.assertFalse(eligible(record,'2026-10-01','2026-10-23','lviv'))
        self.assertNotEqual(list_url('2026-10-01','2026-10-23',1,'odesa'),list_url('2026-10-01','2026-10-23',1,'lviv'))

    def test_merge_preserves_other_region_after_partial_success(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'data').mkdir();artifacts=root/'artifacts/region-odesa';artifacts.mkdir(parents=True)
            (root/'data/constructions.json').write_text(json.dumps({'items':[{'doc_number':'old','address':'Львівська обл., м. Львів','reg_date':'2026-10-01'}]}))
            (artifacts/'constructions.json').write_text(json.dumps({'region_key':'odesa','updated_at':'2026-10-23','items':[{'doc_number':'new','address':'Одеська обл., м. Одеса','reg_date':'2026-10-22'}]}))
            merge(root,root/'artifacts')
            data=json.loads((root/'data/constructions.json').read_text())
            self.assertEqual(data['count'],2)
            self.assertEqual({r['region_key'] for r in data['items']},{'odesa','lviv'})
