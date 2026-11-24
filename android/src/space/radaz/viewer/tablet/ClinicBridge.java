package space.radaz.viewer.tablet;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebView;
import org.json.JSONObject;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

final class ClinicBridge {
    private final Map<WebView,String> pages=new IdentityHashMap<>();
    private final ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(16));
    private final ClinicNetwork clinics;
    ClinicBridge(Context context){clinics=new ClinicNetwork(new ClinicVault(context),new ClinicHttps());}
    private static boolean allowed(String url){
        if(url==null)return false;
        Uri uri=Uri.parse(url);
        return TabletAssets.isLocal(uri)&&("/private-network/settings".equals(uri.getPath())||"/private-network/settings/".equals(uri.getPath()));
    }
    void navigate(WebView web,String url){
        String old=pages.remove(web);
        if(old!=null){
            try{worker.execute(()->clinics.closeWindow(old));}catch(RejectedExecutionException full){/* Tokens are scoped to the retired page and expire. */}
        }
        if(allowed(url))pages.put(web,UUID.randomUUID().toString());
    }
    String request(WebView web,String frame,String json)throws Exception{
        String page=pages.get(web);
        if(page==null||!allowed(web.getUrl())||!allowed(frame)||json.length()>320000)return "denied";
        JSONObject request=new JSONObject(json);
        String id=request.getString("id");UUID.fromString(id);
        try{
            worker.execute(()->{
                JSONObject result=new JSONObject();
                try{
                    result.put("data",clinics.call(page,request.getString("action"),request.getString("profile"),request.getJSONObject("data"),request.optString("session","")));
                }catch(Exception error){
                    try{
                        if(error instanceof ClinicNetwork.Failure)result.put("error",error.getMessage()).put("code",((ClinicNetwork.Failure)error).code);
                        else result.put("error","Planşetdə şəbəkə əməliyyatı tamamlanmadı.");
                    }catch(org.json.JSONException ignored){}
                }
                String reply=JSONObject.quote(result.toString());
                web.post(()->{
                    if(page.equals(pages.get(web))&&allowed(web.getUrl()))
                        web.evaluateJavascript("window.radazTabletNetworkResult?.("+JSONObject.quote(id)+","+reply+")",null);
                });
            });
            return "ok";
        }catch(RejectedExecutionException full){return "busy";}
    }
    void destroy(){pages.clear();worker.shutdownNow();}
}
