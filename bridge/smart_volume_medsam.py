"""Private research adapter. No downloads, network calls, or automatic acceptance.

Upstream model weights are research/education-only at time of review.
Deployment requires a separately supplied checkpoint and an explicit research flag.
Input/output arrays use Z,Y,X; caller retains DICOM LPS geometry without resampling.
"""
from pathlib import Path
from threading import Event


class MedSAM2Adapter:
    def __init__(self, checkpoint, config, *, research_use=False, device='cuda'):
        if not research_use:
            raise PermissionError('MedSAM2 weights require a reviewed usage license')
        self.checkpoint = Path(checkpoint).resolve(strict=True)
        self.config, self.device = config, device
        self.predictor = None

    def infer(self, voxels, prompts, *, lower, upper, cancel=None, progress=lambda value: None, points=None):
        import numpy as np
        import torch
        from sam2.build_sam import build_sam2_video_predictor_npz
        cancel = cancel or Event()
        if voxels.ndim != 3 or not np.isfinite(voxels).all() or not np.isfinite([lower, upper]).all() or upper <= lower:
            raise ValueError('Finite 3D image and explicit intensity window required')
        points = points or {}
        if not prompts and not points:
            raise ValueError('At least one reviewed contour mask is required')
        depth, height, width = voxels.shape
        for index, mask in prompts.items():
            if not isinstance(index, int) or not 0 <= index < depth or mask.shape != (height, width) or not mask.any():
                raise ValueError('Invalid prompt mask')
        for index, xy in points.items():
            if not isinstance(index,int) or not 0 <= index < depth or len(xy)!=2 or not np.isfinite(xy).all() or not (0<=xy[0]<width and 0<=xy[1]<height):
                raise ValueError('Invalid point prompt')
        if self.predictor is None:
            self.predictor = build_sam2_video_predictor_npz(self.config, str(self.checkpoint), device=self.device, hydra_overrides_extra=['++model.fill_hole_area=0'], apply_postprocessing=False)
        predictor = self.predictor
        if cancel.is_set():
            raise InterruptedError('Cancelled')
        # Explicit windowing supplied by the user; no CT HU assumptions for MRI.
        class Frames:
            # Normalize one frame at a time; never allocate the entire RGB volume.
            def __len__(self): return depth
            def __getitem__(self, index):
                values = np.clip((voxels[index].astype(np.float32)-lower)/(upper-lower), 0, 1)
                frame = torch.from_numpy(values[None, None])
                frame = torch.nn.functional.interpolate(frame, size=(512,512), mode='bilinear', align_corners=False)[0].repeat(3,1,1)
                return (frame-torch.tensor([.485,.456,.406])[:,None,None])/torch.tensor([.229,.224,.225])[:,None,None]
        output = np.zeros(voxels.shape, dtype=np.uint8)
        with torch.inference_mode(), torch.autocast(device_type=self.device, dtype=torch.bfloat16, enabled=self.device=='cuda'):
            state = predictor.init_state(Frames(), height, width, offload_video_to_cpu=True, offload_state_to_cpu=True)
            try:
                for reverse in (False, True):
                    predictor.reset_state(state)
                    for index, mask in sorted(prompts.items()):
                        predictor.add_new_mask(inference_state=state, frame_idx=index, obj_id=1, mask=mask.astype(bool))
                    for index, xy in sorted(points.items()):
                        predictor.add_new_points_or_box(inference_state=state,frame_idx=index,obj_id=1,points=np.array([xy],dtype=np.float32),labels=np.array([1],dtype=np.int32))
                    keys = set(prompts) | set(points)
                    start = max(keys) if reverse else min(keys)
                    for index, ids, logits in predictor.propagate_in_video(state, start_frame_idx=start, reverse=reverse):
                        if cancel.is_set():
                            raise InterruptedError('Cancelled')
                        obj = list(ids).index(1)
                        predicted = (logits[obj] > 0).detach().cpu().numpy().reshape(height, width)
                        output[index] = predicted
                        progress((depth-index if reverse else index+1)/(2*depth) + (.5 if reverse else 0))
                for index, mask in prompts.items():
                    output[index] = mask.astype(bool)
            finally:
                predictor.reset_state(state)
        return {'mask': output, 'status': 'needs-review', 'provider': 'medsam2', 'accepted': False}
