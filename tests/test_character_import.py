import hashlib,json,tempfile,unittest
from pathlib import Path
from opensmash_melee.character_import import source_url,import_source,FILES
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'opensmash/pipeline/play/ui/alanturing'
BASE='https://smash.fun/engine/character-source/'+'a'*48+'/'
class SourceImportTests(unittest.TestCase):
 def test_rejects_legacy_links_credentials_and_arbitrary_hosts(self):
  for url in ['file:///etc/passwd','http://127.0.0.1/secret','https://smash.fun@evil.test/a',BASE+'manifest.json?secret=1','https://smash.fun/engine/bundles/foo.osb6']:
   with self.assertRaises(ValueError):source_url(url,{'https://smash.fun'})
  self.assertEqual(source_url(BASE+'manifest.json',{'https://smash.fun'}),BASE+'manifest.json')
 @unittest.skipUnless((SOURCE/'rigged.glb').exists(),'Local generated source required')
 def test_hash_validation_asset_scope_and_source_roundtrip(self):
  assets={name:(SOURCE/name).read_bytes() for name in FILES}
  manifest={'format':'opensmash-source-v1','name':'Imported Turing','short':'TURING','files':{name:{'url':BASE+name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)} for name,raw in assets.items()}}
  def fetch(url,limit):return json.dumps(manifest).encode() if url.endswith('manifest.json') else assets[url.rsplit('/',1)[1]]
  with tempfile.TemporaryDirectory() as directory:
   dest=Path(directory);row=import_source(BASE+'manifest.json',dest,{'https://smash.fun'},fetch)
   self.assertEqual(row['name'],'Imported Turing');self.assertEqual((dest/'rigged.glb').read_bytes(),assets['rigged.glb'])
   self.assertNotIn('url',row)
   self.assertEqual(json.loads((dest/'character.json').read_text())['display'],'Imported Turing')
   manifest['files']['rigged.glb']['url']='https://smash.fun/other/rigged.glb'
   with self.assertRaisesRegex(ValueError,'same character'):import_source(BASE+'manifest.json',dest,{'https://smash.fun'},fetch)
   manifest['files']['rigged.glb']['url']=BASE+'rigged.glb';manifest['files']['rigged.glb']['sha256']='0'*64
   with self.assertRaisesRegex(ValueError,'integrity'):import_source(BASE+'manifest.json',dest,{'https://smash.fun'},fetch)
