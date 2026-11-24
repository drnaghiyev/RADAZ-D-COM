package space.radaz.viewer.tablet;

import org.json.JSONObject;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Device configuration client for the same authenticated coordinator protocol used by Desktop. */
final class ClinicNetwork {
    interface Vault {
        JSONObject read(String name) throws Exception;
        void write(String name,JSONObject data) throws Exception;
    }
    interface Transport {
        JSONObject post(String endpoint,String action,JSONObject body,String token) throws Exception;
    }
    static final class Failure extends Exception {
        final String code;
        Failure(String code,String message){super(message);this.code=code;}
    }
    private static final String INTERNET="https://radaz.space/dicom-network";
    private static final int SESSION_SECONDS=900;
    private static final Set<String> COMMON=new HashSet<>(Arrays.asList("policy","device-set","member","remove_member","block_user","block_device"));
    private static final Set<String> PUBLIC_CLINIC=new HashSet<>(Arrays.asList("open_clinic","invite_pc","answer_invite","cancel_invite"));
    private static final Set<String> PRIVATE_CLINIC=new HashSet<>(Arrays.asList("create_clinic","invite","link_clinic"));
    private final SecureRandom random=new SecureRandom();
    private final Vault vault;
    private final Transport remote;
    private final Map<String,Grant> grants=new HashMap<>();
    private static final class Grant {
        final String token;
        final long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(SESSION_SECONDS);
        Grant(String token){this.token=token;}
    }

    ClinicNetwork(Vault vault,Transport remote){this.vault=vault;this.remote=remote;}
    synchronized void closeWindow(String window){grants.remove(window);}
    private boolean granted(String window,String token){
        Grant grant=grants.get(window);
        return grant!=null && grant.deadline-System.nanoTime()>0 && grant.token.equals(token);
    }
    private void requireGrant(String window,String token)throws Failure {
        if(!granted(window,token))throw new Failure("SETTINGS_LOCKED","DICOM Network ayarlarını açmaq üçün şifrəni daxil edin.");
    }
    private byte[] randomBytes(int n){byte[] data=new byte[n];random.nextBytes(data);return data;}
    private String randomToken(){
        StringBuilder token=new StringBuilder(96);
        for(byte b:randomBytes(48))token.append(Character.forDigit((b>>4)&15,16)).append(Character.forDigit(b&15,16));
        return token.toString();
    }
    private static byte[] derive(String password,byte[] salt)throws Exception {
        PBEKeySpec spec=new PBEKeySpec(password.toCharArray(),salt,600000,256);
        try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();}
        finally{spec.clearPassword();}
    }
    private JSONObject access(String action,JSONObject body,String window,String token)throws Exception {
        JSONObject state=vault.read("lock");
        if(action.equals("settings_lock")){if(granted(window,token))grants.remove(window);return new JSONObject();}
        if(action.equals("settings_status"))return new JSONObject().put("passwordSet",state.has("hash")).put("unlocked",granted(window,token));
        boolean create=action.equals("settings_set"),change=action.equals("settings_change");
        if(!create&&!change&&!action.equals("settings_unlock"))throw new Failure("ACTION","Şifrə əməliyyatı tapılmadı.");
        if(change)requireGrant(window,token);
        if(create&&state.has("hash"))throw new Failure("SETTINGS_PASSWORD_EXISTS","Bu planşet üçün artıq şifrə təyin edilib.");
        if(!create){
            long now=System.currentTimeMillis();
            if(now<state.optLong("retry"))throw new Failure("WAIT","Bir qədər gözləyib yenidən cəhd edin.");
            String supplied=body.optString(change?"currentPassword":"password","");
            boolean valid=state.has("hash") && supplied.getBytes(StandardCharsets.UTF_8).length<=1024 &&
                MessageDigest.isEqual(Base64.getDecoder().decode(state.getString("hash")),derive(supplied,Base64.getDecoder().decode(state.getString("salt"))));
            if(!valid){
                int n=Math.min(12,state.optInt("failures")+1);
                state.put("failures",n).put("retry",n>=5?now+Math.min(300000,1000L<<(n-5)):0);
                vault.write("lock",state);
                throw new Failure("SETTINGS_PASSWORD_INVALID","Şifrə düzgün deyil.");
            }
        }
        if(create||change){
            String next=body.optString(change?"newPassword":"password","");
            if(next.codePointCount(0,next.length())<8||next.trim().isEmpty()||next.getBytes(StandardCharsets.UTF_8).length>1024)
                throw new Failure("SETTINGS_PASSWORD_FORMAT","Şifrə ən azı 8 simvol olmalıdır.");
            byte[] salt=randomBytes(32);
            state.put("salt",Base64.getEncoder().encodeToString(salt)).put("hash",Base64.getEncoder().encodeToString(derive(next,salt)));
        }
        state.put("failures",0).put("retry",0);
        vault.write("lock",state);
        if(create||change)grants.clear();
        Grant grant=new Grant(randomToken());grants.put(window,grant);
        return new JSONObject().put("session",grant.token).put("expiresIn",SESSION_SECONDS);
    }
    static String endpoint(String address)throws Failure {
        try{
            URI uri=new URI(address.trim());
            if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getRawQuery()!=null||
               uri.getRawFragment()!=null||uri.getPort()==0||uri.getPort()>65535||!uri.normalize().equals(uri))throw new IllegalArgumentException();
            return uri.toASCIIString().replaceAll("/+$","");
        }catch(Exception invalid){throw new Failure("ADDRESS","Klinikanın etibarlı HTTPS xidmət ünvanını daxil edin.");}
    }
    private void ensureIdentity(String profile,JSONObject cfg)throws Exception {
        if(cfg.has("publicKey"))return;
        KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA");generator.initialize(3072,random);
        KeyPair key=generator.generateKeyPair();
        String pem=Base64.getMimeEncoder(64,new byte[]{10}).encodeToString(key.getPublic().getEncoded());
        cfg.put("publicKey","-----BEGIN PUBLIC KEY-----\n"+pem+"\n-----END PUBLIC KEY-----\n");
        cfg.put("privateKey",Base64.getEncoder().encodeToString(key.getPrivate().getEncoded()));
        vault.write(profile,cfg);
    }
    private JSONObject state(JSONObject cfg,boolean internet,JSONObject data)throws Exception {
        boolean configured=cfg.has("token"),enabled=cfg.optBoolean("enabled")&&configured;
        JSONObject result=new JSONObject().put("configured",configured).put("enabled",enabled).put("internet",internet)
            .put("online",false).put("url",cfg.optString("url")).put("deviceId",cfg.optString("deviceId"));
        if(enabled){
            try {
                JSONObject response=remote.post(cfg.getString("url"),"state",new JSONObject().put("clinic",data.optString("clinic","")),cfg.getString("token"));
                if(response.optJSONObject("user")==null||response.optJSONArray("clinics")==null)
                    throw new Failure("PROTOCOL","Klinikanın cavabı tanınmadı.");
                for(String field:Arrays.asList("user","superAdmin","clinics","clinic","members","devices","membership","policy","memberManagementVersion","ownsClinic","invitations","outgoingInvites")){
                    if(response.has(field))result.put(field,response.get(field));
                }
                result.put("online",true);
            } catch(Exception error){result.put("error",error instanceof Failure?error.getMessage():"Klinikanın şəbəkə xidmətinə qoşulmaq mümkün olmadı.");}
        }
        return result;
    }
    synchronized JSONObject call(String window,String action,String profile,JSONObject data,String session)throws Exception {
        if(action.startsWith("settings_")&&!action.equals("settings_state"))return access(action,data,window,session);
        requireGrant(window,session);
        boolean internet=profile.equals("internet");
        if(!internet&&!profile.equals("private"))throw new Failure("PROFILE","Şəbəkə profili düzgün deyil.");
        JSONObject cfg=vault.read(profile);
        if(action.equals("settings_state"))return state(cfg,internet,data);
        if((internet&&action.equals("enroll_pc"))||(!internet&&action.equals("register"))){
            if(cfg.has("token")){
                if(internet)return state(cfg,true,data);
                throw new Failure("REGISTERED","Cihaz artıq bu şəbəkədə qeydiyyatdadır.");
            }
            String name=data.getString("name").trim();
            if(name.isEmpty()||name.length()>128)throw new Failure("NAME","Cihazın adını daxil edin.");
            String url=internet?INTERNET:endpoint(data.getString("url"));
            ensureIdentity(profile,cfg);
            JSONObject form=new JSONObject().put("publicKey",cfg.getString("publicKey")).put("name",name);
            String token="";
            if(internet){
                token=cfg.optString("enrollToken","");
                if(token.isEmpty()){token=randomToken();cfg.put("enrollToken",token);vault.write(profile,cfg);}
            }else form.put("invite",data.getString("invite"));
            JSONObject registered=remote.post(url,action,form,token);
            JSONObject device=registered.optJSONObject("device");
            String id=device==null?registered.getString("device"):device.getString("id");
            if(!internet)token=registered.getString("token");
            if(id.isEmpty()||token.isEmpty())throw new Failure("PROTOCOL","Cihazın qeydiyyatı təsdiqlənmədi.");
            cfg.put("token",token).put("deviceId",id).put("url",url).put("enabled",true);cfg.remove("enrollToken");
            vault.write(profile,cfg);return new JSONObject().put("deviceId",id);
        }
        if(!cfg.has("token"))throw new Failure("NOT_REGISTERED","Əvvəlcə planşeti şəbəkəyə qoşun.");
        if(action.equals("configure")){
            if(data.length()!=1||!(data.opt("enabled") instanceof Boolean))throw new Failure("CONFIG","Bu cihaz ayarı dəstəklənmir.");
            cfg.put("enabled",data.getBoolean("enabled"));vault.write(profile,cfg);return new JSONObject();
        }
        if(!cfg.optBoolean("enabled"))throw new Failure("DISABLED","Bu cihazda DICOM Network dayandırılıb.");
        if(!COMMON.contains(action)&&!(internet?PUBLIC_CLINIC:PRIVATE_CLINIC).contains(action))throw new Failure("ACTION","Bu şəbəkə əməliyyatı dəstəklənmir.");
        String rpc=action;
        if(action.equals("device-set"))rpc="device";
        if(action.equals("member")){
            String mode=data.optString("mode","");
            if(!mode.equals("edit")&&!mode.equals("create"))throw new Failure("MEMBER","Əməkdaş əməliyyatı düzgün deyil.");
            rpc=mode+"_member";
        }
        return remote.post(cfg.getString("url"),rpc,data,cfg.getString("token"));
    }
}
