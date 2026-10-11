"""Private, offline FleXray experiment. JSON-lines over an inherited pipe only.

No HTTP listener, patient identifiers, image files, telemetry or API credentials.
Weights: VictorButoi/flexray, CC BY-NC 4.0; research, not clinical use.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageOps
import onnxruntime as ort

MODEL_SHA = 'b8eb8851121cc694f9b529f2cd46f4f1bda29fcbb0eada7b1512af0d57462f15'
MAX_PIXELS = 16777216
LIMB_GROUPS = {
    'upper': {'scapulae','clavicles','humeri','phalanges','metacarpals','carpals','radii','ulnae'},
    'lower': {'hips','sacrum','femurs','patellae','tibiae','fibulae','tarsals','metatarsals','toes'},
}


def permitted_groups(body_part):
    # Use only explicit DICOM body-part metadata, never an inferred body region.
    part=str(body_part).upper().replace(' ', '').replace('_', '')
    if part in {'HAND','WRIST','FOREARM','ARM','UPPERARM','ELBOW'}:
        return LIMB_GROUPS['upper']
    if part in {'FOOT','ANKLE','LEG','LOWERLEG','KNEE','THIGH'}:
        return LIMB_GROUPS['lower']
    return set(LABELS[1:])
LABELS = ['background', 'skull', 'scapulae', 'clavicles', 'humeri', 'phalanges',
          'metacarpals', 'carpals', 'radii', 'ulnae', 'tibiae', 'femurs', 'patellae',
          'fibulae', 'metatarsals', 'tarsals', 'toes'] + [f'rib_{i}' for i in range(1, 13)] + [
          'sternum'] + [f'vertebra_{level}{i}' for level, count in [('c', 7), ('t', 12), ('l', 5)]
                       for i in range(1, count + 1)] + ['hips', 'sacrum', 'kidneys', 'liver', 'spleen', 'lungs', 'heart']


def prepare(raw, width, height, invert=False):
    """Match the official DICOM -> PIL float bilinear -> percentile contract."""
    values = np.frombuffer(raw, dtype='<f4').reshape(height, width).copy()
    if not np.isfinite(values).all():
        raise ValueError('invalid_pixels')
    low, high = float(values.min()), float(values.max())
    if high <= low:
        raise ValueError('no_contrast')
    values = (values - low) / (high - low)
    if invert:
        values = 1 - values
    side = max(width, height)
    left, top = (side - width) // 2, (side - height) // 2
    image = ImageOps.expand(Image.fromarray(values), (left, top, side-width-left, side-height-top), fill=0)
    resized = np.asarray(image.resize((256, 256), Image.Resampling.BILINEAR), dtype=np.float32)
    lo, hi = np.percentile(resized, [0.5, 99.5])
    if hi <= lo:
        raise ValueError('no_contrast')
    normalized = np.clip((resized - lo) / max(float(hi-lo), 1e-8), 0, 1).astype(np.float32)
    return normalized[None, None], (side, left, top)


def validate(request):
    width, height = request.get('width'), request.get('height')
    if type(width) is not int or type(height) is not int or not (16 <= width <= 16384 and 16 <= height <= 16384) or width*height > MAX_PIXELS:
        raise ValueError('invalid_size')
    x, y = request.get('x'), request.get('y')
    if type(x) not in (int, float) or type(y) not in (int, float) or not (0 <= x < width and 0 <= y < height):
        raise ValueError('outside_image')
    if request.get('modality') not in ('DX', 'CR') or request.get('photometric') not in ('MONOCHROME1', 'MONOCHROME2'):
        raise ValueError('unsupported_image')
    if any(term in str(request.get('bodyPart', '')).upper() for term in ('BREAST', 'DENT', 'TOOTH', 'TEETH', 'MAMMO')):
        raise ValueError('unsupported_image')
    raw = base64.b64decode(request.get('pixels', ''), validate=True)
    if len(raw) != width * height * 4:
        raise ValueError('invalid_pixels')
    return raw, width, height, x, y


class Recognizer:
    def __init__(self, model):
        if hashlib.sha256(Path(model).read_bytes()).hexdigest() != MODEL_SHA:
            raise ValueError('model_checksum')
        options = ort.SessionOptions()
        options.enable_mem_pattern = False
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
        # CPU is deterministic across Windows adapters; DirectML must be explicitly
        # enabled after verifying this exact model on a supported adapter.
        providers = ['CPUExecutionProvider']
        if os.environ.get('RADAZ_ANATOMY_DIRECTML') == '1':
            providers = ['DmlExecutionProvider', 'CPUExecutionProvider']
        self.session = ort.InferenceSession(str(model), sess_options=options, providers=providers)
        self.cache_key = None
        self.probabilities = None

    def recognize(self, request):
        raw, width, height, x, y = validate(request)
        invert = request['photometric'] == 'MONOCHROME1'
        key = (hashlib.sha256(raw).digest(), width, height, invert)
        cached = key == self.cache_key
        if not cached:
            tensor, _ = prepare(raw, width, height, invert)
            input_type = self.session.get_inputs()[0].type
            if input_type == 'tensor(float16)':
                tensor = tensor.astype(np.float16)
            result = self.session.run(['probabilities'], {'input': tensor})[0]
            if result.shape != (1, 61, 256, 256) or not np.isfinite(result).all():
                raise ValueError('invalid_output')
            self.probabilities = result[0].astype(np.float32)
            self.cache_key = key
        # Pixel centres, including asymmetric one-pixel padding, map into the
        # same 256-square canvas used for inference. Interpolate probabilities.
        side = max(width, height)
        px = np.clip((x + (side-width)//2 + .5) * 256/side - .5, 0, 255)
        py = np.clip((y + (side-height)//2 + .5) * 256/side - .5, 0, 255)
        x0, y0 = int(px), int(py)
        dx, dy = px-x0, py-y0
        p = self.probabilities
        scores = ((1-dx)*(1-dy)*p[:, y0, x0] + dx*(1-dy)*p[:, y0, min(255,x0+1)]
                  + (1-dx)*dy*p[:, min(255,y0+1), x0] + dx*dy*p[:, min(255,y0+1), min(255,x0+1)])
        allowed = permitted_groups(request.get('bodyPart', ''))
        indices = sorted((i for i in range(1, 61) if scores[i] >= .5 and LABELS[i] in allowed), key=lambda i: -float(scores[i]))
        return {'labels': [LABELS[i] for i in indices], 'cached': cached, 'model': 'FleXray flux0375', 'experimental': True}


def main():
    recognizer = None
    for line in sys.stdin.buffer:
        try:
            request = json.loads(line)
            validate(request)  # Do not load a large model for malformed requests.
            if recognizer is None:
                recognizer = Recognizer(Path(sys.argv[1]) / 'model.onnx')
            result = recognizer.recognize(request)
        except Exception as error:
            # Never echo pixels, paths or arbitrary request strings into logs.
            code = str(error) if isinstance(error, ValueError) else 'inference_failed'
            if code not in {'invalid_pixels','invalid_size','outside_image','unsupported_image','no_contrast','model_checksum','invalid_output'}:
                code = 'inference_failed'
            result = {'error': code}
        print(json.dumps(result, allow_nan=False), flush=True)


if __name__ == '__main__':
    main()
