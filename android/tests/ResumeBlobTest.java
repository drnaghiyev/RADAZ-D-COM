package space.radaz.viewer.tablet;

import java.io.*;
import java.net.*;
import java.security.cert.Certificate;
import java.util.*;
import javax.net.ssl.HttpsURLConnection;

public class ResumeBlobTest {
    static class Connection extends HttpsURLConnection {
        final byte[] data;
        final int offset;
        final boolean interrupted;
        Connection(URL url,byte[] data,int offset,boolean interrupted){super(url);this.data=data;this.offset=offset;this.interrupted=interrupted;}
        public int getResponseCode(){return offset>0?206:200;}
        public String getHeaderField(String key){
            if("ETag".equals(key))return "\""+String.join("",Collections.nCopies(64,"a"))+"\"";
            if("Content-Range".equals(key))return "bytes "+offset+"-"+(data.length-1)+"/"+data.length;
            return null;
        }
        public long getContentLengthLong(){return data.length-offset;}
        public InputStream getInputStream(){
            return new ByteArrayInputStream(data,offset,interrupted?data.length/2:data.length-offset);
        }
        public void disconnect(){} public boolean usingProxy(){return false;} public void connect(){}
        public String getCipherSuite(){return "fixture";} public Certificate[] getLocalCertificates(){return null;}
        public Certificate[] getServerCertificates(){return null;}
    }
    public static void main(String[] args)throws Exception {
        File directory=new File(args[0],"resume");directory.mkdirs();
        byte[] bytes=new byte[2*1024*1024];new Random(5).nextBytes(bytes);
        final List<Connection> requests=new ArrayList<>();
        URL url=new URL(null,"https://clinic.invalid/file",new URLStreamHandler(){
            protected URLConnection openConnection(URL url){
                Connection conn=new Connection(url,bytes,requests.isEmpty()?0:bytes.length/2,requests.isEmpty());
                requests.add(conn);return conn;
            }
        });
        String name="test-"+String.join("",Collections.nCopies(64,"b"));
        try{
            new ResumableBlob(directory).read(url,"fixture",name,input->{throw new AssertionError("partial file committed");});
            throw new AssertionError("missing interruption");
        }catch(EOFException expected){}
        new ResumableBlob(directory).read(url,"fixture",name,input->{
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] block=new byte[32768];int n;
            while((n=input.read(block))!=-1)out.write(block,0,n);
            if(!Arrays.equals(bytes,out.toByteArray()))throw new AssertionError("resumed data");
        });
        if(!("bytes="+bytes.length/2+"-").equals(requests.get(1).getRequestProperty("Range")) ||
            requests.get(1).getRequestProperty("If-Range")==null || directory.listFiles().length!=0)throw new AssertionError("range/cleanup");
        System.out.println("Authenticated-envelope range resumes after process restart");
    }
}
