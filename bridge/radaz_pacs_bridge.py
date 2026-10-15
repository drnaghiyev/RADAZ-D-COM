"""Local DIMSE C-FIND/C-GET/C-MOVE bridge for RADAZ. Run beside the browser."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zipfile import ZipFile, ZIP_STORED

if sys.version_info < (3, 10):
    raise SystemExit("RADAZ PACS bridge requires Python 3.10 or newer")

# pydicom reads bundled data files through ordinary filesystem paths, so unpack
# the pinned pure Python wheels locally once. No pip or network is involved.
root = Path(__file__).resolve().parent
vendor = root / ".radaz-deps-3.0.4"
marker = vendor / ".complete"
wheel_names = ("pydicom-3.0.2-py3-none-any.whl", "pynetdicom-3.0.4-py3-none-any.whl")
if not marker.is_file():
    try:
        vendor.mkdir(exist_ok=True)
        for filename in wheel_names:
            wheel = root / "wheels" / filename
            if not wheel.is_file():
                raise SystemExit(f"DICOM package missing: {filename}. Extract all ZIP files")
            with ZipFile(wheel) as package:
                package.extractall(vendor)
        marker.write_text("pydicom 3.0.2 · pynetdicom 3.0.4", encoding="utf-8")
    except OSError as exc:
        raise SystemExit("Extract all ZIP files to a writable folder") from exc
sys.path.insert(0, str(vendor))

from pydicom.dataset import Dataset
from pydicom.uid import AllTransferSyntaxes
from pynetdicom import AE, StoragePresentationContexts, build_role, evt
from pynetdicom.sop_class import (
    PatientRootQueryRetrieveInformationModelFind,
    PatientRootQueryRetrieveInformationModelGet,
    PatientRootQueryRetrieveInformationModelMove,
    StudyRootQueryRetrieveInformationModelFind,
    StudyRootQueryRetrieveInformationModelGet,
    StudyRootQueryRetrieveInformationModelMove,
    Verification,
)

DEFAULT_ORIGIN = "https://rovshan-dicom-viewer.drnaghiyev.chatgpt.site"
MAX_RESULTS = 200
MAX_IMAGES = 800
MAX_BYTES = 512 * 1024 * 1024
RETRIEVE_LOCK = Lock()


class BridgeError(Exception):
    pass


def value(dataset: Dataset, name: str) -> str:
    raw = getattr(dataset, name, "")
    return str(raw).replace("^", " ") if raw is not None else ""


def count(dataset: Dataset, name: str) -> int:
    try:
        return int(getattr(dataset, name, 0) or 0)
    except (TypeError, ValueError):
        return 0


def connection(payload: dict) -> tuple[AE, str, int, str]:
    host = str(payload.get("host") or "").strip()
    if not host or len(host) > 253 or re.search(r"[^A-Za-z0-9.\-:\[\]]", host):
        raise BridgeError("PACS IP / host düzgün deyil")
    try:
        port = int(payload.get("port"))
    except (TypeError, ValueError):
        raise BridgeError("PACS portu düzgün deyil") from None
    if not 1 <= port <= 65535:
        raise BridgeError("PACS portu 1–65535 arası olmalıdır")
    called = str(payload.get("aeTitle") or "").strip()
    calling = str(payload.get("callingAe") or "RADAZ").strip()
    for title in (called, calling):
        if not 1 <= len(title) <= 16 or not title.isascii() or re.search(r"[\\\x00-\x1f\x7f]", title):
            raise BridgeError("AE Title 1–16 ASCII simvol olmalıdır")
    ae = AE(ae_title=calling)
    ae.connection_timeout = 6
    ae.acse_timeout = 6
    ae.dimse_timeout = 15
    ae.network_timeout = 15
    return ae, host, port, called


def find(payload: dict, level: str) -> dict:
    ae, host, port, called = connection(payload)
    study_model = StudyRootQueryRetrieveInformationModelFind
    patient_model = PatientRootQueryRetrieveInformationModelFind
    ae.add_requested_context(study_model)
    ae.add_requested_context(patient_model)
    identifier = Dataset()
    identifier.QueryRetrieveLevel = level
    if level == "STUDY":
        patient = str(payload.get("patient") or "").strip()[:64]
        date = str(payload.get("date") or "").strip()
        if date and not re.fullmatch(r"\d{8}", date):
            raise BridgeError("Müayinə tarixi YYYYMMDD formatında olmalıdır")
        identifier.PatientName = f"*{patient}*" if patient else ""
        identifier.PatientID = ""
        identifier.StudyDate = date
        identifier.StudyInstanceUID = ""
        identifier.StudyDescription = ""
        identifier.ModalitiesInStudy = ""
        identifier.NumberOfStudyRelatedSeries = ""
        identifier.NumberOfStudyRelatedInstances = ""
    elif level == "SERIES":
        uid = str(payload.get("studyUID") or "")
        if not re.fullmatch(r"[\d.]{1,64}", uid):
            raise BridgeError("Study Instance UID düzgün deyil")
        identifier.StudyInstanceUID = uid
        identifier.SeriesInstanceUID = ""
        identifier.SeriesNumber = ""
        identifier.SeriesDescription = ""
        identifier.Modality = ""
        identifier.NumberOfSeriesRelatedInstances = ""
    else:
        raise BridgeError("Sorğu səviyyəsi dəstəklənmir")

    assoc = ae.associate(host, port, ae_title=called)
    if not assoc.is_established:
        raise BridgeError("PACS bağlantısı qurulmadı. IP, port, AE Title, RADAZ çağıran AE icazəsi və firewall-u yoxlayın")
    truncated = False
    try:
        accepted = {str(context.abstract_syntax) for context in assoc.accepted_contexts}
        model = next((model for model in (study_model, patient_model) if str(model) in accepted), None)
        if model is None:
            raise BridgeError("PACS Study/Patient Root C-FIND xidmətini qəbul etmədi")
        results = []
        for status, dataset in assoc.send_c_find(identifier, model):
            if not status:
                raise BridgeError("PACS C-FIND cavabı alınmadı (vaxt bitdi və ya bağlantı kəsildi)")
            code = int(status.Status)
            if code in (0xFF00, 0xFF01):
                if dataset is None:
                    continue
                if level == "STUDY":
                    item = {
                        "uid": value(dataset, "StudyInstanceUID"),
                        "patient": value(dataset, "PatientName") or "Naməlum pasiyent",
                        "patientId": value(dataset, "PatientID"),
                        "date": value(dataset, "StudyDate"),
                        "modality": value(dataset, "ModalitiesInStudy"),
                        "description": value(dataset, "StudyDescription"),
                        "seriesCount": count(dataset, "NumberOfStudyRelatedSeries"),
                        "instanceCount": count(dataset, "NumberOfStudyRelatedInstances"),
                    }
                else:
                    item = {
                        "uid": value(dataset, "SeriesInstanceUID"),
                        "number": value(dataset, "SeriesNumber") or "—",
                        "modality": value(dataset, "Modality"),
                        "description": value(dataset, "SeriesDescription") or "Adsız seriya",
                        "instanceCount": count(dataset, "NumberOfSeriesRelatedInstances"),
                    }
                if item["uid"]:
                    results.append(item)
                if len(results) >= MAX_RESULTS:
                    truncated = True
                    break
            elif code == 0x0000:
                break
            else:
                raise BridgeError(f"PACS C-FIND xətası: 0x{code:04X}")
        return {"items": results, "truncated": truncated}
    finally:
        if truncated:
            assoc.abort()
        elif assoc.is_established:
            assoc.release()


def echo(payload: dict) -> dict:
    ae, host, port, called = connection(payload)
    ae.add_requested_context(Verification)
    assoc = ae.associate(host, port, ae_title=called)
    if not assoc.is_established:
        raise BridgeError("PACS bağlantısı qurulmadı. IP, port və AE Title-ı yoxlayın")
    try:
        if str(Verification) not in {str(context.abstract_syntax) for context in assoc.accepted_contexts}:
            raise BridgeError("PACS C-ECHO yoxlamasını qəbul etmədi; C-FIND ilə axtarışı sınayın")
        status = assoc.send_c_echo()
        if not status or status.Status != 0x0000:
            raise BridgeError(f"PACS C-ECHO uğursuz oldu: {getattr(status, 'Status', 'cavab yoxdur')}")
        return {"ok": True}
    finally:
        if assoc.is_established:
            assoc.release()


class ImageCollector:
    def __init__(self, folder: Path, study_uid: str, series_uid: str):
        self.folder = folder
        self.study_uid = study_uid
        self.series_uid = series_uid
        self.files: dict[str, Path] = {}
        self.bytes = 0
        self.failure = ""
        self.lock = Lock()

    def store(self, event) -> int:
        try:
            dataset = event.dataset
            sop_uid = str(dataset.SOPInstanceUID)
            if (str(dataset.StudyInstanceUID) != self.study_uid or
                str(dataset.SeriesInstanceUID) != self.series_uid or
                not re.fullmatch(r"[\d.]{1,64}", sop_uid)):
                return 0xA900
            with self.lock:
                if sop_uid in self.files:
                    return 0x0000
                if len(self.files) >= MAX_IMAGES or self.bytes >= MAX_BYTES:
                    self.failure = "Seçilmiş seriya 800 görüntü və ya 512 MB həddini aşır"
                    return 0xA700
                dataset.file_meta = event.file_meta
                path = self.folder / f"{sop_uid}.dcm"
                dataset.save_as(path, enforce_file_format=True)
                size = path.stat().st_size
                if self.bytes + size > MAX_BYTES:
                    path.unlink(missing_ok=True)
                    self.failure = "Seçilmiş seriya 512 MB həddini aşır"
                    return 0xA700
                self.files[sop_uid] = path
                self.bytes += size
            return 0x0000
        except Exception:
            self.failure = "PACS-dən gələn DICOM faylı yadda saxlanmadı"
            return 0xA700


def negotiated(association, choices) -> object | None:
    accepted = {str(context.abstract_syntax) for context in association.accepted_contexts}
    return next((model for model in choices if str(model) in accepted), None)


def get_images(payload: dict, identifier: Dataset, collector: ImageCollector) -> bool:
    ae, host, port, called = connection(payload)
    ae.dimse_timeout = ae.network_timeout = getattr(collector, 'timeout', 15)
    models = (StudyRootQueryRetrieveInformationModelGet, PatientRootQueryRetrieveInformationModelGet)
    for model in models:
        ae.add_requested_context(model)
    storage = [context.abstract_syntax for context in StoragePresentationContexts]
    for syntax in storage:
        ae.add_requested_context(syntax, AllTransferSyntaxes)
    roles = [build_role(syntax, scp_role=True) for syntax in storage]
    association = ae.associate(host, port, ae_title=called, ext_neg=roles,
                               evt_handlers=[(evt.EVT_C_STORE, collector.store)])
    if not association.is_established:
        return False
    try:
        model = negotiated(association, models)
        accepted = {str(context.abstract_syntax) for context in association.accepted_contexts}
        if model is None or not accepted.intersection(str(syntax) for syntax in storage):
            return False
        for status, _ in association.send_c_get(identifier, model):
            if not status:
                raise BridgeError("PACS C-GET cavabını tamamlamadı")
            code = int(status.Status)
            if code in (0xFF00, 0xFF01):
                continue
            if code == 0x0000:
                return bool(collector.files)
            if collector.failure:
                raise BridgeError(collector.failure)
            if collector.files:
                raise BridgeError(f"PACS C-GET yarımçıq qaldı: 0x{code:04X}")
            return False
        if collector.files:
            raise BridgeError("PACS C-GET köçürməsini tamamlamadı")
        return False
    finally:
        if association.is_established:
            association.release()


def move_images(payload: dict, identifier: Dataset, collector: ImageCollector) -> None:
    ae, host, port, called = connection(payload)
    ae.dimse_timeout = ae.network_timeout = getattr(collector, 'timeout', 15)
    calling = ae.ae_title
    try:
        listener_port = int(payload.get("listenerPort"))
    except (TypeError, ValueError):
        raise BridgeError("Listener port düzgün deyil") from None
    if not 1 <= listener_port <= 65535 or listener_port == Handler.bridge_port:
        raise BridgeError("Listener port 1–65535 arası olmalı və körpü portundan fərqli olmalıdır")
    receiver = AE(ae_title=calling)
    for context in StoragePresentationContexts:
        receiver.add_supported_context(context.abstract_syntax, AllTransferSyntaxes)
    try:
        server = receiver.start_server(("0.0.0.0", listener_port), block=False,
                                       evt_handlers=[(evt.EVT_C_STORE, collector.store)])
    except OSError as exc:
        raise BridgeError(f"Listener port {listener_port} açıla bilmədi. Başqa port seçin və firewall icazəsini yoxlayın") from exc
    try:
        models = (StudyRootQueryRetrieveInformationModelMove, PatientRootQueryRetrieveInformationModelMove)
        for model in models:
            ae.add_requested_context(model)
        association = ae.associate(host, port, ae_title=called)
        if not association.is_established:
            raise BridgeError("PACS C-MOVE bağlantısı qurulmadı. AE Title və icazələri yoxlayın")
        try:
            model = negotiated(association, models)
            if model is None:
                raise BridgeError("PACS nə C-GET, nə də C-MOVE xidmətini qəbul etdi")
            for status, _ in association.send_c_move(identifier, calling, model):
                if not status:
                    raise BridgeError("PACS C-MOVE cavabını tamamlamadı")
                code = int(status.Status)
                if code in (0xFF00, 0xFF01):
                    continue
                if code == 0x0000:
                    if not collector.files:
                        raise BridgeError("PACS C-MOVE tamamlandı, amma görüntü gəlmədi")
                    return
                if collector.failure:
                    raise BridgeError(collector.failure)
                if code == 0xA801:
                    raise BridgeError(f"PACS çağıran {calling} AE-ni tanımır. Kompüterin LAN IP-sini və listener port {listener_port}-u PACS-də qeyd edin")
                raise BridgeError(f"PACS C-MOVE xətası: 0x{code:04X}. AE, listener port və firewall-u yoxlayın")
            raise BridgeError("PACS C-MOVE köçürməsini tamamlamadı")
        finally:
            if association.is_established:
                association.release()
    finally:
        server.shutdown()


def retrieve(payload: dict, folder: Path) -> list[Path]:
    # Validate before opening a temporary inbound listener or connecting to PACS.
    connection(payload)
    study_uid = str(payload.get("studyUID") or "")
    series = payload.get("seriesUIDs")
    if not re.fullmatch(r"[\d.]{1,64}", study_uid) or not isinstance(series, list) or not 1 <= len(series) <= 30:
        raise BridgeError("Müayinə və seçilmiş seriyalar düzgün deyil")
    if any(not isinstance(uid, str) or not re.fullmatch(r"[\d.]{1,64}", uid) for uid in series):
        raise BridgeError("Seriya UID düzgün deyil")
    files: list[Path] = []
    for series_uid in dict.fromkeys(series):
        identifier = Dataset()
        identifier.QueryRetrieveLevel = "SERIES"
        identifier.StudyInstanceUID = study_uid
        identifier.SeriesInstanceUID = series_uid
        collector = ImageCollector(folder, study_uid, series_uid)
        if not get_images(payload, identifier, collector):
            move_images(payload, identifier, collector)
        if not collector.files:
            raise BridgeError("PACS seçilmiş seriya üçün görüntü qaytarmadı")
        files.extend(collector.files.values())
        if len(files) > MAX_IMAGES or sum(path.stat().st_size for path in files) > MAX_BYTES:
            raise BridgeError("Seçilmiş seriyalar 800 görüntü və ya 512 MB həddini aşır")
    return files


class Handler(BaseHTTPRequestHandler):
    allowed_origin = DEFAULT_ORIGIN
    bridge_port = 8765

    def log_message(self, format: str, *args: object) -> None:
        # Never log patient filters or response data.
        pass

    def authorized(self) -> bool:
        if self.headers.get("Host") not in (f"127.0.0.1:{self.bridge_port}", f"localhost:{self.bridge_port}"):
            self.reply(403, {"error": "Yalnız lokal bağlantıya icazə verilir"}, cors=False)
            return False
        if self.headers.get("Origin") != self.allowed_origin:
            self.reply(403, {"error": "Bu sayt üçün körpü icazəsi yoxdur"}, cors=False)
            return False
        return True

    def common_headers(self, content_type: str, length: int, cors: bool = True) -> None:
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cors:
            self.send_header("Access-Control-Allow-Origin", self.allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "content-type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")

    def reply(self, code: int, data: dict, cors: bool = True) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.common_headers("application/json; charset=utf-8", len(body), cors)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        if self.authorized():
            self.reply(200, {"ok": True})

    def do_GET(self) -> None:
        if not self.authorized():
            return
        self.reply(200, {"ok": True, "bridge": "RADAZ", "version": 3}) if self.path == "/health" else self.reply(404, {"error": "Tapılmadı"})

    def do_POST(self) -> None:
        if not self.authorized():
            return
        if self.path not in ("/studies", "/series", "/echo", "/retrieve"):
            self.reply(404, {"error": "Tapılmadı"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 8192 or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise BridgeError("Sorğu formatı düzgün deyil")
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise BridgeError("Sorğu formatı düzgün deyil")
            if self.path == "/retrieve":
                if not RETRIEVE_LOCK.acquire(blocking=False):
                    raise BridgeError("Başqa PACS köçürməsi davam edir")
                try:
                    with TemporaryDirectory(prefix="radaz-pacs-") as directory:
                        folder = Path(directory)
                        files = retrieve(payload, folder)
                        archive_path = folder / "radaz-images.zip"
                        with ZipFile(archive_path, "w", compression=ZIP_STORED, allowZip64=True) as archive:
                            for file in files:
                                archive.write(file, file.name)
                        self.send_response(200)
                        self.common_headers("application/zip", archive_path.stat().st_size)
                        self.end_headers()
                        with archive_path.open("rb") as archive:
                            while chunk := archive.read(1024 * 1024):
                                self.wfile.write(chunk)
                finally:
                    RETRIEVE_LOCK.release()
                return
            if self.path == "/echo":
                result = echo(payload)
            else:
                result = find(payload, "STUDY" if self.path == "/studies" else "SERIES")
            self.reply(200, result)
        except (BridgeError, ValueError) as exc:
            self.reply(400, {"error": str(exc)})
        except (OSError, RuntimeError) as exc:
            self.reply(502, {"error": f"PACS əlaqə xətası: {exc.__class__.__name__}"})


def main() -> None:
    parser = argparse.ArgumentParser(description="RADAZ local DICOM PACS bridge")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--origin", default=DEFAULT_ORIGIN)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port 1–65535 arası olmalıdır")
    Handler.allowed_origin = args.origin
    Handler.bridge_port = args.port
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        print(f"RADAZ PACS bridge ready at http://127.0.0.1:{args.port}. Press Ctrl+C to stop.", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
