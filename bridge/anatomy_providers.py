"""Offline provider contract: calibrated NIfTI in, labels on the same grid out.

Only owner-reviewed registry entries and checksum-verified local weights are used.
MONAI is optional; importing this file never imports torch or MONAI.
"""
from pathlib import Path
import numpy as np
import nibabel as nib


class TotalSegmentatorProvider:
    name = 'TotalSegmentator 2.18.0'

    def infer(self, image, model, root, device):
        from totalsegmentator.python_api import totalsegmentator
        from totalsegmentator.map_to_binary import class_map
        result = totalsegmentator(image, output=None, ml=True, task=model['id'],
                                 fast=model['fast'], nr_thr_resamp=1, nr_thr_saving=1,
                                 device=device, quiet=True, skip_saving=True,
                                 statistics=False, radiomics=False, preview=False)
        return result, class_map[model['id']]


def validate_monai_config(model, image):
    """This adapter accepts native-grid models, never guesses their preprocessing."""
    config = model.get('inference', {})
    spacing = config.get('spacingMm', [])
    actual = np.linalg.norm(image.affine[:3, :3], axis=0)
    orientation = ''.join(nib.aff2axcodes(image.affine))
    roi = config.get('roiSize', [])
    labels = config.get('labels', [])
    scale = config.get('intensity', {})
    if (len(spacing) != 3 or not np.allclose(actual, spacing, atol=.01, rtol=0)
            or orientation != config.get('orientation')
            or len(roi) != 3 or any(type(n) is not int or n < 4 or n > 256 for n in roi)
            or len(labels) < 2 or len(labels) > 256 or labels[0] != 'background'
            or any(not isinstance(n, str) or not n or len(n) > 120 for n in labels)
            or scale.get('mode') != 'linear'
            or not all(type(scale.get(k)) in (int, float) and np.isfinite(scale[k]) for k in ('min', 'max'))
            or scale['max'] <= scale['min']):
        raise ValueError('model_input_mismatch')
    if np.prod(image.shape)*len(labels)*4 > 512*1024*1024:
        raise ValueError('out_of_memory')
    return config


class MonaiTorchScriptProvider:
    """MONAI sliding-window inference for an explicitly reviewed TorchScript model.

    The reviewed export must accept N,C,X,Y,Z and return class logits at the same
    resolution. Models requiring other preprocessing need a dedicated adapter.
    No model is silently reoriented or resampled to a guessed training protocol.
    """
    name = 'MONAI native-grid TorchScript adapter'

    def infer(self, image, model, root, device):
        config = validate_monai_config(model, image)
        weights = (Path(root) / 'weights').resolve()
        filename = (weights / config.get('file', '')).resolve()
        if not filename.is_relative_to(weights) or not filename.is_file():
            raise ValueError('model_missing')
        # The caller verifies all manifest files first. Also require this exact
        # file to be listed, so an unverified neighbouring model cannot be loaded.
        import json
        manifest = json.loads((Path(root) / 'weights-manifest.json').read_text(encoding='utf-8'))
        if filename.relative_to(weights).as_posix() not in manifest['tasks'][model['id']]['files']:
            raise ValueError('model_checksum')
        try:
            import torch
            from monai.inferers import sliding_window_inference
        except ImportError as error:
            raise ValueError('provider_missing') from error
        target = 'cuda' if device == 'gpu' else 'cpu'
        network = torch.jit.load(str(filename), map_location=target).eval()
        values = np.asarray(image.dataobj, dtype=np.float32)
        intensity = config['intensity']
        values = np.clip((values-intensity['min'])/(intensity['max']-intensity['min']), 0, 1)
        inputs = torch.from_numpy(np.ascontiguousarray(values))[None, None]
        with torch.inference_mode():
            output = sliding_window_inference(inputs, config['roiSize'], 1, network,
                                              overlap=.25, mode='gaussian',
                                              sw_device=target, device='cpu')
            if (not isinstance(output, torch.Tensor)
                    or tuple(output.shape) != (1, len(config['labels']), *image.shape)
                    or not torch.isfinite(output).all()):
                raise ValueError('output_geometry_mismatch')
            labels = output.argmax(dim=1)[0].numpy().astype(np.uint8)
        return nib.Nifti1Image(labels, image.affine), dict(enumerate(config['labels']))


def provider_for(model):
    providers = {'totalsegmentator': TotalSegmentatorProvider,
                 'monai-torchscript': MonaiTorchScriptProvider}
    provider = providers.get(model.get('provider'))
    if provider is None:
        raise ValueError('provider_missing')
    return provider()
