package space.radaz.viewer.tablet;

import java.io.File;
import java.io.IOException;
import java.util.*;
import org.json.JSONArray;
import org.json.JSONObject;

public final class InboxFairness {
    public static void main(String[] args)throws Exception{
        JSONArray rows=new JSONArray();
        // Each study individually has enough available images to fill a download batch.
        for(int study=0;study<40;study++){
            JSONArray files=new JSONArray(),uploaded=new JSONArray();
            for(int instance=0;instance<36;instance++){
                String hash=String.format(Locale.ROOT,"%064x",study*36+instance);
                files.put(new JSONObject().put("uid","2.25."+study+"."+instance).put("size",64).put("sha256",hash));
                uploaded.put(hash);
            }
            rows.put(new JSONObject().put("id","study-"+study).put("state","accepted").put("study","2.25."+study)
                .put("device","tablet").put("recipient","doctor").put("clinic","clinic").put("files",files).put("uploaded",uploaded));
        }
        JSONObject state=new JSONObject().put("user",new JSONObject().put("id","doctor"))
            .put("device",new JSONObject().put("id","tablet")).put("deliveries",rows);
        ClinicProbe.TestVault vault=new ClinicProbe.TestVault();
        vault.write("internet",new JSONObject().put("enabled",true).put("token","test").put("deviceId","tablet").put("url","https://test.invalid"));
        List<String> attempts=new ArrayList<>();
        try(TabletInbox inbox=new TabletInbox(vault,(url,action,body,token)->state,(url,token,delivery,sha,reader)->{
                attempts.add(delivery);throw new IOException("simulated interruption");
            },new File(args[0],"fairness"))){
            for(int i=0;i<40;i++)inbox.next();
        }
        if(attempts.size()!=40||new HashSet<>(attempts).size()!=40)throw new AssertionError("An active study was starved");
    }
}
