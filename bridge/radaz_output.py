"""Local printer and removable-media output. No automatic printing or burning."""
from __future__ import annotations
import base64
import copy
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from threading import Lock, RLock, Thread
from uuid import uuid4
from zipfile import ZipFile, BadZipFile
from contextlib import nullcontext

import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.fileset import FileSet, RecordNode, DIRECTORY_RECORDERS
from pydicom.uid import generate_uid, ImplicitVRLittleEndian, ExplicitVRLittleEndian, ExplicitVRBigEndian
from pynetdicom import AE, evt
from pynetdicom.sop_class import BasicGrayscalePrintManagementMeta as META, BasicFilmSession, BasicFilmBox, BasicGrayscaleImageBox, Printer, PrinterInstance

LAYOUTS = {'1,1','1,2','2,2','2,3','2,4','3,3','3,4','4,4','5,5','6,6'}
SIZES = {'8INX10IN','10INX12IN','11INX14IN','14INX17IN','A4','A3'}
PRINT_LOCK = Lock()
BURN_LOCK = Lock()
CREATE_NO_WINDOW = 0x08000000 if os.name == 'nt' else 0

def replace_status(source,target):
    for attempt in range(20):
        try:os.replace(source,target);return
        except PermissionError:
            if attempt==19:raise
            time.sleep(.025)


def printer_config(payload, require_host=True):
    result = {key: str(payload.get(key, default)).strip() for key, default in {
        'host':'', 'port':'104', 'aeTitle':'PRINTER', 'callingAe':'RADAZ', 'mediumType':'BLUE FILM',
        'filmSize':'14INX17IN', 'orientation':'PORTRAIT', 'layout':'2,2', 'paperSize':'A4'}.items()}
    if (require_host and not result['host']) or (result['host'] and not re.fullmatch(r'[A-Za-z0-9.\-:\[\]]{1,253}', result['host'])):
        raise ValueError('Printer IP / host düzgün deyil')
    if not 1 <= int(result['port']) <= 65535:
        raise ValueError('Port 1–65535 arası olmalıdır')
    for key in ('aeTitle','callingAe'):
        value = result[key]
        if not 1 <= len(value) <= 16 or not value.isascii() or re.search(r'[\\\x00-\x1f\x7f]',value):
            raise ValueError('AE Title 1–16 ASCII simvol olmalıdır')
    result['copies'] = int(payload.get('copies',1))
    if not 1 <= result['copies'] <= 99 or result['layout'] not in LAYOUTS or result['filmSize'] not in SIZES:
        raise ValueError('Nüsxə sayı, bölgü və ya plyonka ölçüsü düzgün deyil')
    if result['orientation'] not in {'PORTRAIT','LANDSCAPE'} or result['mediumType'] not in {'BLUE FILM','CLEAR FILM','PAPER'} or result['paperSize'] not in {'A4','A3','Letter'}:
        raise ValueError('Printer ayarları düzgün deyil')
    return result


def connect_printer(config):
    ae = AE(ae_title=config['callingAe'])
    ae.acse_timeout = 10; ae.dimse_timeout = 20; ae.network_timeout = 25
    ae.add_requested_context(META)
    assoc = ae.associate(config['host'], int(config['port']), ae_title=config['aeTitle'], evt_handlers=[(evt.EVT_N_EVENT_REPORT, lambda _: 0)])
    if not assoc.is_established:
        raise ValueError('Printer bağlantını qəbul etmədi. IP, port və AE Title ayarlarını yoxlayın.')
    return assoc


def check_status(status, operation, action=False):
    if status is None or not hasattr(status,'Status'):
        raise ValueError(f'{operation}: cavab alınmadı.' + (' Çap baş tutmuş ola bilər; təkrar göndərmədən əvvəl printer növbəsini yoxlayın.' if action else ''))
    if status.Status != 0:
        raise ValueError(f'{operation}: DICOM status 0x{status.Status:04X}.' + (' Təkrar göndərmədən əvvəl printer növbəsini yoxlayın.' if action else ''))


def printer_status(assoc):
    status, data = assoc.send_n_get([0x21100010,0x21100020], Printer, PrinterInstance, meta_uid=META)
    check_status(status,'Printer statusu')
    if data is None or getattr(data,'PrinterStatus','') != 'NORMAL':
        raise ValueError('Printer hazır deyil: ' + str(getattr(data,'PrinterStatusInfo','Status məlum deyil')))


def test_printer(payload):
    config = printer_config(payload)
    assoc = connect_printer(config)
    try:
        printer_status(assoc)
        return {'message':'DICOM Print bağlantısı quruldu · printer NORMAL statusundadır. Çap göndərilmədi.'}
    finally:
        if assoc.is_established: assoc.release()


def print_film(payload):
    config = printer_config(payload)
    images = payload.get('images',[])
    cols, rows = map(int,config['layout'].split(','))
    if not isinstance(images,list) or not 1 <= len(images) <= cols * rows:
        raise ValueError('Görüntü sayı seçilmiş plyonka bölgüsünə uyğun deyil')
    decoded = []
    for image in images:
        height, width = int(image['rows']), int(image['columns'])
        data = base64.b64decode(image['pixels'],validate=True)
        if not 1 <= height <= 4096 or not 1 <= width <= 4096 or len(data) != width * height:
            raise ValueError('Çap piksel ölçüləri düzgün deyil')
        decoded.append((height,width,data))
    if not PRINT_LOCK.acquire(blocking=False):
        raise ValueError('Başqa DICOM çap işi göndərilir; tamamlanmasını gözləyin')
    assoc = None; session_uid = generate_uid(); box_uid = generate_uid(); created = False
    try:
        assoc = connect_printer(config); printer_status(assoc)
        session = Dataset(); session.NumberOfCopies = str(config['copies']); session.PrintPriority = 'MED'
        session.MediumType = config['mediumType']; session.FilmDestination = 'PROCESSOR'; session.OwnerID = 'RADAZ'
        status, _ = assoc.send_n_create(session, BasicFilmSession, session_uid, meta_uid=META)
        check_status(status,'Film Session'); created = True
        box = Dataset(); box.ImageDisplayFormat = 'STANDARD\\' + config['layout']; box.FilmOrientation = config['orientation']; box.FilmSizeID = config['filmSize']
        box.MagnificationType = 'REPLICATE'; box.BorderDensity = 'BLACK'; box.EmptyImageDensity = 'BLACK'; box.Trim = 'NO'
        reference = Dataset(); reference.ReferencedSOPClassUID = BasicFilmSession; reference.ReferencedSOPInstanceUID = session_uid
        box.ReferencedFilmSessionSequence = [reference]
        status, result = assoc.send_n_create(box, BasicFilmBox, box_uid, meta_uid=META)
        check_status(status,'Film Box')
        targets = list(getattr(result,'ReferencedImageBoxSequence',[]))
        if len(targets) < len(decoded): raise ValueError('Printer kifayət qədər Image Box qaytarmadı')
        for index, ((height,width,data), target) in enumerate(zip(decoded,targets),1):
            if str(target.ReferencedSOPClassUID) != str(BasicGrayscaleImageBox): raise ValueError('Printer grayscale Image Box qaytarmadı')
            attrs = Dataset(); attrs.ImageBoxPosition = index; attrs.Polarity = 'NORMAL'
            pixels = Dataset(); pixels.SamplesPerPixel = 1; pixels.PhotometricInterpretation = 'MONOCHROME2'; pixels.Rows = height; pixels.Columns = width
            pixels.BitsAllocated = 8; pixels.BitsStored = 8; pixels.HighBit = 7; pixels.PixelRepresentation = 0; pixels.PixelData = data
            attrs.BasicGrayscaleImageSequence = [pixels]
            status, _ = assoc.send_n_set(attrs, BasicGrayscaleImageBox, target.ReferencedSOPInstanceUID, meta_uid=META)
            check_status(status,f'{index}-ci görüntü')
        status, _ = assoc.send_n_action(None, 1, BasicFilmBox, box_uid, meta_uid=META)
        check_status(status,'Çap əmri',action=True)
        return {'message':f'{len(images)} görüntü · {config["copies"]} nüsxə · DICOM printer çap əmrini qəbul etdi'}
    finally:
        if assoc and assoc.is_established:
            if created:
                try: assoc.send_n_delete(BasicFilmSession,session_uid,meta_uid=META)
                except Exception: pass
            assoc.release()
        PRINT_LOCK.release()


def powershell(*args, timeout=60):
    if os.name != 'nt': raise ValueError('Birbaşa CD/DVD yazılması Windows tələb edir')
    command = ['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(Path(__file__).with_name('radaz_disc.ps1')), *map(str,args)]
    result = subprocess.run(command, capture_output=True, timeout=timeout, creationflags=CREATE_NO_WINDOW)
    text = result.stdout.decode('utf-8-sig',errors='replace').strip()
    if result.returncode: raise ValueError(text or 'Windows CD/DVD xidməti əməliyyatı yerinə yetirmədi')
    return json.loads(text)


def safe_zip(data):
    try: archive = ZipFile(io.BytesIO(data))
    except BadZipFile: raise ValueError('ZIP paketi düzgün deyil') from None
    if len(archive.infolist()) > 10000 or sum(entry.file_size for entry in archive.infolist()) > 512 * 1024 * 1024:
        archive.close(); raise ValueError('Paket 512 MB və ya 10000 fayl həddini keçir')
    for entry in archive.infolist():
        if entry.filename.startswith(('/', '\\')) or '\\' in entry.filename or ':' in entry.filename or '..' in Path(entry.filename).parts:
            archive.close(); raise ValueError('Paketdə etibarsız fayl yolu var')
    return archive


class MediaFolder:
    def __init__(self,root):self.root=Path(root);self.files=[item for item in self.root.rglob('*') if item.is_file()]
    def namelist(self):return [file.relative_to(self.root).as_posix() for file in self.files]
    def infolist(self):
        from types import SimpleNamespace
        return [SimpleNamespace(filename=file.relative_to(self.root).as_posix(),file_size=file.stat().st_size,is_dir=lambda:False) for file in self.files]
    def read(self,entry):
        name=entry if isinstance(entry,str) else entry.filename
        target=(self.root/name).resolve()
        if self.root.resolve() not in target.parents:raise ValueError('CD fayl yolu düzgün deyil')
        return target.read_bytes()

class OutputService:
    def __init__(self, root):
        # FileSet resolves paths, including Windows 8.3 aliases such as RUNNER~1.
        # Keep our paths canonical too so DICOMDIR manifest entries stay relative.
        self.root = Path(root).resolve()
        self.media_root = self.root / 'MediaJobs'
        self.jobs_lock = RLock()

    def settings(self):
        path = self.root / 'printers.json'
        return printer_config(json.loads(path.read_text(encoding='utf-8')) if path.exists() else {},False)

    def save_settings(self,payload):
        config = printer_config(payload,False)
        with self.jobs_lock:
            temporary = self.root / 'printers.json.tmp'
            temporary.write_text(json.dumps(config),encoding='utf-8'); os.replace(temporary,self.root / 'printers.json')
        return config

    def devices(self):
        result = powershell('-Mode','List') if os.name == 'nt' else {'drives':[], 'printers':[]}
        result['videoEncoder'] = bool(shutil.which('ffmpeg'))
        return result

    def job_path(self,job):
        if not re.fullmatch(r'[a-f0-9]{32}',str(job)): raise ValueError('Media işi düzgün deyil')
        path = self.media_root / job
        if not path.is_dir(): raise ValueError('Media işi tapılmadı')
        return path

    def status(self,job):
        path=self.job_path(job)
        with self.jobs_lock:result=json.loads((path / 'status.json').read_text(encoding='utf-8'))
        if result.get('state') in {'preparing','writing'} and (path/'progress.json').exists():
            try: result['progress']=json.loads((path/'progress.json').read_text(encoding='utf-8'))
            except (ValueError,OSError): pass
        return result

    def update(self,path,**patch):
        with self.jobs_lock:
            file = path / 'status.json'
            current = json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}
            current.update(patch)
            temporary = path / 'status.tmp'; temporary.write_text(json.dumps(current,ensure_ascii=False),encoding='utf-8'); replace_status(temporary,file)
            return current

    def prepare_async(self,data):
        job=uuid4().hex;path=self.media_root/job;path.mkdir(parents=True)
        initial=self.update(path,id=job,state='preparing',count=0,size=0,message='DICOMDIR hazırlanır…',progress={'label':'DICOMDIR hazırlanır','done':0,'total':0})
        def run():
            try: self.prepare(data,job)
            except Exception as error: self.update(path,state='error',message=str(error))
        Thread(target=run,daemon=True).start()
        return initial

    def begin_media(self):
        job=uuid4().hex;path=self.media_root/job;path.mkdir(parents=True);(path/'staging').mkdir()
        return self.update(path,id=job,state='receiving',count=0,size=0,received=0,bytes=0,message='CD faylları hazırlanır…')

    def receive_media(self,job,name,data):
        if not re.fullmatch(r'(DICOM/IMG[0-9]{6}\.dcm|MEASUREMENTS/IMG[0-9]{6}\.dcm|DATA/IMG[M]?[0-9]{6}_F[0-9]{6}\.js|LITE/viewer\.(js|css)|START\.html|README\.txt|MANIFEST\.json|AUTORUN\.INF)',name):raise ValueError('CD fayl yolu düzgün deyil')
        path=self.job_path(job);root=(path/'staging').resolve();target=(root/name).resolve()
        if root not in target.parents:raise ValueError('CD fayl yolu düzgün deyil')
        # Reserve capacity while holding the same lock as status writes.
        with self.jobs_lock:
            state=json.loads((path/'status.json').read_text(encoding='utf-8'))
            if state['state']!='receiving' or state['received']>=10000 or state['bytes']+len(data)>512*1024*1024:raise ValueError('CD işi bağlıdır və ya paket ölçü həddini keçir')
            target.parent.mkdir(exist_ok=True)
            with target.open('xb') as stream:stream.write(data)
            state.update(received=state['received']+1,bytes=state['bytes']+len(data))
            temporary=path/'status.tmp';temporary.write_text(json.dumps(state),encoding='utf-8');replace_status(temporary,path/'status.json')
        return {'ok':True}

    def finalize_media(self,job):
        path=self.job_path(job)
        with self.jobs_lock:
            if self.status(job)['state']!='receiving':raise ValueError('CD faylları artıq hazırlanır')
            initial=self.update(path,state='preparing',message='DICOMDIR hazırlanır…',progress={'label':'DICOMDIR hazırlanır','done':0,'total':0})
        def run():
            try:self.prepare(None,job,path/'staging')
            except Exception as error:self.update(path,state='error',message=str(error))
        Thread(target=run,daemon=True).start();return initial

    def prepare(self,data,job=None,source_path=None):
        asynchronous=job is not None
        job = job or uuid4().hex; path = self.media_root / job; path.mkdir(parents=True,exist_ok=asynchronous)
        try:
            media = path / 'disc'; media.mkdir()
            fileset = FileSet(); fileset.ID = 'RADAZ'
            count = 0; measured = 0; seen = set()
            with (nullcontext(MediaFolder(source_path)) if source_path else safe_zip(data)) as source:
                total=sum(1 for entry in source.infolist() if entry.filename.upper().endswith('.DCM') and not entry.is_dir())
                for entry in source.infolist():
                    if entry.filename.upper().endswith('.DCM') and not entry.is_dir():
                        ds = pydicom.dcmread(io.BytesIO(source.read(entry)),force=True)
                        if not getattr(ds,'SOPInstanceUID',None) or not getattr(ds,'PixelData',None): raise ValueError(f'DICOM görüntüsü deyil: {entry.filename}')
                        if str(ds.SOPInstanceUID) in seen: continue
                        seen.add(str(ds.SOPInstanceUID))
                        if not getattr(ds,'file_meta',None): ds.file_meta = FileMetaDataset()
                        if not getattr(ds.file_meta,'TransferSyntaxUID',None):
                            ds.file_meta.TransferSyntaxUID = (ImplicitVRLittleEndian if ds.original_encoding[0] else ExplicitVRLittleEndian) if ds.original_encoding[1] is not False else ExplicitVRBigEndian
                        ds.file_meta.MediaStorageSOPClassUID = ds.SOPClassUID; ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
                        if not hasattr(ds,'SeriesNumber') or not hasattr(ds,'InstanceNumber'):
                            raise ValueError('DICOMDIR üçün Series Number və Instance Number tələb olunur')
                        # StudyID is optional in many image IODs but required in
                        # a directory record. Supply catalog IDs in DICOMDIR only;
                        # never rewrite the source's patient or study identifiers.
                        # Directory records do not use PixelData. Avoid copying hundreds
                        # of MB of pixel buffers only to read the small header fields.
                        directory_source = copy.deepcopy(Dataset({tag:element for tag,element in ds.items() if tag != 0x7fe00010}))
                        suffix = hashlib.sha256(str(ds.StudyInstanceUID).encode()).hexdigest()[:10].upper()
                        if not getattr(directory_source,'StudyID',''): directory_source.StudyID = 'RADAZ' + suffix
                        if not getattr(directory_source,'PatientID',''): directory_source.PatientID = 'MEDIA-' + suffix
                        parent = None
                        for kind in ('PATIENT','STUDY','SERIES','IMAGE'):
                            record = DIRECTORY_RECORDERS[kind](directory_source); record.DirectoryRecordType = kind
                            if getattr(ds,'SpecificCharacterSet',None): record.SpecificCharacterSet = ds.SpecificCharacterSet
                            if kind == 'IMAGE': record.ReferencedSOPInstanceUIDInFile = ds.SOPInstanceUID
                            node = RecordNode(record)
                            if parent is not None: node.parent = parent
                            parent = node
                        fileset.add_custom(ds,parent); count += 1
                        if asynchronous:self.update(path,state='preparing',message=f'DICOMDIR: {count} / {total}',progress={'label':'DICOMDIR qeydləri','done':count,'total':total})
                        if entry.filename.startswith('MEASUREMENTS/'):
                            if str(ds.SOPClassUID) != '1.2.840.10008.5.1.4.1.1.7': raise ValueError('Ölçülü görüntü Secondary Capture DICOM deyil')
                            measured += 1
                if not count: raise ValueError('Paketdə DICOM görüntüsü yoxdur')
                if asynchronous:self.update(path,state='preparing',message='DICOM faylları disk qovluğuna yazılır…',progress={'label':'DICOM faylları disk qovluğuna yazılır','done':0,'total':0})
                fileset.write(media)
                def copy_asset(name):
                    target=media/name;target.parent.mkdir(exist_ok=True)
                    if source_path:
                        # Both paths are immutable files inside this temporary job.
                        # A hard link avoids writing all offline pixels a second time.
                        try:os.link(Path(source_path)/name,target);return
                        except OSError:shutil.copyfile(Path(source_path)/name,target);return
                    target.write_bytes(source.read(name))
                for name in ('START.html','README.txt','MANIFEST.json'):
                    if name in source.namelist():copy_asset(name)
                for entry in source.infolist():
                    legacy=re.fullmatch(r'(PREVIEWS/IMG[0-9]{6}\.jpg|HU/IMG[0-9]{6}\.js)',entry.filename)
                    portable=re.fullmatch(r'(LITE/viewer\.(js|css)|DATA/IMG[M]?[0-9]{6}_F[0-9]{6}\.js)',entry.filename)
                    if (legacy or portable) and entry.file_size <= 64 * 1024 * 1024:
                        copy_asset(entry.filename)
                (media / 'AUTORUN.INF').write_text('[AutoRun]\r\nshellexecute=START.html\r\naction=Open RADAZ DICOM Lite\r\nlabel=RADAZ DICOM Media\r\n', encoding='ascii')
                (media / 'README.txt').write_text('RADAZ DICOM media\nDICOMDIR faylını DICOM viewer-də açın. START.html offline önbaxışı açır.\nDICOM görüntüləri PT qovluqlarındadır. Piksel məlumatları dəyişdirilməyib.\n'+('Ölçülər ayrıca DICOM Secondary Capture seriyasındadır.\n' if measured else '')+'Mənbədə ID boş olduqda yalnız kataloq qeydlərində RADAZ/MEDIA prefiksli texniki ID yaradılır; DICOM görüntüsündəki ID dəyişmir.\n',encoding='utf-8')
                (media / 'MANIFEST.json').write_text(json.dumps({'profile':'RADAZ-DICOM-MEDIA','files':[str(Path(item.path).relative_to(media)).replace('\\','/') for item in fileset]},ensure_ascii=False),encoding='utf-8')
            size = sum(file.stat().st_size for file in media.rglob('*') if file.is_file())
            if source_path and Path(source_path).resolve().parent==path.resolve() and Path(source_path).name=='staging':shutil.rmtree(source_path)
            return self.update(path,id=job,state='ready',count=count,size=size,message=f'{count} DICOM · DICOMDIR və offline viewer hazırdır',progress={'label':'CD paketi hazırdır','done':count,'total':count})
        except Exception:
            # Only our freshly-created, resolved job directory is removed.
            if not asynchronous and path.resolve().parent == self.media_root.resolve(): shutil.rmtree(path)
            raise

    def start(self,job,mode,recorder=''):
        path = self.job_path(job)
        if mode not in {'iso','burn'}: raise ValueError('Media əməliyyatı düzgün deyil')
        if not BURN_LOCK.acquire(blocking=False): raise ValueError('Başqa media işi davam edir')
        try:
            if self.status(job)['state'] in {'preparing','writing'}: raise ValueError('Media işi artıq davam edir')
            if mode == 'burn':
                drives = self.devices()['drives']; drive = next((item for item in drives if item['id'] == recorder),None)
                if not drive or not drive['canWrite']: raise ValueError('Seçilmiş qurğu CD/DVD yazmağı dəstəkləmir. CD/DVD writer qoşun.')
                if not drive.get('blank') or not drive.get('mediaSupported'): raise ValueError('Uyğun boş CD/DVD daxil edin. Mövcud disk silinmir.')
                if self.status(job)['size'] + 4*1024*1024 > drive['freeBytes']: raise ValueError('Görüntülər diskə sığmır; daha böyük boş disk seçin')
            (path/'progress.json').unlink(missing_ok=True)
            self.update(path,state='preparing',message='Disk fayl sistemi hazırlanır…',progress={'label':'Disk fayl sistemi hazırlanır','done':0,'total':0})
        except Exception: BURN_LOCK.release(); raise
        def run():
            try:
                if mode == 'burn': self.update(path,state='writing',message='CD/DVD-yə yazılır. Qurğunu ayırmayın…')
                result = powershell('-Mode','Burn' if mode == 'burn' else 'Iso','-Source',path / 'disc','-Destination',path / 'RADAZ.iso','-RecorderId',recorder,'-ProgressPath',path/'progress.json',timeout=1800)
                self.update(path,state='complete',iso=mode == 'iso' or (path / 'RADAZ.iso').exists(),message=result['message'])
            except Exception as error: self.update(path,state='error',message=str(error))
            finally: BURN_LOCK.release()
        Thread(target=run,daemon=True).start()
        return self.status(job)

    def build_zip(self,job):
        path=self.job_path(job);files=[file for file in (path/'disc').rglob('*') if file.is_file()]
        temporary=path/'RADAZ-CD.zip.part'
        with ZipFile(temporary,'w') as archive:
            for index,file in enumerate(files):
                archive.write(file,file.relative_to(path/'disc').as_posix())
                self.update(path,state='packaging',message=f'ZIP: {index+1} / {len(files)}',progress={'label':'ZIP paketi yaradılır','done':index+1,'total':len(files),'unit':'fayl'})
        replace_status(temporary,path/'RADAZ-CD.zip')
        return self.update(path,state='ready',zip=True,message='CD ZIP paketi hazırdır',progress={'label':'ZIP paketi hazırdır','done':len(files),'total':len(files),'unit':'fayl'})

    def package_media(self,job):
        path=self.job_path(job)
        with self.jobs_lock:
            state=self.status(job)
            if state.get('zip') and (path/'RADAZ-CD.zip').is_file():return state
            if state['state'] not in {'ready','complete'}:raise ValueError('CD paketi hələ hazır deyil')
            initial=self.update(path,state='packaging',message='ZIP paketi yaradılır…',progress={'label':'ZIP paketi yaradılır','done':0,'total':0})
        def run():
            try:self.build_zip(job)
            except Exception as error:self.update(path,state='error',message=str(error))
        Thread(target=run,daemon=True).start();return initial

    def zip_file(self,job):
        path=self.job_path(job)
        create=False
        with self.jobs_lock:
            if not (path/'RADAZ-CD.zip').is_file():
                if self.status(job)['state'] not in {'ready','complete'}:raise ValueError('CD paketi hələ hazır deyil')
                self.update(path,state='packaging',message='ZIP paketi yaradılır…');create=True
        if create:self.build_zip(job)
        return path/'RADAZ-CD.zip'

    def zip_package(self,job):return self.zip_file(job).read_bytes()

    def video(self,data):
        ffmpeg = shutil.which('ffmpeg')
        if not ffmpeg: raise ValueError('Video ixracı üçün lokal FFmpeg tapılmadı')
        with tempfile.TemporaryDirectory(prefix='radaz-video-') as folder:
            root = Path(folder)
            with safe_zip(data) as source:
                config = json.loads(source.read('video.json')); fmt = config.get('format'); fps = int(config.get('fps',10))
                if fmt not in {'mp4','wmv'} or not 1 <= fps <= 60: raise ValueError('Video formatı və ya FPS düzgün deyil')
                names = sorted(name for name in source.namelist() if re.fullmatch(r'FRAME[0-9]{6}\.png',name))
                if not 1 <= len(names) <= 2000: raise ValueError('Videoda 1–2000 kadr olmalıdır')
                for index,name in enumerate(names):
                    content = source.read(name)
                    if content[:8] != b'\x89PNG\r\n\x1a\n': raise ValueError('Video kadrı PNG deyil')
                    (root / f'FRAME{index:06}.png').write_bytes(content)
            output = root / f'RADAZ.{fmt}'
            # A common 1920x1080 frame retains each series' aspect ratio using black bars.
            command = [ffmpeg,'-nostdin','-v','error','-framerate',str(fps),'-i',str(root / 'FRAME%06d.png'),'-vf',"scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",'-an']
            command += ['-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart'] if fmt == 'mp4' else ['-c:v','wmv2','-b:v','8000k','-pix_fmt','yuv420p']
            result = subprocess.run([*command,str(output)],capture_output=True,timeout=300,creationflags=CREATE_NO_WINDOW)
            if result.returncode: raise ValueError('FFmpeg video kadrlarını kodlaşdıra bilmədi')
            return output.read_bytes(), 'video/mp4' if fmt == 'mp4' else 'video/x-ms-wmv'
