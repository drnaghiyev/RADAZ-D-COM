param([ValidateSet('List','Iso','Burn')][string]$Mode = 'List', [string]$Source, [string]$Destination, [string]$RecorderId, [string]$ProgressPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $master = New-Object -ComObject IMAPI2.MsftDiscMaster2
    if ($Mode -eq 'List') {
        $drives = @()
        foreach ($deviceId in $master) {
            $recorder = New-Object -ComObject IMAPI2.MsftDiscRecorder2
            $recorder.InitializeDiscRecorder($deviceId)
            $writer = New-Object -ComObject IMAPI2.MsftDiscFormat2Data
            $supported = [bool]$writer.IsRecorderSupported($recorder)
            $mediaSupported = $false; $blank = $false; $freeBytes = 0
            if ($supported) {
                $writer.Recorder = $recorder
                $mediaSupported = [bool]$writer.IsCurrentMediaSupported($recorder)
                if ($mediaSupported) { $blank = [bool]$writer.MediaHeuristicallyBlank; $freeBytes = [long]$writer.FreeSectorsOnMedia * 2048 }
            }
            $drives += @{ id=[string]$deviceId; name=([string]$recorder.VendorId+' '+[string]$recorder.ProductId).Trim(); volumes=@($recorder.VolumePathNames); canWrite=$supported; mediaSupported=$mediaSupported; blank=$blank; freeBytes=$freeBytes }
        }
        $printers = @(Get-Printer -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
        @{ drives=$drives; printers=$printers } | ConvertTo-Json -Depth 5 -Compress
        exit 0
    }
    $sourcePath = (Resolve-Path -LiteralPath $Source).Path
    if (!(Test-Path -LiteralPath (Join-Path $sourcePath 'DICOMDIR'))) { throw 'DICOMDIR tapılmadı' }
    $image = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
    $image.VolumeName = 'RADAZ_DICOM'
    $image.FileSystemsToCreate = 3 # ISO 9660 and Joliet
    if ($Mode -eq 'Burn') {
        $recorder = New-Object -ComObject IMAPI2.MsftDiscRecorder2
        $recorder.InitializeDiscRecorder($RecorderId)
        $writer = New-Object -ComObject IMAPI2.MsftDiscFormat2Data
        if (!$writer.IsRecorderSupported($recorder)) { throw 'Bu qurğu yalnız oxuyur. CD/DVD writer qoşun.' }
        $writer.Recorder = $recorder
        $writer.ClientName = 'RADAZ'
        if (!$writer.IsCurrentMediaSupported($recorder) -or !$writer.MediaHeuristicallyBlank) { throw 'Uyğun boş CD/DVD daxil edin. Mövcud disk silinmir.' }
        $image.ChooseImageDefaults($recorder)
        $image.FileSystemsToCreate = 3
        $image.FreeMediaBlocks = $writer.FreeSectorsOnMedia
    } else {
        $total = (Get-ChildItem -LiteralPath $sourcePath -File -Recurse | Measure-Object -Property Length -Sum).Sum
        $image.ChooseImageDefaultsForMediaType($(if ($total -lt 680MB) { 2 } else { 6 }))
        $image.FileSystemsToCreate = 3
    }
    $image.Root.AddTree($sourcePath, $false)
    $result = $image.CreateResultImage()
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
public sealed class RadazDiscProgress : IDisposable {
    private object writer;
    private Action<object,object> sink;
    private string path;
    private static Guid iid = new Guid("2735413C-7F64-5B0F-8F00-5D77AFBE261E");
    public RadazDiscProgress(object source, string destination) {
        writer=source;path=destination;sink=Update;
        ComEventsHelper.Combine(writer,iid,0x200,sink);
    }
    private static long Read(object source,string name) {return Convert.ToInt64(source.GetType().InvokeMember(name,BindingFlags.GetProperty,null,source,null));}
    private void Update(object sender,object progress) {
        try {
            long action=Read(progress,"CurrentAction"),total=action==4?Read(progress,"SectorCount"):0;
            long done=action==4?Math.Max(0,Read(progress,"LastWrittenLba")-Read(progress,"StartLba")+1):0;
            Save(path,action==5?"Disk tamamlanir":"CD/DVD yazilir",Math.Min(done,total),total);
        } catch { }
    }
    public static void Save(string path,string label,long done,long total) {
        if(String.IsNullOrEmpty(path))return;
        string temp=path+".tmp";
        File.WriteAllText(temp,"{\"label\":\""+label+"\",\"done\":"+done+",\"total\":"+total+",\"unit\":\"sektor\"}",new System.Text.UTF8Encoding(false));
        if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);
    }
    public void Dispose() {ComEventsHelper.Remove(writer,iid,0x200,sink);}
}
'@
    if ($Mode -eq 'Burn') {
        $writer.ForceMediaToBeClosed = $true
        $tracker = $null
        try {
            try { $tracker = [RadazDiscProgress]::new($writer,$ProgressPath) } catch { }
            $writer.Write($result.ImageStream)
        } finally { if ($tracker) { try { $tracker.Dispose() } catch { } } }
        @{message='CD/DVD-yə yazma tamamlandı. Disk digər cihazlarda oxunmaq üçün bağlandı.'} | ConvertTo-Json -Compress
    } else {
        Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class RadazIsoStream {
    private static void Report(string path,long done,long total) {
        if(String.IsNullOrEmpty(path))return;
        for(int attempt=0;attempt<20;attempt++) {
            try {
                string temporary=path+".tmp";
                File.WriteAllText(temporary,"{\"label\":\"ISO fayli yazilir\",\"done\":"+done+",\"total\":"+total+",\"unit\":\"bayt\"}",new System.Text.UTF8Encoding(false));
                if(File.Exists(path))File.Replace(temporary,path,null);else File.Move(temporary,path);
                return;
            } catch(IOException) {System.Threading.Thread.Sleep(10);}
              catch(UnauthorizedAccessException) {System.Threading.Thread.Sleep(10);}
        }
    }
    public static void Save(object source, string destination, string progressPath) {
        IStream stream = (IStream)source;
        System.Runtime.InteropServices.ComTypes.STATSTG stat;stream.Stat(out stat,1);long total=stat.cbSize,written=0;var timer=System.Diagnostics.Stopwatch.StartNew();
        IntPtr read = Marshal.AllocHGlobal(4);
        try {
            byte[] buffer = new byte[1048576];
            using (FileStream output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None)) {
                while (true) {
                    stream.Read(buffer, buffer.Length, read);
                    int count = Marshal.ReadInt32(read);
                    if (count == 0) break;
                    output.Write(buffer, 0, count);
                    written+=count;
                    if(timer.ElapsedMilliseconds>=250 || written==total){
                        Report(progressPath,written,total);
                        timer.Restart();
                    }
                }
                output.Flush(true);
            }
        } finally { Marshal.FreeHGlobal(read); }
    }
}
'@
        [RadazIsoStream]::Save($result.ImageStream, $Destination, $ProgressPath)
        @{message='CD/DVD ISO faylı hazırdır.'} | ConvertTo-Json -Compress
    }
} catch {
    [Console]::WriteLine($_.Exception.Message)
    exit 1
}
