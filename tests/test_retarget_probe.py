import copy, unittest
from pathlib import Path
import numpy as np
from opensmash_melee.archive import Archive
from opensmash_melee.gx import isolate_body_texture_animation
from opensmash_melee.retarget_probe import TARGETS,load
from opensmash_melee.multi_fighter import TARGETS as SHIPPING,load_target,fit
from opensmash_melee.proportions import source_head_fit
from opensmash_melee.glb import GLB
from opensmash_melee.retarget import conform
from opensmash_melee.target_presentation import attachment_transform
from tools.validate_shape import shape_metrics
ROOT=Path(__file__).resolve().parents[1];GAME=ROOT/'assets/game/files'
SOURCE=ROOT.parent/'opensmash/pipeline/play/ui/alanturing/rigged.glb'

@unittest.skipUnless((GAME/'PlPpNr.dat').exists(),'Local validated game assets required')
class ProbeTests(unittest.TestCase):
 def test_material_isolation_preserves_other_list_entries(self):
  a=Archive.read(GAME/'PlPpNr.dat');symbol='PlyPopo5K_Share_joint';r=a.roots()['PlyPopo5K_Share_matanim_joint'];old=a.ptr(r+8);raw=bytes(a.data[old:old+16]);following=a.ptr(old)
  self.assertIsNotNone(a.ptr(old+8))
  image=a.alloc(24)
  self.assertTrue(isolate_body_texture_animation(a,symbol,0,image))
  new=a.ptr(r+8);self.assertNotEqual(new,old)
  self.assertEqual(bytes(a.data[old:old+16]),raw)
  self.assertEqual(a.ptr(new),following)
  self.assertEqual(a.ptr(new+4),a.ptr(old+4))
  tex=a.ptr(new+8);oldtex=a.ptr(old+8)
  self.assertNotEqual(tex,oldtex);self.assertEqual(a.ptr(tex+8),a.ptr(oldtex+8))
  count=a.unpack('H',tex+20)[0];self.assertGreater(count,0)
  self.assertEqual([a.ptr(a.ptr(tex+12)+i*4) for i in range(count)],[image]*count)
  b=Archive(a.serialize());self.assertEqual(b.ptr(new),following)
 def test_unbound_rigid_attachment_has_guarded_fallback(self):
  t=load(GAME,next(s for s in TARGETS if s[0]=='roy'));sk=t['skeleton']
  self.assertIsNone(sk[78]['inverse_bind'])
  p={'attachment_scale':1.5,'attachment_anchors':{'78':77}}
  m=attachment_transform(sk,'roy',78,p)
  np.testing.assert_allclose(np.linalg.svd(m[:3,:3],compute_uv=False),[1.5]*3,atol=1e-6)
  bad=copy.deepcopy(sk);bad[78]['scale']=[2,1,1]
  with self.assertRaisesRegex(ValueError,'scaled ancestry'):attachment_transform(bad,'roy',78,p)
 @unittest.skipUnless(SOURCE.exists(),'Local source mesh required')
 def test_all_rigs_fit_and_existing_targets_are_unchanged(self):
  mesh=GLB(SOURCE).mesh()
  for spec in TARGETS:
   with self.subTest(target=spec[0]):
    t=load(GAME,spec);p=fit(mesh,t)
    if spec[0] in SHIPPING:
     old=load_target(GAME,spec[0]);np.testing.assert_allclose(conform(mesh,t['skeleton'],p)['positions'],conform(mesh,old['skeleton'],fit(mesh,old))['positions'],atol=1e-8)
    p=source_head_fit(mesh,t['skeleton'],p);c=conform(mesh,t['skeleton'],p);m=shape_metrics(mesh,c,p,t['skeleton'])
    self.assertLess(m['head_anisotropy'],1.03);self.assertLess(m['head_fraction_relative_error'],.05)
    self.assertTrue(np.isfinite(c['positions']).all())
