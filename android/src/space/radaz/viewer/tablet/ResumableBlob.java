package space.radaz.viewer.tablet;

import java.io.*;
import java.net.URL;
import java.util.regex.*;
import javax.net.ssl.HttpsURLConnection;

/** Retain only ciphertext. A resumed response must identify the exact same authenticated envelope. */
final class ResumableBlob {
    private static final long MAX=512L*1024*1024+8192;
    private static final Pattern RANGE=Pattern.compile("bytes ([0-9]{1,12})-([0-9]{1,12})/([0-9]{1,12})");
    private final File directory;
    ResumableBlob(File directory){
        this.directory=directory;
        if(directory!=null){
            directory.mkdirs();
            File[] parts=directory.listFiles((d,n)->n.matches("[a-zA-Z0-9_-]{1,128}-[0-9a-f]{64}\\.(part|etag)"));
            if(parts!=null)for(File part:parts)if(part.lastModified()<System.currentTimeMillis()-86400000L)part.delete();
        }
    }
    void read(URL url,String token,String name,TabletInbox.StreamReader reader)throws Exception {
        File part=directory==null?null:new File(directory,name+".part");
        File id=directory==null?null:new File(directory,name+".etag");
        String prior="";
        if(id!=null && id.isFile() && id.length()<100){
            try(DataInputStream in=new DataInputStream(new FileInputStream(id))){prior=in.readUTF();}
            catch(IOException ignored){id.delete();}
        }
        long start=part!=null && prior.matches("\"[0-9a-f]{64}\"")?part.length():0;
        HttpsURLConnection conn=(HttpsURLConnection)url.openConnection();
        boolean consumed=false;
        try {
            conn.setInstanceFollowRedirects(false);conn.setUseCaches(false);
            conn.setConnectTimeout(10000);conn.setReadTimeout(90000);
            conn.setRequestProperty("Authorization","Bearer "+token);
            conn.setRequestProperty("Accept-Encoding","identity");
            if(start>0){conn.setRequestProperty("Range","bytes="+start+"-");conn.setRequestProperty("If-Range",prior);}
            int status=conn.getResponseCode();
            long count=conn.getContentLengthLong(),total=count;
            String tag=conn.getHeaderField("ETag");
            if(status==206){
                Matcher range=RANGE.matcher(String.valueOf(conn.getHeaderField("Content-Range")));
                if(start<=0 || !prior.equals(tag) || !range.matches() || Long.parseLong(range.group(1))!=start ||
                   (total=Long.parseLong(range.group(3)))!=start+count || Long.parseLong(range.group(2))!=total-1){
                    part.delete();id.delete();throw new IOException("Invalid resume response");
                }
            } else if(status==200)start=0;
            else{
                if(status==416 && part!=null){part.delete();id.delete();}
                throw new IOException("DICOM faylı hazır deyil.");
            }
            if(total>MAX || count==0)throw new IOException("Invalid envelope size");
            try(InputStream in=conn.getInputStream()){
                if(directory==null || total<1024*1024 || tag==null || !tag.matches("\"[0-9a-f]{64}\"")){
                    if(part!=null){part.delete();id.delete();}
                    reader.read(in);consumed=true;return;
                }
                if(directory.getUsableSpace()<count+total+1024*1024)throw new IOException("Planşet yaddaşı doludur.");
                if(start==0){
                    try(RandomAccessFile reset=new RandomAccessFile(part,"rw")){reset.setLength(0);}
                    try(DataOutputStream meta=new DataOutputStream(new FileOutputStream(id))){meta.writeUTF(tag);}
                }
                try(OutputStream out=new BufferedOutputStream(new FileOutputStream(part,true))){
                    byte[] block=new byte[65536];long written=start;int n;
                    while((n=in.read(block))!=-1){
                        if(n>total-written)throw new IOException("Invalid envelope length");
                        out.write(block,0,n);written+=n;
                    }
                    if(written!=total)throw new EOFException();
                }
                consumed=true;
            }
            try(InputStream complete=new BufferedInputStream(new FileInputStream(part))){reader.read(complete);}
            finally{part.delete();id.delete();}
        } finally{if(!consumed)conn.disconnect();}
    }
}
