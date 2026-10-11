"""Provider contract/configuration tests; not MONAI inference validation."""
import sys
from pathlib import Path
import unittest
import numpy as np
import nibabel as nib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from anatomy_providers import provider_for, validate_monai_config

class Providers(unittest.TestCase):
    def test_default_and_explicit_optional_provider(self):
        self.assertIn('TotalSegmentator',provider_for({'provider':'totalsegmentator'}).name)
        self.assertIn('MONAI',provider_for({'provider':'monai-torchscript'}).name)
        with self.assertRaises(ValueError):provider_for({'provider':'remote-unknown'})

    def test_native_grid_never_guesses_model_preprocessing(self):
        image=nib.Nifti1Image(np.zeros((8,8,8),dtype=np.float32),np.diag([1,1,2,1]))
        config=dict(spacingMm=[1,1,2],orientation='RAS',roiSize=[8,8,8],labels=['background','liver'],intensity=dict(mode='linear',min=-100,max=300))
        self.assertEqual(validate_monai_config({'inference':config},image),config)
        for changes in [dict(spacingMm=[1,1,1]),dict(orientation='LPS'),dict(labels=['background']),dict(intensity=dict(mode='guess')),dict(roiSize=[9999,8,8])]:
            with self.assertRaises(ValueError):validate_monai_config({'inference':{**config,**changes}},image)

if __name__=='__main__':unittest.main()
