package space.radaz.viewer.tablet;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.OpenableColumns;
import android.webkit.WebResourceResponse;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Only the URIs the Android picker (or sharing app) explicitly granted are readable. */
final class DocumentImports {
    static final class Item {
        final Uri uri;
        final String name, mime, relative;
        Item(Uri uri,String name,String mime,String relative) {
            this.uri=uri; this.name=name; this.mime=mime; this.relative=relative;
        }
    }
    private final ContentResolver resolver;
    private final Map<String,List<Item>> selections = new ConcurrentHashMap<>();
    DocumentImports(ContentResolver resolver) {this.resolver = resolver;}

    static List<Uri> uris(android.content.Intent result) {
        Set<Uri> uris = new LinkedHashSet<>();
        if (result != null) {
            if(result.getData()!=null) uris.add(result.getData());
            android.content.ClipData clip=result.getClipData();
            if(clip!=null) for(int n=0;n<clip.getItemCount();n++) uris.add(clip.getItemAt(n).getUri());
        }
        uris.removeIf(uri -> uri==null || !"content".equals(uri.getScheme()));
        return new ArrayList<>(uris);
    }

    List<Item> files(Collection<Uri> uris) {
        List<Item> result=new ArrayList<>();
        for(Uri uri : uris) {
            if(!"content".equals(uri.getScheme())) continue;
            String name="DICOM";
            try(Cursor cur=resolver.query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)) {
                if(cur!=null && cur.moveToFirst() && !cur.isNull(0)) name=cur.getString(0);
            }
            result.add(new Item(uri,name,resolver.getType(uri),""));
        }
        return result;
    }

    List<Item> folder(Uri tree) throws FileNotFoundException {
        ArrayList<Item> result=new ArrayList<>();
        ArrayDeque<String[]> queue=new ArrayDeque<>();
        HashSet<String> visited=new HashSet<>();
        queue.add(new String[]{DocumentsContract.getTreeDocumentId(tree),""});
        while(!queue.isEmpty()) {
            String[] parent=queue.removeFirst();
            if(!visited.add(parent[0])) continue;
            Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,parent[0]);
            try(Cursor c=resolver.query(children,new String[]{Document.COLUMN_DOCUMENT_ID,Document.COLUMN_DISPLAY_NAME,Document.COLUMN_MIME_TYPE},null,null,null)) {
                if(c==null) throw new FileNotFoundException("Qovluq oxunmadı.");
                while(c.moveToNext()) {
                    String id=c.getString(0), name=c.getString(1), mime=c.getString(2);
                    if(name==null || id==null) continue;
                    String relative=parent[1]+name;
                    if(Document.MIME_TYPE_DIR.equals(mime)) queue.addLast(new String[]{id,relative+"/"});
                    else result.add(new Item(DocumentsContract.buildDocumentUriUsingTree(tree,id),name,mime,relative));
                }
            }
        }
        return result;
    }

    String publish(List<Item> files) {String id=UUID.randomUUID().toString();selections.put(id,files);return id;}
    void release(String id) {selections.remove(id);}
    WebResourceResponse read(String path) {
        String[] parts=path.split("/",-1);
        if(parts.length!=5) return TabletAssets.json(404,"{}");
        List<Item> list=selections.get(parts[3]);
        if(list==null) return TabletAssets.json(404,"{}");
        try {
            if("list".equals(parts[4])) {
                JSONArray entries=new JSONArray();
                for(Item item:list) entries.put(new JSONObject().put("name",item.name).put("mime",item.mime).put("relative",item.relative));
                return TabletAssets.json(200,entries.toString());
            }
            int index=Integer.parseInt(parts[4]);
            if(index<0 || index>=list.size()) return TabletAssets.json(404,"{}");
            Item item=list.get(index);
            InputStream bytes=resolver.openInputStream(item.uri);
            if(bytes==null) return TabletAssets.json(404,"{}");
            return TabletAssets.response(200,"application/octet-stream",bytes);
        } catch(Exception error) {return TabletAssets.json(404,"{}");}
    }
}
