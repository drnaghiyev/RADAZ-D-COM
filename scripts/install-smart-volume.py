"""Explicit, per-user research runtime install. Never touches archive or active runtime."""
import argparse, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path
from urllib.request import urlopen, Request
from zipfile import ZipFile

def download(url, target, digest):
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == digest: return
    part = target.with_suffix(target.suffix + '.part')
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent':'RADAZ-SmartVolume'}), timeout=30) as response, part.open('wb') as stream:
                started=time.monotonic(); received=0; reported=0
                while True:
                    chunk=response.read1(65536)
                    if not chunk: break
                    stream.write(chunk); received+=len(chunk)
                    if received-reported>=16*1024*1024:
                        print(target.name+': '+str(received//(1024*1024))+' MB',flush=True);reported=received
                    if time.monotonic()-started>3600: raise TimeoutError('Download deadline exceeded')
            break
        except (OSError, TimeoutError):
            if attempt==2: raise
            print('Yükləmə təkrar edilir',flush=True);time.sleep(2)
    with part.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != digest: raise ValueError('Download checksum mismatch')
    os.replace(part, target)

def main():
    sys.stdout.reconfigure(encoding="utf-8",errors="replace")
    sys.stderr.reconfigure(encoding="utf-8",errors="replace")
    parser=argparse.ArgumentParser(); parser.add_argument('--module-root', required=True); parser.add_argument('--research-accepted', action='store_true')
    args=parser.parse_args()
    if not args.research_accepted: raise ValueError('Research and education terms must be accepted')
    root=Path(args.module_root).resolve(); root.mkdir(parents=True,exist_ok=True)
    lock=root/'install.lock'
    import msvcrt
    handle=lock.open('a+b');handle.seek(0)
    msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
    try:
        if (root/'ready.json').exists():
            print('MedSAM2 artıq qurulub',flush=True);return
        python=root/'python'
        archive=root/'python.zip'
        print('Python hazırlanır',flush=True)
        download('https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',archive,'009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b')
        python.mkdir(exist_ok=True)
        with ZipFile(archive) as z: z.extractall(python)
        (python/'python311._pth').write_text('python311.zip\n.\nLib/site-packages\nimport site\n')
        pip=root/'pip.whl'
        download('https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl',pip,'9655943313a94722b7774661c21049070f6bbb0a1516bf02f7c8d5d9201514cd')
        with ZipFile(pip) as z: z.extractall(python/'Lib/site-packages')
        exe=str(python/'python.exe')
        def install(*packages):
            subprocess.run([exe,'-m','pip','install','--disable-pip-version-check','--no-cache-dir',*packages],check=True)
        print('CPU inference asılılıqları yüklənir',flush=True)
        install('--index-url','https://download.pytorch.org/whl/cpu','torch==2.5.1','torchvision==0.20.1')
        install('setuptools==80.9.0','wheel==0.45.1')
        install('--no-build-isolation','numpy==2.2.6','pillow==11.3.0','hydra-core==1.3.2','iopath==0.1.10','tqdm==4.67.1','fastapi==0.115.12','uvicorn==0.34.3')
        print('MedSAM2 tədqiqat modeli yüklənir',flush=True)
        download('https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_latest.pt',root/'MedSAM2_latest.pt','c92743b99f00d078bf32a3afcc38aaa9faf1c1692dffe3eaa7a90938c1991060')
        subprocess.run([exe,'-c','import torch, torchvision, numpy, fastapi, uvicorn, hydra; print(torch.__version__)'],check=True)
        temp=root/'ready.tmp';temp.write_text(json.dumps({'schema':1,'researchOnly':True,'installedAt':time.time(),'runtime':'cpu'}));os.replace(temp,root/'ready.json')
        # Only installer-owned verified download caches; never model/user data.
        archive.unlink(missing_ok=True);pip.unlink(missing_ok=True)
        print('MedSAM2 hazırdır',flush=True)
    finally:
        handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1);handle.close()

if __name__=='__main__': main()
