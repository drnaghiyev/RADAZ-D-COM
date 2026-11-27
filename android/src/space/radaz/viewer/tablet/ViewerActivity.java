package space.radaz.viewer.tablet;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.print.PrintManager;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;
import java.io.OutputStream;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ViewerActivity extends Activity {
    private static final int PICK=41, SAVE=42;
    private final ExecutorService reader=Executors.newSingleThreadExecutor();
    private final List<WebView> windows=new ArrayList<>();
    private ClinicBridge clinics;
    private InboxBridge receiver;
    private final Set<WebView> initialized=Collections.newSetFromMap(new IdentityHashMap<>());
    private final List<Uri> waiting=new ArrayList<>();
    private FrameLayout stage;
    private LinearLayout childBar;
    private TextView childTitle;
    private WebView home, active, archiveWindow, chooserWindow, saveWindow;
    private ValueCallback<Uri[]> chooser;
    private boolean pickingTree;
    private boolean volumeVisible;
    private Runnable removeVolumeBack;
    private String saveId;
    private OutputStream saving;
    private DocumentImports imports;
    private TabletAssets assets;
    private TabletUpdater updater;
    private final android.os.Handler updateTimer=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable checkUpdates=new Runnable(){
        @Override public void run(){if(updater!=null)updater.check(false);updateTimer.postDelayed(this,15*60*1000L);}
    };
    @Override protected void onResume(){super.onResume();if(updater!=null)updater.resume();updateTimer.postDelayed(checkUpdates,15*60*1000L);}
    @Override protected void onPause(){updateTimer.removeCallbacks(checkUpdates);super.onPause();}

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if(WebView.getCurrentWebViewPackage()==null){
            new AlertDialog.Builder(this).setTitle("Android System WebView")
                .setMessage("RADAZ görüntüləyicisini açmaq üçün planşetin sistem yeniləmələrində WebView komponentini aktivləşdirin və ya yeniləyin.")
                .setPositiveButton("Bağla",(d,w)->finish()).setOnCancelListener(d->finish()).show();
            return;
        }
        updater=new TabletUpdater(this);
        imports=new DocumentImports(getContentResolver());
        receiver=new InboxBridge(this);
        assets=new TabletAssets(this,imports,receiver.inbox);
        clinics=new ClinicBridge(this);
        LinearLayout root=new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(12,26,37));
        if(Build.VERSION.SDK_INT>=30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view,insets)->{
                android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());
                view.setPadding(safe.left,safe.top,safe.right,safe.bottom);
                return insets;
            });
        }
        childBar=new LinearLayout(this);
        childBar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        Button back=new Button(this,null,android.R.attr.borderlessButtonStyle);
        back.setText("‹");back.setTextSize(25);back.setPadding(0,0,0,0);
        back.setContentDescription("Əvvəlki pəncərə");back.setOnClickListener(v->onBackPressed());
        int side=Math.round(44*getResources().getDisplayMetrics().density);
        childBar.addView(back,new LinearLayout.LayoutParams(side,side));
        childTitle=new TextView(this);childTitle.setSingleLine();childTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        childBar.addView(childTitle,new LinearLayout.LayoutParams(0,-2,1));
        childBar.setVisibility(View.GONE);root.addView(childBar,new LinearLayout.LayoutParams(-1,side));
        stage=new FrameLayout(this);root.addView(stage,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(root);
        home=createWindow();
        show(home);home.loadUrl(TabletAssets.ORIGIN+"/");
        if(state==null) receiveIntent(getIntent());
    }
    private void message(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
    private void external(Uri uri) {
        String scheme=uri.getScheme();
        if(!"https".equals(scheme) && !"mailto".equals(scheme))return;
        try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException unavailable){message("Bu keçidi açacaq proqram tapılmadı.");}
    }
    private WebView createWindow() {
        WebView web=new WebView(this);windows.add(web);
        web.setBackgroundColor(Color.rgb(12,26,37));
        WebSettings settings=web.getSettings();
        settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(true);settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUseWideViewPort(true);settings.setSupportZoom(false);settings.setTextZoom(100);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if(TabletAssets.isLocal(uri) || "about:blank".equals(uri.toString()) || "blob".equals(uri.getScheme()))return false;
                if(request.isForMainFrame() && request.hasGesture())external(uri);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if(TabletAssets.isLocal(uri))return assets.handle(request);
                if("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))return TabletAssets.json(403,"{}");
                return null;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon) {
                if(view==home && volumeVisible){volumeVisible=false;updateVolumeBack();}
                initialized.remove(view);clinics.navigate(view,url);
                if(!"about:blank".equals(url) && !url.startsWith("blob:") && !TabletAssets.isLocal(Uri.parse(url)))view.stopLoading();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error){
                if(req.isForMainFrame()) message("Səhifə açılmadı. "+error.getDescription());
            }
        });
        web.setWebChromeClient(new Chrome());
        stage.addView(web,new FrameLayout.LayoutParams(-1,-1));web.setVisibility(View.GONE);
        return web;
    }
    private final class Chrome extends WebChromeClient {
        @Override public boolean onCreateWindow(WebView opener,boolean isDialog,boolean gesture,Message result) {
            if(windows.size()>=10 || !windows.contains(opener))return false;
            WebView child=createWindow();show(child);
            ((WebView.WebViewTransport)result.obj).setWebView(child);result.sendToTarget();return true;
        }
        @Override public void onCloseWindow(WebView view){if(view!=home)close(view);}
        @Override public void onRequestFocus(WebView view){if(windows.contains(view))show(view);}
        @Override public void onReceivedTitle(WebView view,String title){if(view==active)updateChildBar();}
        @Override public boolean onShowFileChooser(WebView web,ValueCallback<Uri[]> callback,FileChooserParams params){
            pick(web,params.getMode()==2?"folder":params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE?"multiple":"single",callback);return true;
        }
        @Override public boolean onJsPrompt(WebView web,String url,String command,String value,JsPromptResult result){
            if(!command.startsWith("radaz-tablet/"))return super.onJsPrompt(web,url,command,value,result);
            if(!TabletAssets.isLocal(Uri.parse(url))||!TabletAssets.isLocal(Uri.parse(web.getUrl()==null?"":web.getUrl()))) {result.cancel();return true;}
            String answer="ok";
            try {
                switch(command.substring("radaz-tablet/".length())) {
                    case "volume":
                        if(web!=home || !("open".equals(value) || "closed".equals(value))){answer="denied";break;}
                        volumeVisible="open".equals(value);
                        updateVolumeBack();
                        if(!volumeVisible && active==web)refreshHomeAfterVolume(web);
                        break;
                    case "updates": if(web==active)web.post(()->updater.check(true));else answer="denied";break;
                    case "network": answer=clinics.request(web,url,value);break;
                    case "inbox": answer=web==home?receiver.request(web,url,value):"denied";break;
                    case "open-archive":
                        if(web!=home || web!=active || !"/".equals(Uri.parse(url).getPath()))answer="denied";
                        else if(archiveWindow==null && windows.size()>=10)answer="busy";
                        else web.post(ViewerActivity.this::openArchive);
                        break;
                    case "open-studies":
                        if (web!=active || !openStudies(value)) answer="denied";
                        break;
                    case "ready": initialized.add(web);if(web==home)web.post(ViewerActivity.this::deliverPending);break;
                    case "pick": if(web!=active || !pick(web,value,null))answer="busy";break;
                    case "release": imports.release(value);break;
                    case "print":
                        if(web!=active){answer="denied";break;}
                        ((PrintManager)getSystemService(Context.PRINT_SERVICE)).print("RADAZ",web.createPrintDocumentAdapter("RADAZ"),null);break;
                    case "save": if(web!=active || !startSave(web,new JSONObject(value)))answer="busy";break;
                    case "write":
                        if(web!=saveWindow || saving==null || value.length()>135000 || !value.startsWith(saveId+":")){answer="denied";break;}
                        saving.write(android.util.Base64.decode(value.substring(saveId.length()+1),android.util.Base64.NO_WRAP));break;
                    case "abort": case "finish":
                        if(web!=saveWindow || !value.equals(saveId)){answer="denied";break;}
                        if(!endSave())answer="error";break;
                    default: answer="denied";
                }
            }catch(Exception problem){answer="error";message("Əməliyyat tamamlanmadı.");}
            result.confirm(answer);return true;
        }
    }
    private void openArchive(){
        if(archiveWindow==null){
            archiveWindow=createWindow();
            archiveWindow.loadUrl(TabletAssets.ORIGIN+"/archive");
        }
        show(archiveWindow);
    }
    private boolean openStudies(String value) throws org.json.JSONException {
        if(value==null || value.length()>14000)return false;
        org.json.JSONArray studies=new org.json.JSONArray(value);
        if(studies.length()==0 || studies.length()>200)return false;
        java.util.ArrayList<String> ids=new java.util.ArrayList<>();
        for(int i=0;i<studies.length();i++){
            String uid=studies.getString(i);
            if(uid.length()>64 || !uid.matches("[0-9]+(?:[.][0-9]+)*"))return false;
            ids.add(uid);
        }
        String url=TabletAssets.ORIGIN+"/#archive-studies="+android.net.Uri.encode(android.text.TextUtils.join(",",ids));
        home.post(()->{
            show(home);
            String event="!window.dispatchEvent(new CustomEvent('radaz-tablet-open-studies',{cancelable:true,detail:"+studies.toString()+"}))";
            home.evaluateJavascript(event,handled->{if(!"true".equals(handled))home.loadUrl(url);});
        });
        return true;
    }
    private void show(WebView view){
        if(view==null || !windows.contains(view))return;
        if(active!=null && active!=view)active.setVisibility(View.GONE);
        active=view;view.setVisibility(View.VISIBLE);view.bringToFront();view.requestFocus();updateChildBar();updateVolumeBack();
    }
    private void updateChildBar(){
        boolean child=active!=null&&active!=home;
        String childUrl=child?active.getUrl():null;
        boolean records=childUrl!=null && (childUrl.startsWith(TabletAssets.ORIGIN+"/archive")||childUrl.startsWith(TabletAssets.ORIGIN+"/pacs"));
        childBar.setVisibility(child && !records?View.VISIBLE:View.GONE);
        if(child){
            String title=active.getTitle();
            childTitle.setText(title==null||title.contains("RADAZ_VIEWER_")||title.contains("RADAZ_RECORDS_")?"":title);
        }
    }
    private void close(WebView web) {
        if(web==home || !windows.contains(web))return;
        int previous=Math.max(0,windows.indexOf(web)-1);
        if(web==archiveWindow)archiveWindow=null;
        initialized.remove(web);windows.remove(web);clinics.navigate(web,null);stage.removeView(web);web.destroy();
        if(active==web){active=null;show(windows.get(previous));}
    }
    private void refreshHomeAfterVolume(WebView web) {
        web.post(()->{
            if(web!=home || active!=web || volumeVisible || isFinishing())return;
            web.requestLayout();
            web.postInvalidateOnAnimation();
            web.postVisualStateCallback(0,new WebView.VisualStateCallback(){
                @Override public void onComplete(long requestId){
                    if(web==home && active==web && !volumeVisible)web.postInvalidateOnAnimation();
                }
            });
        });
    }
    private boolean dismissVolume() {
        if(!volumeVisible || active!=home || home==null)return false;
        home.evaluateJavascript("window.dispatchEvent(new Event('radaz:close-volume'))",null);
        return true;
    }
    private void updateVolumeBack() {
        boolean needed=volumeVisible && active==home && home!=null;
        if(!needed && removeVolumeBack!=null){removeVolumeBack.run();removeVolumeBack=null;}
        if(needed && removeVolumeBack==null && Build.VERSION.SDK_INT>=33){
            removeVolumeBack=VolumeBack.register(this);
        }
    }
    @android.annotation.TargetApi(33)
    private static final class VolumeBack {
        static Runnable register(ViewerActivity activity) {
            android.window.OnBackInvokedDispatcher dispatcher=activity.getOnBackInvokedDispatcher();
            android.window.OnBackInvokedCallback callback=()->activity.dismissVolume();
            dispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,callback);
            return ()->dispatcher.unregisterOnBackInvokedCallback(callback);
        }
    }
    @Override public void onBackPressed(){
        if(dismissVolume())return;
        if(active!=null&&active.canGoBack())active.goBack();
        else if(active!=null && active!=home)close(active);
        else super.onBackPressed();
    }

    private boolean pick(WebView web,String mode,ValueCallback<Uri[]> callback) {
        if(chooserWindow!=null){if(callback!=null)callback.onReceiveValue(null);return false;}
        pickingTree="folder".equals(mode);chooserWindow=web;chooser=callback;
        Intent choose=new Intent(pickingTree?Intent.ACTION_OPEN_DOCUMENT_TREE:Intent.ACTION_OPEN_DOCUMENT);
        if(!pickingTree)choose.setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,"multiple".equals(mode));
        try{startActivityForResult(choose,PICK);return true;}
        catch(ActivityNotFoundException e){chooserWindow=null;chooser=null;if(callback!=null)callback.onReceiveValue(null);message("Android fayl seçicisi tapılmadı.");return false;}
    }
    @Override public void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code==SAVE && saveWindow!=null){
            WebView web=saveWindow;String id=saveId;
            if(result==RESULT_OK && data!=null && data.getData()!=null && "content".equals(data.getData().getScheme())){
                try{saving=getContentResolver().openOutputStream(data.getData(),"wt");}catch(Exception e){message("Fayl yazılmaq üçün açılmadı.");}
            }
            boolean ok=saving!=null;if(!ok)endSave();
            if(windows.contains(web))web.evaluateJavascript("window.radazTabletSave?.("+JSONObject.quote(id)+","+ok+")",null);
        }
        if(code!=PICK || chooserWindow==null)return;
        WebView web=chooserWindow;ValueCallback<Uri[]> callback=chooser;boolean tree=pickingTree;
        chooser=null;chooserWindow=null;
        List<Uri> values=result==RESULT_OK?DocumentImports.uris(data):Collections.emptyList();
        if(values.isEmpty()){if(callback!=null)callback.onReceiveValue(null);return;}
        loadFiles(web,values,tree,false,callback);
    }
    private void loadFiles(WebView web,List<Uri> uris,boolean tree,boolean external,ValueCallback<Uri[]> callback){
        reader.execute(()->{
            try{
                List<DocumentImports.Item> items=tree?imports.folder(uris.get(0)):imports.files(uris);
                runOnUiThread(()->{
                    if(isDestroyed() || !windows.contains(web)){if(callback!=null)callback.onReceiveValue(null);return;}
                    if(items.isEmpty()){if(callback!=null)callback.onReceiveValue(null);message("Qovluqda oxuna bilən fayl tapılmadı.");return;}
                    if(callback!=null){Uri[] handles=new Uri[items.size()];for(int n=0;n<items.size();n++)handles[n]=items.get(n).uri;callback.onReceiveValue(handles);return;}
                    String id=imports.publish(items);
                    web.evaluateJavascript("typeof window.radazTabletReceive==='function' && (window.radazTabletReceive("+JSONObject.quote(id)+","+external+"),true)",ok->{
                        if(!"true".equals(ok)){imports.release(id);message("Viewer hazır olduqdan sonra faylı yenidən seçin.");}
                    });
                });
            }catch(Exception e){runOnUiThread(()->{if(callback!=null)callback.onReceiveValue(null);if(!isDestroyed())message("Seçilmiş fayllara giriş alınmadı.");});}
        });
    }
    private void receiveIntent(Intent intent){
        if(intent==null)return;
        String action=intent.getAction();
        if(!Intent.ACTION_VIEW.equals(action)&&!Intent.ACTION_SEND.equals(action)&&!Intent.ACTION_SEND_MULTIPLE.equals(action))return;
        Set<Uri> files=new LinkedHashSet<>(DocumentImports.uris(intent));
        // Some Android file managers only supply EXTRA_STREAM, with no ClipData.
        if(Intent.ACTION_SEND.equals(action)){Object item=intent.getParcelableExtra(Intent.EXTRA_STREAM);if(item instanceof Uri)files.add((Uri)item);}
        else if(Intent.ACTION_SEND_MULTIPLE.equals(action)){List<?> items=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);if(items!=null)for(Object item:items)if(item instanceof Uri)files.add((Uri)item);}
        for(Uri uri:files)if("content".equals(uri.getScheme()) && checkUriPermission(uri,android.os.Process.myPid(),android.os.Process.myUid(),Intent.FLAG_GRANT_READ_URI_PERMISSION)==android.content.pm.PackageManager.PERMISSION_GRANTED)waiting.add(uri);
        if(waiting.isEmpty())return;
        show(home);deliverPending();
    }
    private void deliverPending(){if(waiting.isEmpty()||!initialized.contains(home))return;List<Uri> files=new ArrayList<>(waiting);waiting.clear();loadFiles(home,files,false,true,null);}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);receiveIntent(intent);}
    private boolean startSave(WebView web,JSONObject descriptor) throws Exception {
        if(saveWindow!=null)return false;
        String id=descriptor.getString("id");UUID.fromString(id);String name=descriptor.optString("name","RADAZ");
        if(name.length()>180 || name.indexOf('/')>=0 || name.indexOf('\\')>=0)name="RADAZ";
        String mime=java.net.URLConnection.guessContentTypeFromName(name);
        if(name.toLowerCase(Locale.ROOT).endsWith(".dcm"))mime="application/dicom";
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime==null?"application/octet-stream":mime).putExtra(Intent.EXTRA_TITLE,name);
        saveWindow=web;saveId=id;try{startActivityForResult(intent,SAVE);}catch(Exception e){endSave();throw e;}return true;
    }
    private boolean endSave(){
        boolean ok=true;
        try{if(saving!=null)saving.close();}catch(Exception e){ok=false;message("Faylı tam saxlamaq mümkün olmadı.");}
        saving=null;saveWindow=null;saveId=null;
        return ok;
    }
    @Override protected void onDestroy(){
        volumeVisible=false;updateVolumeBack();
        endSave();reader.shutdownNow();if(clinics!=null)clinics.destroy();
        if(receiver!=null)receiver.close();
        if(chooser!=null)chooser.onReceiveValue(null);
        for(WebView web:new ArrayList<>(windows)){stage.removeView(web);web.destroy();}
        windows.clear();if(updater!=null)updater.close();super.onDestroy();
    }
}
