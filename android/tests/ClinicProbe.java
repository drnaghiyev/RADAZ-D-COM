package space.radaz.viewer.tablet;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

// Drive the shipping protocol and HTTPS implementation without a physical Android Keystore.
public final class ClinicProbe {
    static final class TestVault implements ClinicNetwork.Vault {
        private final Map<String,String> values=new HashMap<>();
        public JSONObject read(String name)throws Exception{return new JSONObject(values.getOrDefault(name,"{}"));}
        public void write(String name,JSONObject data){values.put(name,data.toString());}
    }
    public static void main(String[] args)throws Exception {
        final String internet=args[0],privateUrl=args[1];
        ClinicHttps https=new ClinicHttps();
        ClinicNetwork.Transport transport=(url,action,body,token)->{
            if(url.equals("https://radaz.space/dicom-network"))url=internet;
            if(!url.equals(internet)&&!url.equals(privateUrl))throw new AssertionError("Test attempted to contact a non-fixture endpoint");
            return https.post(url,action,body,token);
        };
        Map<String,TestVault> vaults=new HashMap<>();
        Map<String,ClinicNetwork> clients=new HashMap<>();
        Map<String,TabletInbox> receivers=new HashMap<>();
        BufferedReader input=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));
        PrintWriter out=new PrintWriter(new OutputStreamWriter(System.out,StandardCharsets.UTF_8),true);
        for(String line;(line=input.readLine())!=null;){
            JSONObject req=new JSONObject(line),reply=new JSONObject();
            String device=req.getString("client");
            if(req.optBoolean("restart"))clients.remove(device);
            ClinicNetwork client=clients.computeIfAbsent(device,k->new ClinicNetwork(vaults.computeIfAbsent(k,i->new TestVault()),transport));
            try{
                String action=req.getString("action");
                JSONObject data=req.getJSONObject("data");
                if(action.equals("fixture_sender")){
                    // Only the disposable test workstation. Production does not expose device credentials.
                    if(!device.equals("Clinic Alpha"))throw new IllegalArgumentException();
                    reply.put("data",vaults.get(device).read("internet"));
                }else if(action.startsWith("inbox_")){
                    TabletInbox inbox=receivers.computeIfAbsent(device,k->new TabletInbox(vaults.get(k),transport,(url,token,id,sha,reader)->{
                        if(url.equals("https://radaz.space/dicom-network"))url=internet;
                        if(!url.equals(internet)&&!url.equals(privateUrl))throw new AssertionError("Non-fixture URL");
                        https.download(url,token,id,sha,reader);
                    },new File(args[2],device)));
                    if(action.equals("inbox_next"))reply.put("data",inbox.next());
                    else if(action.equals("inbox_read")){
                        try(InputStream stream=inbox.open(data.getString("ticket"))){
                            reply.put("data",new JSONObject().put("bytes",java.util.Base64.getEncoder().encodeToString(stream.readAllBytes())));
                        }
                    }else{inbox.finish(data.getString("ticket"),action.equals("inbox_stored"));reply.put("data",new JSONObject());}
                }else reply.put("data",client.call(req.getString("window"),action,req.getString("profile"),data,req.optString("session","")));
            }catch(ClinicNetwork.Failure error){reply.put("error",error.getMessage()).put("code",error.code);}
            catch(Exception error){reply.put("error",error.getClass().getSimpleName()+": "+error.getMessage());}
            out.println(reply.toString());
        }
    }
}
