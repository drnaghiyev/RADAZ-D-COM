package space.radaz.viewer.tablet;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.*;

/** Receive with the enrolled device's key. A receipt requires a separate, durable archive commit. */
final class TabletInbox implements AutoCloseable {
    interface StreamReader {void read(InputStream input)throws Exception;}
    interface Download {void get(String url,String token,String delivery,String sha,StreamReader reader)throws Exception;}
    private final ClinicNetwork.Vault vault;
    private final ClinicNetwork.Transport service;
    private final Download download;
    private final File spool;
    private final ArrayDeque<Item> items=new ArrayDeque<>();
    private static final int BATCH_SIZE=32;
    private final Map<String,Integer> nextStudy=new HashMap<>();
    private final Map<String,Long> deferred=new HashMap<>();
    private final Queue<String> profiles=new ArrayDeque<>(Arrays.asList("internet","private"));
    private Item active;
    private File file;
    private String ticket,error="";
    private boolean closed;
    private static final class Item {
        final String profile,device,id,clinic,study,uid,sha;
        final long size;
        Item(String profile,String device,JSONObject row,JSONObject instance)throws Exception {
            this.profile=profile;this.device=device;id=row.getString("id");clinic=row.getString("clinic");
            study=row.getString("study");uid=instance.getString("uid");sha=instance.getString("sha256");size=instance.getLong("size");
            if(!id.matches("[A-Za-z0-9_-]{1,128}")||!sha.matches("[a-f0-9]{64}")||size<=0||size>512L*1024*1024||
               !uid.matches("[0-9]+(\\.[0-9]+)+")||uid.length()>64||!study.matches("[0-9]+(\\.[0-9]+)+")||study.length()>64)
                throw new IOException("Göndəriş manifesti düzgün deyil.");
        }
        String key(){return profile+"/"+id+"/"+sha;}
    }
    TabletInbox(ClinicNetwork.Vault vault,ClinicNetwork.Transport service,Download download,File spool){
        this.vault=vault;this.service=service;this.download=download;this.spool=spool;
        if(!spool.isDirectory())spool.mkdirs();
        File[] stale=spool.listFiles((d,name)->name.matches("part-[a-zA-Z0-9-]+\\.tmp"));
        if(stale!=null)for(File path:stale)path.delete();
    }
    private JSONObject config(String profile,String device)throws Exception{
        JSONObject cfg=vault.read(profile);
        return cfg.optBoolean("enabled")&&!cfg.optString("token").isEmpty()&&(device==null||device.equals(cfg.optString("deviceId")))?cfg:null;
    }
    private static Set<String> strings(JSONArray values)throws Exception{
        Set<String> result=new HashSet<>();
        if(values!=null)for(int i=0;i<values.length();i++)result.add(values.getString(i));
        return result;
    }
    private JSONObject rpc(JSONObject cfg,String action,JSONObject data)throws Exception{
        return service.post(cfg.getString("url"),action,data,cfg.getString("token"));
    }
    private void discover(String profile)throws Exception{
        JSONObject cfg=config(profile,null);if(cfg==null)return;
        JSONObject state=rpc(cfg,"state",new JSONObject());
        String device=cfg.getString("deviceId"),user=state.getJSONObject("user").getString("id");
        if(state.optBoolean("superAdmin")||!device.equals(state.getJSONObject("device").getString("id")))return;
        JSONArray rows=state.getJSONArray("deliveries");
        List<List<Item>> ready=new ArrayList<>();
        long now=System.currentTimeMillis();
        deferred.entrySet().removeIf(e->e.getValue()<=now);
        for(int i=0;i<rows.length();i++){
            JSONObject row=rows.getJSONObject(i);
            if(!user.equals(row.optString("recipient"))||row.optInt("viewOnly")!=0)continue;
            String status=row.getString("state");
            if("queued".equals(status)){
                try{row=rpc(cfg,"accept",new JSONObject().put("delivery",row.getString("id")));}
                catch(ClinicNetwork.Failure refused){
                    if("HTTP_409".equals(refused.code)||"HTTP_403".equals(refused.code))continue;
                    throw refused;
                }
            }
            if(!"accepted".equals(row.optString("state"))||!device.equals(row.optString("device"))||row.optInt("viewOnly")!=0)continue;
            Set<String> available=strings(row.optJSONArray("uploaded"));
            available.removeAll(strings(row.optJSONArray("received")));
            JSONArray files=row.getJSONArray("files");
            List<Item> study=new ArrayList<>();
            for(int j=0;j<files.length()&&study.size()<BATCH_SIZE;j++){
                JSONObject instance=files.getJSONObject(j);
                if(available.contains(instance.getString("sha256"))){
                    Item item=new Item(profile,device,row,instance);
                    if(!deferred.containsKey(item.key()))study.add(item);
                }
            }
            if(!study.isEmpty())ready.add(study);
        }
        if(ready.isEmpty())return;
        int offset=nextStudy.getOrDefault(profile,0)%ready.size();
        for(int round=0;round<BATCH_SIZE&&items.size()<BATCH_SIZE;round++){
            boolean found=false;
            for(int i=0;i<ready.size()&&items.size()<BATCH_SIZE;i++){
                List<Item> study=ready.get((offset+i)%ready.size());
                if(round<study.size()){items.add(study.get(round));found=true;}
            }
            if(!found)break;
        }
        nextStudy.put(profile,(offset+(ready.size()>BATCH_SIZE?BATCH_SIZE:1))%ready.size());
    }
    private static byte[] read(DataInputStream input,int length)throws IOException{
        byte[] bytes=new byte[length];input.readFully(bytes);return bytes;
    }
    private static void decrypt(InputStream input,OutputStream plain,JSONObject cfg,Item item)throws Exception{
        DataInputStream in=new DataInputStream(input);
        if(in.readInt()!=0x50444e31)throw new IOException("DICOM paketi tanınmadı.");
        int length=in.readUnsignedShort();
        if(length<256||length>1024)throw new IOException("DICOM açarı tanınmadı.");
        Cipher rsa=Cipher.getInstance("RSA/ECB/OAEPPadding");
        rsa.init(Cipher.DECRYPT_MODE,KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(cfg.getString("privateKey")))),
            new OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA256,PSource.PSpecified.DEFAULT));
        byte[] key=rsa.doFinal(read(in,length));
        if(key.length!=32)throw new IOException("DICOM açarı düzgün deyil.");
        Cipher aes=Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,read(in,12)));
        Arrays.fill(key,(byte)0);
        aes.updateAAD(String.join("|",item.id,item.clinic,item.study,item.uid,item.sha,item.device).getBytes(StandardCharsets.UTF_8));
        byte[] tag=read(in,16),block=new byte[64*1024];
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(java.security.DigestOutputStream out=new java.security.DigestOutputStream(plain,digest)){
            long remaining=item.size;
            while(remaining>0){int count=in.read(block,0,(int)Math.min(block.length,remaining));if(count<0)throw new EOFException();
                remaining-=count;byte[] bytes=aes.update(block,0,count);if(bytes!=null)out.write(bytes);}
            if(in.read()!=-1)throw new IOException("DICOM faylının ölçüsü uyğun deyil.");
            out.write(aes.doFinal(tag));
        }
        StringBuilder hash=new StringBuilder(64);
        for(byte b:digest.digest())hash.append(Character.forDigit((b>>4)&15,16)).append(Character.forDigit(b&15,16));
        if(!item.sha.contentEquals(hash))throw new IOException("DICOM faylının bütövlüyü təsdiqlənmədi.");
    }
    synchronized JSONObject next()throws Exception{
        if(closed)throw new IOException("closed");
        if(active!=null&&config(active.profile,active.device)==null)clear();
        if(active==null&&items.isEmpty()){
            for(int i=0;i<2;i++){
                String profile=profiles.remove();profiles.add(profile);
                try{discover(profile);}catch(Exception ignored){error="Şəbəkə bağlantısı yenidən yoxlanacaq.";}
                if(!items.isEmpty())break;
            }
        }
        while(active==null&&!items.isEmpty()){
            Item item=items.remove();JSONObject cfg=config(item.profile,item.device);if(cfg==null)continue;
            File temporary=File.createTempFile("part-",".tmp",spool);
            try{
                if(spool.getUsableSpace()<item.size+1024*1024)throw new IOException("Planşet yaddaşı doludur.");
                download.get(cfg.getString("url"),cfg.getString("token"),item.id,item.sha,stream->{
                    try(OutputStream out=new BufferedOutputStream(new FileOutputStream(temporary))){decrypt(stream,out,cfg,item);}
                });
                if(temporary.length()!=item.size)throw new IOException("DICOM ölçüsü uyğun deyil.");
                active=item;file=temporary;ticket=UUID.randomUUID().toString();error="";
            }catch(Exception invalid){temporary.delete();deferred.put(item.key(),System.currentTimeMillis()+30000);
                error="DICOM qəbulu tamamlanmadı. Bağlantı və boş yaddaş yoxlanmalıdır.";break;}
        }
        if(active==null)return new JSONObject().put("message",error);
        return new JSONObject().put("ticket",ticket).put("study",active.study).put("uid",active.uid).put("sha",active.sha).put("size",active.size);
    }
    synchronized InputStream open(String id)throws Exception{
        return ticket!=null&&ticket.equals(id)&&config(active.profile,active.device)!=null?new FileInputStream(file):null;
    }
    synchronized boolean finish(String id,boolean committed)throws Exception{
        if(ticket==null||!ticket.equals(id))throw new IOException("Göndəriş dəyişib.");
        boolean complete=false;
        if(committed){
            JSONObject cfg=config(active.profile,active.device);
            if(cfg!=null){
                try{
                    JSONObject reply=rpc(cfg,"ack",new JSONObject().put("delivery",active.id).put("sha256",active.sha));
                    complete="complete".equals(reply.optString("state"));
                }catch(ClinicNetwork.Failure error){
                    if("HTTP_403".equals(error.code)||"HTTP_404".equals(error.code)||"HTTP_409".equals(error.code)){
                        clear();items.clear();
                    }
                    throw error;
                }
            }
        }else{deferred.put(active.key(),System.currentTimeMillis()+30000);}
        clear();
        return complete;
    }
    private void clear(){if(file!=null)file.delete();active=null;file=null;ticket=null;}
    @Override public synchronized void close(){closed=true;clear();items.clear();}
}
