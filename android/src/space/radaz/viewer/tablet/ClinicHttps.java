package space.radaz.viewer.tablet;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

final class ClinicHttps implements ClinicNetwork.Transport {
    void download(String endpoint,String token,String delivery,String sha,TabletInbox.StreamReader reader)throws Exception {
        if(!delivery.matches("[A-Za-z0-9_-]{1,128}")||!sha.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("manifest");
        URL url=new URL(ClinicNetwork.endpoint(endpoint)+"/v1/blob/"+delivery+"/"+sha);
        HttpsURLConnection connection=(HttpsURLConnection)url.openConnection();
        boolean consumed=false;
        try{
            connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
            connection.setConnectTimeout(10000);connection.setReadTimeout(30000);
            connection.setRequestProperty("Authorization","Bearer "+token);
            connection.setRequestProperty("Accept-Encoding","identity");
            if(connection.getResponseCode()!=200)throw new java.io.IOException("DICOM faylı hazır deyil.");
            try(InputStream stream=connection.getInputStream()){reader.read(stream);}
            consumed=true;
        }finally{if(!consumed)connection.disconnect();}
    }
    @Override public JSONObject post(String endpoint,String action,JSONObject body,String token)throws Exception {
        if(!action.matches("[a-z_]{1,32}"))throw new IllegalArgumentException("action");
        URL url=new URL(ClinicNetwork.endpoint(endpoint)+"/v1/"+action);
        HttpsURLConnection connection=(HttpsURLConnection)url.openConnection();
        boolean consumed=false;
        try{
            connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
            connection.setConnectTimeout(10000);connection.setReadTimeout(20000);
            connection.setRequestMethod("POST");connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
            connection.setRequestProperty("Accept","application/json");
            if(!token.isEmpty())connection.setRequestProperty("Authorization","Bearer "+token);
            byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try(OutputStream send=connection.getOutputStream()){send.write(bytes);}
            int status=connection.getResponseCode();
            boolean ok=status>=200&&status<300;
            if(status>=300&&status<400)throw new ClinicNetwork.Failure("REDIRECT","Klinikanın birbaşa HTTPS ünvanını istifadə edin.");
            try(InputStream stream=ok?connection.getInputStream():connection.getErrorStream()){
                ByteArrayOutputStream result=new ByteArrayOutputStream();
                byte[] block=new byte[8192];int n,limit=ok?8*1024*1024:8192;
                if(stream!=null)while((n=stream.read(block))!=-1){
                    if(n>limit-result.size())throw new ClinicNetwork.Failure("SIZE","Şəbəkə cavabı çox böyükdür.");
                    result.write(block,0,n);
                }
                JSONObject response;
                try{response=new JSONObject(result.toString("UTF-8"));}
                catch(Exception invalid){throw new ClinicNetwork.Failure("PROTOCOL","Ünvan DICOM Network cavabı qaytarmadı (HTTP "+status+").");}
                if(!ok){
                    String reason=response.optString("error","Sorğu qəbul edilmədi (HTTP "+status+").");
                    throw new ClinicNetwork.Failure("HTTP_"+status,reason.substring(0,Math.min(reason.length(),400)));
                }
                consumed=true;
                return response;
            }
        }catch(javax.net.ssl.SSLException security){throw new ClinicNetwork.Failure("TLS","Klinikanın HTTPS sertifikatı təsdiqlənmədi.");}
        catch(java.io.IOException offline){throw new ClinicNetwork.Failure("NETWORK","Klinikanın şəbəkə xidmətinə qoşulmaq mümkün olmadı.");}
        finally{if(!consumed)connection.disconnect();}
    }
}
