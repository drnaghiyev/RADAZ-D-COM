package space.radaz.viewer.tablet;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

final class TabletUpdater {
    private static final String RELEASES="https://github.com/drnaghiyev/RADAZ-D-COM/releases/";
    private static final String FEED="https://raw.githubusercontent.com/drnaghiyev/RADAZ-D-COM/main/android/release.json";
    private static final int LIMIT=64*1024*1024;
    private final Activity owner;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private boolean busy, waitingForPermission;
    private long lastCheck;
    private File verified;

    TabletUpdater(Activity activity){owner=activity;}
    private boolean alive(){return !owner.isFinishing()&&!owner.isDestroyed();}
    void close(){worker.shutdownNow();}
    private void notifyUser(String text){if(alive())Toast.makeText(owner,text,Toast.LENGTH_LONG).show();}
    private static long code(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
    private static HttpsURLConnection connect(String address) throws IOException {
        URL url=new URL(address);
        for(int redirects=0;redirects<6;redirects++){
            String host=url.getHost().toLowerCase(Locale.ROOT);
            if(!url.getProtocol().equals("https")||url.getUserInfo()!=null||(url.getPort()!=-1&&url.getPort()!=443)
                || !(host.equals("raw.githubusercontent.com")||host.equals("github.com")||host.equals("release-assets.githubusercontent.com")||host.equals("objects.githubusercontent.com")))throw new IOException("Yenilənmə ünvanı təsdiqlənmədi.");
            HttpsURLConnection conn=(HttpsURLConnection)url.openConnection();
            conn.setConnectTimeout(15000);conn.setReadTimeout(45000);conn.setInstanceFollowRedirects(false);conn.setUseCaches(false);
            conn.setRequestProperty("User-Agent","RADAZ-Tablet-Updater");conn.setRequestProperty("Accept-Encoding","identity");
            int status=conn.getResponseCode();
            if(status==200)return conn;
            String next=conn.getHeaderField("Location");conn.disconnect();
            if(status<300||status>=400||next==null)throw new IOException("Yenilənmə serveri cavab vermədi (HTTP "+status+").");
            url=new URL(url,next);
        }
        throw new IOException("Yenilənmə ünvanına keçid alınmadı.");
    }
    private static JSONObject manifest() throws Exception{
        HttpsURLConnection conn=connect(FEED);
        try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buf=new byte[2048];int n;
            while((n=in.read(buf))!=-1){if(out.size()+n>16384)throw new IOException("Yenilənmə məlumatı düzgün deyil.");out.write(buf,0,n);}
            return new JSONObject(out.toString("UTF-8"));
        }finally{conn.disconnect();}
    }
    void resume(){
        if(waitingForPermission){
            waitingForPermission=false;
            if(owner.getPackageManager().canRequestPackageInstalls())install();
            else notifyUser("Quraşdırma icazəsini verdikdən sonra «Yenilə» düyməsini seçin.");
        }else check(false);
    }
    void check(boolean manual){
        if(!alive()||busy)return;
        long now=android.os.SystemClock.elapsedRealtime();
        if(!manual&&lastCheck!=0&&now-lastCheck<15*60*1000)return;
        lastCheck=now;busy=true;
        worker.execute(()->{
            try{
                JSONObject release=manifest();String version=release.getString("version");
                int build=release.getInt("versionCode"),revision=release.getInt("revision");long size=release.getLong("size");
                String sha=release.getString("sha256"),url=release.getString("url");
                if(!version.matches("[0-9]+[.][0-9]+[.][0-9]+")||revision<1||revision>99||!sha.matches("[0-9a-f]{64}")||size<1||size>LIMIT
                    ||!url.equals(RELEASES+"download/v"+version+"/RADAZ-Tablet-"+version+"-"+revision+".apk"))throw new IOException("Yenilənmə məlumatı düzgün deyil.");
                long installed=code(owner.getPackageManager().getPackageInfo(owner.getPackageName(),0));
                owner.runOnUiThread(()->{
                    busy=false;if(!alive())return;
                    if(build<=installed){if(manual)notifyUser("Planşetdə son versiya quraşdırılıb.");return;}
                    new AlertDialog.Builder(owner).setTitle("RADAZ yenilənməsi").setMessage("Planşet üçün "+version+" versiyası hazırdır.")
                        .setPositiveButton("Yenilə",(d,w)->download(url,sha,size,build)).setNegativeButton("Sonra",null).show();
                });
            }catch(Exception ex){owner.runOnUiThread(()->{busy=false;lastCheck=0;if(manual)notifyUser("Yenilənmə yoxlanmadı. "+ex.getMessage());});}
        });
    }
    private static String hex(byte[] bytes){
        StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();
    }
    private void download(String url,String sha,long size,int build){
        if(busy||!alive())return;busy=true;
        ProgressDialog dialog=new ProgressDialog(owner);dialog.setTitle("RADAZ yenilənir");dialog.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        dialog.setMax(100);dialog.setCancelable(false);dialog.show();
        worker.execute(()->{
            File staging=new File(owner.getCacheDir(),"tablet-update.part"),ready=UpdateFileProvider.apk(owner);
            try{
                HttpsURLConnection conn=connect(url);MessageDigest hash=MessageDigest.getInstance("SHA-256");long read=0;int shown=-1;
                try(InputStream input=conn.getInputStream();FileOutputStream output=new FileOutputStream(staging)){
                    byte[] bytes=new byte[65536];int count;
                    while((count=input.read(bytes))!=-1){
                        read+=count;if(read>size||Thread.interrupted())throw new IOException("Yükləmə dayandırıldı.");
                        hash.update(bytes,0,count);output.write(bytes,0,count);
                        int progress=(int)(100*read/size);if(progress!=shown){shown=progress;owner.runOnUiThread(()->{if(alive())dialog.setProgress(progress);});}
                    }
                    output.getFD().sync();
                }finally{conn.disconnect();}
                if(read!=size||!hex(hash.digest()).equals(sha))throw new IOException("Yüklənmiş paketin bütövlüyü təsdiqlənmədi.");
                validatePackage(staging,build);
                java.nio.file.Files.move(staging.toPath(),ready.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING,java.nio.file.StandardCopyOption.ATOMIC_MOVE);
                owner.runOnUiThread(()->{busy=false;if(!alive())return;dialog.dismiss();verified=ready;install();});
            }catch(Exception ex){staging.delete();owner.runOnUiThread(()->{busy=false;if(alive()){dialog.dismiss();notifyUser("Yenilənmə alınmadı. "+ex.getMessage());}});}
        });
    }
    private void validatePackage(File file,int build)throws Exception{
        PackageManager pm=owner.getPackageManager();
        int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo installed=pm.getPackageInfo(owner.getPackageName(),flags),candidate=pm.getPackageArchiveInfo(file.getPath(),flags);
        if(candidate==null||!installed.packageName.equals(candidate.packageName)||code(candidate)!=build||build<=code(installed))throw new IOException("Paket bu RADAZ quraşdırmasına uyğun deyil.");
        Signature[] old=Build.VERSION.SDK_INT>=28?installed.signingInfo.getApkContentsSigners():installed.signatures;
        Signature[] next=Build.VERSION.SDK_INT>=28?candidate.signingInfo.getApkContentsSigners():candidate.signatures;
        if(old==null||old.length==0||!Arrays.equals(old,next))throw new IOException("RADAZ paketinin imzası uyğun gəlmir.");
    }
    private void install(){
        if(verified==null||!verified.isFile()||!alive())return;
        try{
            if(!owner.getPackageManager().canRequestPackageInstalls()){
                waitingForPermission=true;
                owner.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+owner.getPackageName())));return;
            }
            Uri uri=UpdateFileProvider.uri(owner);
            Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive");
            intent.setClipData(ClipData.newRawUri("RADAZ yenilənməsi",uri));intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            owner.startActivity(intent);
        }catch(RuntimeException ex){waitingForPermission=false;notifyUser("Android quraşdırıcısı açıla bilmədi.");}
    }
}
