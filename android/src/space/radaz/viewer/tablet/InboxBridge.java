package space.radaz.viewer.tablet;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.File;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

final class InboxBridge {
    final TabletInbox inbox;
    private final ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4));
    InboxBridge(Context context){
        ClinicHttps https=new ClinicHttps(new File(context.getCacheDir(),"network-encrypted-parts"));
        inbox=new TabletInbox(new ClinicVault(context),https,https::download,new File(context.getCacheDir(),"network-inbox"));
    }
    private static boolean mainPage(String address){
        if(address==null)return false;
        Uri uri=Uri.parse(address);
        return TabletAssets.isLocal(uri)&&"/".equals(uri.getPath());
    }
    String request(WebView home,String origin,String value)throws Exception{
        if(!mainPage(home.getUrl())||!mainPage(origin)||value.length()>512)return "denied";
        JSONObject input=new JSONObject(value);
        String id=input.getString("id");UUID.fromString(id);
        worker.execute(()->{
            JSONObject reply=new JSONObject();
            try{
                String action=input.getString("action");
                if("next".equals(action))reply=inbox.next();
                else if("stored".equals(action)||"retry".equals(action)){
                    if(inbox.finish(input.getString("ticket"),"stored".equals(action))){
                        home.post(()->android.widget.Toast.makeText(home.getContext(),"Göndərilən müayinə planşetin lokal arxivində saxlanıldı.",android.widget.Toast.LENGTH_LONG).show());
                    }
                }
                else throw new IllegalArgumentException();
            }catch(Exception error){
                try{reply.put("error","Qəbul tamamlanmadı. Avtomatik yenidən yoxlanacaq.");}catch(Exception ignored){}
            }
            String js="window.radazInboxResult?.("+JSONObject.quote(id)+","+reply.toString()+")";
            home.post(()->{if(mainPage(home.getUrl()))home.evaluateJavascript(js,null);});
        });
        return "ok";
    }
    void close(){worker.getQueue().clear();worker.execute(inbox::close);worker.shutdown();}
}
