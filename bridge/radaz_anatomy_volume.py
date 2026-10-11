"""Offline CT/MR research segmentation. Only a private, generated job folder.

DICOM LPS geometry is converted explicitly to NIfTI RAS. No clinical metadata,
telemetry, reports or outbound connections. Requires locally verified weights.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time

import numpy as np
import nibabel as nib

MAX_VOXELS = 32_000_000


def validate_geometry(meta):
    if meta.get('modality') not in ('CT', 'MR'):
        raise ValueError('unsupported_modality')
    dims = meta.get('dimensions', [])
    if len(dims) != 3 or any(type(n) is not int or not 3 <= n <= 2048 for n in dims) or np.prod(dims) > MAX_VOXELS:
        raise ValueError('invalid_dimensions')
    spacing = np.asarray(meta.get('spacing', []), dtype=float)
    origin = np.asarray(meta.get('origin', []), dtype=float)
    direction = np.asarray(meta.get('direction', []), dtype=float)
    if spacing.shape != (3,) or origin.shape != (3,) or direction.shape != (9,):
        raise ValueError('invalid_geometry')
    if not all(np.isfinite(a).all() for a in (spacing, origin, direction)) or np.any(spacing < .1) or np.any(spacing > 30) or np.any(np.abs(origin) > 1e6):
        raise ValueError('invalid_geometry')
    basis = direction.reshape(3, 3).T
    if not np.allclose(basis.T @ basis, np.eye(3), atol=1e-3) or not np.isclose(np.linalg.det(basis), 1, atol=1e-3):
        raise ValueError('invalid_geometry')
    affine = np.eye(4)
    affine[:3, :3] = basis * spacing
    affine[:3, 3] = origin
    return np.diag([-1, -1, 1, 1]) @ affine


def input_image(folder, meta):
    affine = validate_geometry(meta)
    x, y, z = meta['dimensions']
    if (folder / 'input.bin').stat().st_size != x*y*z*4:
        raise ValueError('incomplete_volume')
    raw = np.memmap(folder / 'input.bin', mode='r', dtype='<f4', shape=(z,y,x))
    if not np.isfinite(raw).all() or float(raw.max()) == float(raw.min()):
        raise ValueError('invalid_pixels')
    return nib.Nifti1Image(raw.transpose(2,1,0), affine)


def emit(phase, **values):
    print('RADAZ_VOLUME:' + json.dumps({'phase':phase, **values}), flush=True)


def verify_model(root, task):
    manifest = json.loads((root / 'weights-manifest.json').read_text())
    files = manifest['tasks'][task]['files']
    if not files:
        raise ValueError('model_missing')
    for name, digest in files.items():
        file = (root / 'weights' / name).resolve()
        if not file.is_relative_to((root / 'weights').resolve()) or not file.is_file():
            raise ValueError('model_missing')
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError('model_checksum')


def main():
    folder, root = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    started = time.monotonic()
    meta = json.loads((folder / 'meta.json').read_text())
    image = input_image(folder, meta)
    task = meta.get('task') or ('total' if meta['modality'] == 'CT' else 'total_mr')
    registry = json.loads(Path(__file__).with_name('anatomy-models.json').read_text())['models']
    model = next((m for m in registry if m['id'] == task), None)
    if not model or model['modality'] != meta['modality']:
        raise ValueError('unsupported_modality')
    if model['license'] != 'Apache-2.0':
        raise ValueError('restricted_model')
    emit('loading')
    verify_model(root, task)
    os.environ['TOTALSEG_HOME_DIR'] = str(root / 'config')
    os.environ['TOTALSEG_WEIGHTS_PATH'] = str(root / 'weights')
    os.environ['nnUNet_compile'] = 'false'
    os.environ['DO_NOT_TRACK'] = '1'
    # Refuse *all* external connections from this worker, even if a dependency
    # changes its telemetry/default download behaviour in a later release.
    original_connect = socket.socket.connect
    def offline_connect(sock, address):
        if isinstance(address, tuple) and address[0] in ('127.0.0.1','::1','localhost'):
            return original_connect(sock, address)
        raise OSError('RADAZ anatomy worker is offline')
    socket.socket.connect = offline_connect
    import torch
    torch.set_num_threads(4)
    # Windows embeddable Python does not add the script directory to sys.path.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from anatomy_providers import provider_for
    provider = provider_for(model)
    device = 'gpu' if torch.cuda.is_available() else 'cpu'
    emit('segmenting', device=device)
    result, classes = provider.infer(image, model, root, device)
    if result.shape != image.shape or not np.allclose(result.affine, image.affine, atol=1e-4):
        raise ValueError('output_geometry_mismatch')
    labels = np.asarray(result.dataobj, dtype=np.uint8)
    # This module names anatomy. Do not turn incidental pathology classes into
    # automated findings when the user requested an anatomical teaching tool.
    for value, name in classes.items():
        if name.startswith('kidney_cyst_'):
            labels[labels == value] = 0
    present = {str(int(value)):classes[int(value)] for value in np.unique(labels) if value and int(value) in classes}
    emit('finishing', device=device)
    labels.transpose(2,1,0).copy(order='C').tofile(folder / 'labels.bin')
    result_meta = {key:meta[key] for key in ('modality','dimensions','origin','direction','spacing')}
    result_meta.update(classes=present, task=task, model=provider.name,
                       modelSpacingMm=model.get('spacingMm'), device=device, seconds=round(time.monotonic()-started,1),
                       experimental=True, clinicalValidation=False)
    (folder / 'result.json').write_text(json.dumps(result_meta), encoding='utf-8')
    emit('ready', device=device)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Exception strings from libraries may contain temporary paths; return
        # only a fixed code to the application, not their arbitrary output.
        code = str(error) if isinstance(error, ValueError) else 'inference_failed'
        if 'out of memory' in str(error).lower():code = 'out_of_memory'
        if code not in {'provider_missing','model_input_mismatch','restricted_model','unsupported_modality','invalid_dimensions','invalid_geometry','incomplete_volume','invalid_pixels','model_missing','model_checksum','output_geometry_mismatch','out_of_memory'}:
            code = 'inference_failed'
        emit('error', error=code)
        sys.exit(1)
