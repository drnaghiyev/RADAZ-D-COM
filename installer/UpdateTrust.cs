// Runs under the installing user. Only the fixed Windows certutil operation can elevate.
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Security;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Win32;

internal static class UpdateTrust {
    static readonly string[] Hosts = {"github.com","api.github.com","radaz.space","release-assets.githubusercontent.com","objects.githubusercontent.com","github-releases.githubusercontent.com"};
    static string logs;
    [DllImport("netapi32.dll", CharSet=CharSet.Unicode)]
    static extern int NetGetJoinInformation(string server, out IntPtr name, out int status);
    [DllImport("netapi32.dll")] static extern int NetApiBufferFree(IntPtr buffer);
    static void Log(string phase, string value) {
        try {
            Directory.CreateDirectory(logs);
            File.AppendAllText(Path.Combine(logs,"ssl-diagnostics.jsonl"),String.Format(
                "{{\"at\":\"{0:o}\",\"phase\":\"{1}\",\"value\":\"{2}\"}}\n",DateTime.UtcNow, phase, value));
        } catch(IOException) {} catch(UnauthorizedAccessException) {}
    }
    static bool HasPolicyValues(RegistryKey key,int depth){
        if(key.ValueCount>0) return true;
        if(depth==0) return key.SubKeyCount>0;
        foreach(string name in key.GetSubKeyNames())
            using(RegistryKey child=key.OpenSubKey(name)){if(child!=null && HasPolicyValues(child,depth-1)) return true;}
        return false;
    }
    static bool Managed() {
        try {
            IntPtr name; int status;
            if(NetGetJoinInformation(null,out name,out status)!=0) return true;
            if(name!=IntPtr.Zero) NetApiBufferFree(name);
            if(status==3) return true;
            foreach(string key in new[]{@"SOFTWARE\Policies\Microsoft\SystemCertificates",@"SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate",
                         @"SYSTEM\CurrentControlSet\Control\CloudDomainJoin\JoinInfo",@"SOFTWARE\Microsoft\Provisioning\OMADM\Accounts"}) {
                using(RegistryKey policy=Registry.LocalMachine.OpenSubKey(key)) {
                    if(policy!=null && (key.Contains(@"\Policies\") ? HasPolicyValues(policy,4) : policy.SubKeyCount>0)) return true;
                }
            }
            return Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\SystemCertificates\AuthRoot\AutoUpdate","RootDirUrl",null)!=null;
        } catch { return true; }
    }
    sealed class Probe {
        public string Kind="network";
        public string Host;
        public byte[] Issuer;
        public long Skew;
        public int HttpStatus;
    }
    static Probe Check(string host) {
        string path=host=="radaz.space"?"/radaz-update.json":host=="github.com"?"/drnaghiyev/RADAZ-D-COM/releases/latest/download/radaz-update.json":"/";
        return CheckUrl(new Uri("https://"+host+path),0);
    }
    static Probe CheckUrl(Uri url,int depth){
        string host=url.Host;
        Probe p=new Probe();p.Host=host;
        Uri next=null;
        HttpWebRequest req=(HttpWebRequest)WebRequest.Create(url);
        req.Method="GET"; req.UserAgent="RADAZ-TLS"; req.AllowAutoRedirect=false;
        req.Timeout=9000; req.ReadWriteTimeout=9000; req.KeepAlive=false;
        req.ConnectionGroupName=Guid.NewGuid().ToString();
        req.ServerCertificateValidationCallback=delegate(object sender,X509Certificate cert,X509Chain chain,SslPolicyErrors errors){
            if(errors==SslPolicyErrors.None) {p.Kind="verified";return true;}
            p.Kind="certificate";
            if((errors&SslPolicyErrors.RemoteCertificateNameMismatch)!=0) p.Kind="hostname";
            else if(errors==SslPolicyErrors.RemoteCertificateChainErrors && chain!=null){
                X509ChainStatusFlags flags=0;
                foreach(X509ChainStatus s in chain.ChainStatus) flags|=s.Status;
                var missing=X509ChainStatusFlags.PartialChain|X509ChainStatusFlags.UntrustedRoot;
                if(flags!=0 && (flags&~missing)==0 && chain.ChainElements.Count>0){
                    p.Kind="chain";
                    p.Issuer=chain.ChainElements[chain.ChainElements.Count-1].Certificate.RawData;
                } else if((flags & X509ChainStatusFlags.NotTimeValid)!=0) p.Kind="validity";
                else if((flags & (X509ChainStatusFlags.Revoked|X509ChainStatusFlags.ExplicitDistrust))!=0) p.Kind="distrust";
            }
            return false;
        };
        HttpWebResponse response=null;
        try {response=(HttpWebResponse)req.GetResponse();}
        catch(WebException ex){
            response=ex.Response as HttpWebResponse;
            Log("transport",host+" "+ex.Status);
            for(Exception cause=ex;cause!=null;cause=cause.InnerException)
                Log("transport-detail",cause.GetType().Name+" hr="+cause.HResult);
        }
        finally {
            if(response!=null) using(response){
                p.HttpStatus=(int)response.StatusCode;
                if(p.Kind=="verified" && p.HttpStatus>=300 && p.HttpStatus<400 &&
                    Uri.TryCreate(url,response.Headers["Location"],out next) &&
                    (depth>=5 || next.Scheme!="https" || Array.IndexOf(Hosts,next.Host)<0)){
                    next=null;p.Kind="redirect";
                }
                DateTimeOffset server;
                if(p.Kind=="verified" && DateTimeOffset.TryParse(response.Headers["Date"], CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal,out server)) {
                    p.Skew=(long)(DateTimeOffset.UtcNow-server.ToUniversalTime()).TotalSeconds;
                    if(Math.Abs(p.Skew)>600)p.Kind="clock";
                }
            }
            req.Abort();
        }
        Log("https",host+" "+p.Kind+" http="+p.HttpStatus+" clockDeltaSeconds="+p.Skew);
        return next!=null && p.Kind=="verified"?CheckUrl(next,depth+1):p;
    }
    static int SystemTool(string args){
        var start=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"certutil.exe"),args);
        start.UseShellExecute=true;start.Verb="runas";start.WindowStyle=ProcessWindowStyle.Hidden;
        start.WorkingDirectory=Environment.SystemDirectory;
        try {
            using(Process child=Process.Start(start)){
                if(!child.WaitForExit(75000)){Log("certutil","timeout");return 1460;}
                Log("certutil","exit="+child.ExitCode);return child.ExitCode;
            }
        } catch(System.ComponentModel.Win32Exception ex){Log("uac","win32="+ex.NativeErrorCode);return ex.NativeErrorCode;}
    }
    // Exit 10 authorizes offering a repair button. Other failures must not change trust.
    static int Run(string mode,string host){
        var build=Convert.ToInt32(Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion","CurrentBuildNumber","0"));
        Log("platform","windowsBuild="+build);
        ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
        ServicePointManager.CheckCertificateRevocationList=true;
        bool setup=mode=="setup";
        Probe probe=Check(host);
        if(setup && host=="github.com"){
            Probe mirror=Check("radaz.space");
            if(probe.Kind=="verified" && mirror.Kind!="verified")probe=mirror;
            if(mirror.Kind=="clock")probe=mirror;
        }
        bool managed=Managed();
        Log("policy",managed?"managed":"default");
        if(mode=="diagnose" || mode=="inspect"){
            return probe.Kind=="verified"?0:probe.Kind=="chain"&&!managed?10:21;
        }
        if(probe.Kind!="chain" || managed || probe.Issuer==null){
            // Setup obtains its requested UAC for a read-only machine store check. Installation stays per-user.
            if(setup)SystemTool("-silent -store Root");
            return probe.Kind=="verified"?0:21;
        }
        string temporary=Path.Combine(Path.GetTempPath(),"radaz-tls-"+Guid.NewGuid().ToString("N")+".cer");
        try {
            using(FileStream file=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None))
                file.Write(probe.Issuer,0,probe.Issuer.Length);
            // The observed issuer is ONLY a lookup key. Microsoft verifies and refreshes both signed CTLs.
            // No peer-supplied certificate is installed and OS distrust/EKU restrictions remain authoritative.
            int code=SystemTool("-f -verifyCTL AuthRoot \""+Environment.SystemDirectory+"\" \""+temporary+"\"");
            if(code==1223)return 22;
            // Even if the lookup did not match, trust is determined by a fresh TLS connection.
            return Check(probe.Host).Kind=="verified"?0:23;
        } finally { if(File.Exists(temporary))File.Delete(temporary); }
    }
    static int Main(string[] args) {
        if(args.Length!=3 || Array.IndexOf(new[]{"setup","diagnose","inspect","repair"},args[0])<0 || Array.IndexOf(Hosts,args[1])<0)return 64;
        logs=args[2];
        try{return Run(args[0],args[1]);}
        catch(Exception ex){Log("error",ex.GetType().Name+" hr="+ex.HResult);return 24;}
    }
}
