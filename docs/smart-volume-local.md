# Smart Volume and MedSAM2 — Windows deployment

Smart Volume is included in RADAZ 0.2.49: manual contours, brush/eraser,
multiple segments, explicit non-AI interpolation, voxel-based volumetry,
3D surfaces and anatomical volume preview. Latest shared 3D materials and
viewport geometry fixes are included.

MedSAM2 is an optional local research/education module. Open RADAZ settings,
Smart Volume, accept the model's research/education terms, then install.
The initial online installation downloads a separate CPU Python/PyTorch runtime
and SHA-256 verified model. Subsequent inference is local; no patient data is
sent to GitHub, Hugging Face or another inference service.

The module is stored under the installation's local-modules/smart-volume folder,
outside version folders and rollback cleanup. The installer does not replace
active RADAZ runtimes, clinical archives, license files or reports. The gateway
starts an authenticated loopback service lazily on its own allocated port.
CPU processing can take substantial time on large volumes. Review and accept
or reject every AI result; clinical accuracy is not established.

Code: https://github.com/bowang-lab/MedSAM2
Commit: 332f30d420f1d1b08e2a79b3ae6a602458808383
Code license and provenance: vendor/medsam2/LICENSE, PROVENANCE.txt.
Weights: https://huggingface.co/wanglab/MedSAM2 — research/education only.
Checkpoint SHA-256: c92743b99f00d078bf32a3afcc38aaa9faf1c1692dffe3eaa7a90938c1991060

Not complete: Livewire, DICOM SEG interchange, report-editor transfer,
clinical validation, maximum 3D Feret diameter. Displayed extents are bounding
extents, not Feret diameter. Save segmentation backups explicitly (.sv);
browser storage is not the durable archive and is origin-specific.
