import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'parser'))
from address import address_fields,address_point

class AddressTests(unittest.TestCase):
 def test_street_and_house_from_location_description(self):
  fields=address_fields('Львівська обл., м. Львів (станом на 01.01.2021)','вулиця Шевченка, буд. 12')
  self.assertEqual(fields['house_number'],'12');self.assertIn('вулиця Шевченка',fields['full_address']);self.assertIn('буд. 12',fields['full_address'])
 def test_ambiguous_or_wrong_street_not_accepted(self):
  record={'address':'Львівська обл., м. Львів',**address_fields('Львівська обл., м. Львів','вулиця Шевченка, буд. 12')}
  payload={'Location':{'DisplayPosition':{'Latitude':49.84,'Longitude':24.03},'Address':{'Street':'вулиця Шевченка','City':'Львів','HouseNumber':'12','Label':'Львів, вулиця Шевченка, 12'}}}
  self.assertEqual(address_point(payload,record)['coord_source'],'registry_address')
  payload['Location']['Address']['HouseNumber']='14';self.assertIsNone(address_point(payload,record))
  payload['Location']['Address']['HouseNumber']='12';payload['Location']['Address']['City']='Одеса';payload['Location']['Address']['Label']='Одеса';self.assertIsNone(address_point(payload,record))
 def test_cadastre_number_is_not_street(self):
  self.assertEqual(address_fields('Львівська обл., с. Скнилів','4623683300:05:000:0318')['street_address'],'')
