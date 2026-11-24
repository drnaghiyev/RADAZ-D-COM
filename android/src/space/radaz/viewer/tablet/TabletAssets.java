package space.radaz.viewer.tablet;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

final class TabletAssets {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    private final Context context;
    final DocumentImports documents;
    private final TabletInbox inbox;

    TabletAssets(Context context, DocumentImports documents, TabletInbox inbox) {
        this.context = context;
        this.documents = documents;
        this.inbox = inbox;
    }

    static boolean isLocal(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    static WebResourceResponse json(int status, String value) {
        return response(status, "application/json", new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)));
    }

    static WebResourceResponse response(int status, String mime, InputStream stream) {
        String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : "Unavailable";
        String encoding = mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript") ? "utf-8" : null;
        return new WebResourceResponse(mime, encoding, status, reason, Collections.singletonMap("Cache-Control","no-store"), stream);
    }

    static WebResourceResponse unavailable() {
        return json(503, "{\"error\":\"Bu əməliyyat üçün uyğun RADAZ xidmətinə qoşulun. Planşetdə faylları yerli yaddaşdan aça bilərsiniz.\"}");
    }

    WebResourceResponse handle(WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (!isLocal(uri) || path == null || !path.startsWith("/") || path.indexOf('\\') >= 0
                || path.indexOf('\0') >= 0 || java.util.Arrays.asList(path.split("/")).contains("..")) {
            return json(404, "{}");
        }
        if(path.startsWith("/_tablet/inbox/")){
            if(!"GET".equals(request.getMethod()))return json(405,"{}");
            try{
                InputStream stream=inbox.open(path.substring("/_tablet/inbox/".length()));
                if(stream!=null)return response(200,"application/dicom",stream);
            }catch(Exception ignored){}
            return json(404,"{}");
        }
        if (path.startsWith("/_tablet/files/")) {
            return "GET".equals(request.getMethod()) ? documents.read(path) : json(405, "{}");
        }
        if ("/local-archive-api/license".equals(path) && "GET".equals(request.getMethod())) return trial();
        if ("/radaz-installation.json".equals(path)) return json(200, "{\"managed\":false}");
        if ("/local-archive-api/updates".equals(path)) return json(200, "{\"state\":\"current\",\"message\":\"Planşet üçün yenilənməni yoxlayın.\"}");
        if (path.startsWith("/local-archive-api/window/")) return json(200,"{}");
        if (path.startsWith("/local-archive-api/") || path.startsWith("/smart-volume-api/") ||
                path.startsWith("/anatomy-volume/") || path.startsWith("/api/") || path.equals("/radaz-update")) return unavailable();
        if (!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())) return json(405, "{}");
        String relative = path.substring(1);
        if (relative.endsWith("/")) relative = relative.substring(0, relative.length()-1);
        boolean route = !relative.contains(".");
        boolean rsc = false;
        if (route) {
            for (Map.Entry<String,String> header : request.getRequestHeaders().entrySet()) {
                if (("rsc".equalsIgnoreCase(header.getKey()) && "1".equals(header.getValue())) ||
                    ("accept".equalsIgnoreCase(header.getKey()) && header.getValue().contains("text/x-component"))) rsc = true;
            }
        }
        String asset = rsc ? "flight/" + (relative.isEmpty() ? "index" : relative.replace('/','-')) + ".rsc"
                : "web/" + (route ? (relative.isEmpty() ? "" : relative + "/") + "index.html" : relative);
        try {return response(200, mime(asset), context.getAssets().open(asset));}
        catch (IOException e) {return json(404, "{}");}
    }

    // Same calendar-month trial and five-minute rollback allowance as the desktop product.
    private synchronized WebResourceResponse trial() {
        try {
            SharedPreferences state = context.getSharedPreferences("tablet-trial", Context.MODE_PRIVATE);
            long firstInstall = context.getPackageManager().getPackageInfo(context.getPackageName(),0).firstInstallTime / 1000L;
            long now = Instant.now().getEpochSecond();
            long start = state.getLong("start", firstInstall > 0 ? firstInstall : now);
            long last = state.getLong("last",start);
            long end = Instant.ofEpochSecond(start).atZone(ZoneOffset.UTC).plusMonths(6).toEpochSecond();
            String device = state.getString("installation",null);
            boolean initialize = device == null;
            if (initialize) device = UUID.randomUUID().toString();
            boolean clockOk = now >= last - 300 && now >= start - 300;
            if (initialize || now - last >= 60) {
                if (!state.edit().putString("installation",device).putLong("start",start).putLong("last",Math.max(now,last)).commit()) return unavailable();
            }
            boolean valid = clockOk && now < end;
            String message = !clockOk ? "Planşetin tarix və saatını yoxlayın." : valid ? "6 aylıq Android demosu aktivdir." : "Android demosunun müddəti bitib.";
            JSONObject period = new JSONObject().put("startedAt",start).put("expiresAt",end).put("valid",valid)
                    .put("daysRemaining",valid ? (end-now+86399)/86400 : 0);
            return json(200,new JSONObject().put("valid",valid).put("required",true).put("kind",valid ? "trial" : "expired")
                    .put("deviceId",device).put("message",message).put("trial",period).put("modules",new JSONObject()).toString());
        } catch (Exception error) {return unavailable();}
    }

    private static String mime(String path) {
        String name = path.toLowerCase(Locale.ROOT);
        if(name.endsWith(".js") || name.endsWith(".mjs")) return "application/javascript";
        if(name.endsWith(".wasm")) return "application/wasm";
        if(name.endsWith(".html")) return "text/html";
        if(name.endsWith(".css")) return "text/css";
        if(name.endsWith(".json")) return "application/json";
        if(name.endsWith(".rsc")) return "text/x-component";
        if(name.endsWith(".svg")) return "image/svg+xml";
        if(name.endsWith(".png")) return "image/png";
        if(name.endsWith(".ico")) return "image/x-icon";
        if(name.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
