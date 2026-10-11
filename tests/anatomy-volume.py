"""Real local CT/MR model against official public reference segmentations.

Run with the private module Python. No downloads, no patient files.
"""
import importlib.util
import json
from pathlib import Path
import sys
import numpy as np
import nibabel as nib

def main():
    root=Path(__file__).resolve().parents[1]
    module=Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(root/'bridge'))
    kinds=sys.argv[2:] or ['ct','mr']
    spec=importlib.util.spec_from_file_location('volume',root/'bridge/radaz_anatomy_volume.py')
    volume=importlib.util.module_from_spec(spec);spec.loader.exec_module(volume)
    reports=[]
    for kind in kinds:
        folder=root/'outputs/anatomy-volume'/kind
        sys.argv=['radaz_anatomy_volume.py',str(folder),str(module)]
        volume.main()
        meta=json.loads((folder/'result.json').read_text())
        result=np.fromfile(folder/'labels.bin',dtype=np.uint8).reshape(meta['dimensions'][::-1]).transpose(2,1,0)
        reference=nib.load(folder.parent/('example_seg_fast.nii.gz' if kind=='ct' else 'example_seg_mr.nii.gz'))
        assert result.shape==reference.shape
        np.testing.assert_allclose(volume.validate_geometry(meta),reference.affine,atol=1e-4)
        expected=np.asarray(reference.dataobj)
        scores={}
        for value,name in meta['classes'].items():
            a=result==int(value);b=expected==int(value)
            if b.sum()>100:scores[name]=float(2*np.count_nonzero(a&b)/(a.sum()+b.sum()))
        assert len(scores)>=10,scores
        median=float(np.median(list(scores.values())))
        assert median>.8,(kind,median,scores)
        assert 'liver' in scores and scores['liver']>.85,scores
        report=dict(modality=kind,device=meta['device'],seconds=meta['seconds'],structures=len(meta['classes']),referenceMedianDice=median,referenceScores=scores,clinicalValidation=False)
        reports.append(report)
        print('PASS:',kind,meta['device'],meta['seconds'],'seconds; reference median Dice',round(median,3),flush=True)
        (folder/'probe.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__':main()
