package space.radaz.viewer.tablet;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class ClinicVault implements ClinicNetwork.Vault {
    private static final String ALIAS="space.radaz.viewer.tablet.network-v1";
    private final SharedPreferences settings;
    ClinicVault(Context context){settings=context.getSharedPreferences("clinic-profiles-v1",Context.MODE_PRIVATE);}
    private SecretKey key(boolean creating)throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        if(!creating||!settings.getAll().isEmpty())throw new IOException("Stored profile key is unavailable");
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    @Override public JSONObject read(String name)throws Exception {
        String saved=settings.getString(name,null);
        if(saved==null)return new JSONObject();
        ByteBuffer raw=ByteBuffer.wrap(Base64.getDecoder().decode(saved));
        byte[] iv=new byte[12];raw.get(iv);byte[] blob=new byte[raw.remaining()];raw.get(blob);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,iv));
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        return new JSONObject(new String(cipher.doFinal(blob),StandardCharsets.UTF_8));
    }
    @Override public void write(String name,JSONObject data)throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(true));
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        byte[] encrypted=cipher.doFinal(data.toString().getBytes(StandardCharsets.UTF_8));
        byte[] iv=cipher.getIV();
        if(iv.length!=12)throw new IOException("Unsupported IV");
        byte[] payload=ByteBuffer.allocate(iv.length+encrypted.length).put(iv).put(encrypted).array();
        if(!settings.edit().putString(name,Base64.getEncoder().encodeToString(payload)).commit())throw new IOException("Cannot save tablet profile");
    }
}
