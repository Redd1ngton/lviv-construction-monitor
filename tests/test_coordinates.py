import sys
import unittest
from pathlib import Path
from bs4 import BeautifulSoup
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'parser'))
from coordinates import point, extract


class CoordinatesTests(unittest.TestCase):
    def test_registry_centroid_order(self):
        self.assertEqual(point({'centroid':{'coordinates':[49.8,23.95]}})['lat'],49.8)
        self.assertEqual(point({'centroid':{'coordinates':[23.95,49.8]}})['lat'],49.8)
        self.assertIsNone(point({'centroid':{'coordinates':[49.16,33.69]}}))

    def test_cadastral_link_default_center_is_not_object_position(self):
        html = '<a href="https://map.land.gov.ua/?cc=3750399.38328253,6300642.82793137&cadnum=4623683300:05:000:0318">4623683300:05:000:0318</a>'
        coords, parcels = extract(BeautifulSoup(html,'html.parser'))
        self.assertEqual(coords,{})
        self.assertEqual(parcels,['4623683300:05:000:0318'])

    def test_explicit_marker(self):
        coords,_ = extract(BeautifulSoup('<script>L.marker([49.8,23.95]).addTo(map)</script>','html.parser'))
        self.assertEqual(coords['lon'],23.95)
