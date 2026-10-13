"""Small synthetic studies for viewport, metadata and export browser regression tests."""
from pathlib import Path
from removable_media_test import write_image

root = Path(__file__).resolve().parents[1] / 'outputs/viewer-qa-fixture'
root.mkdir(parents=True, exist_ok=True)
for series in (1, 2):
    for index in range(1, 7):
        target = root / f'{series}-{index}.dcm'
        ds = write_image(target, index)
        ds.InstitutionName = 'RADAZ SYNTHETIC CLINIC'
        ds.SeriesInstanceUID = f'2.25.800.{series}'
        ds.SOPInstanceUID = f'2.25.800.{series}.{index}'
        ds.SeriesDescription = '' if series == 2 else 'Synthetic CT'
        ds.ProtocolName = 'CT PROTOCOL TEST'
        ds.SeriesNumber = series
        ds.save_as(target, enforce_file_format=True)
