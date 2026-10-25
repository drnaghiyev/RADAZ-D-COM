"""Coordinate-only multi-plane prompts. No model downloads or network access."""
import numpy as np

def contour_prompts(contours, dimensions):
    groups = {}
    for contour in contours:
        axis, section = contour['axis'], contour['slice']
        if type(axis) is not int or axis not in (0, 1, 2) or type(section) is not int or not 0 <= section < dimensions[axis]:
            raise ValueError('Invalid contour plane')
        points = np.asarray(contour['points'], dtype=np.float64)
        if points.ndim != 2 or points.shape[1] != 2 or len(points) < 3 or not np.isfinite(points).all():
            raise ValueError('Invalid contour vertices')
        u, v = [a for a in range(3) if a != axis]
        if (points < -.5).any() or (points[:, 0] > dimensions[u]-.5).any() or (points[:, 1] > dimensions[v]-.5).any():
            raise ValueError('Contour outside reference volume')
        x, y = np.meshgrid(np.arange(dimensions[u]), np.arange(dimensions[v]))
        mask = np.zeros(x.shape, dtype=bool)
        for a, b in zip(points, np.roll(points, 1, axis=0)):
            if a[1] != b[1]:
                mask ^= ((a[1] > y) != (b[1] > y)) & (x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])
        if not mask.any(): raise ValueError('Empty contour')
        prompts = groups.setdefault(axis, {})
        prompts[section] = prompts.get(section, np.zeros_like(mask)) | mask
    if not groups: raise ValueError('At least one contour required')
    # Crossing manually specified planes must agree; never silently choose one.
    for axis, prompts in groups.items():
        for other, peers in groups.items():
            if other <= axis: continue
            for section, mask in prompts.items():
                for index, peer in peers.items():
                    a, b = [slice(None)]*2, [slice(None)]*2
                    a[[i for i in (2,1,0) if i != axis].index(other)] = index
                    b[[i for i in (2,1,0) if i != other].index(axis)] = section
                    if not np.array_equal(mask[tuple(a)], peer[tuple(b)]):
                        raise ValueError('Kəsişən konturlar uyğun deyil. Localizer ilə sərhədləri yoxlayıb düzəldin.')
    return groups

def infer_multiplanar(adapter, voxels, groups, lower, upper, cancel, progress):
    votes = np.zeros(voxels.shape, dtype=np.uint8)
    for run, (axis, prompts) in enumerate(groups.items()):
        if cancel.is_set(): raise InterruptedError('Cancelled')
        result = adapter.infer(np.moveaxis(voxels, 2-axis, 0), prompts, lower=lower, upper=upper, cancel=cancel,
                               progress=lambda value, run=run: progress((run+value)/len(groups)))
        prediction = np.moveaxis(result['mask'], 0, 2-axis)
        if prediction.shape != voxels.shape: raise ValueError('Model mask geometry mismatch')
        votes += prediction > 0
    # Conservative multi-view consensus; it is a review candidate, never accepted.
    mask = (votes >= len(groups)//2+1).astype(np.uint8)
    for axis, prompts in groups.items():
        view = np.moveaxis(mask, 2-axis, 0)
        for section, prompt in prompts.items(): view[section] = prompt
    return mask
