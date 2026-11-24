package space.radaz.viewer.tablet;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public final class UpdateFileProvider extends ContentProvider {
    static File apk(Context context){return new File(context.getCacheDir(),"verified-tablet-update.apk");}
    static Uri uri(Context context){return Uri.parse("content://"+context.getPackageName()+".updates/RADAZ.apk");}
    private File resolve(Uri requested){
        if(!uri(getContext()).equals(requested))throw new IllegalArgumentException("Unknown file");
        return apk(getContext());
    }
    @Override public boolean onCreate(){return true;}
    @Override public String getType(Uri requested){resolve(requested);return "application/vnd.android.package-archive";}
    @Override public ParcelFileDescriptor openFile(Uri requested,String mode)throws FileNotFoundException{
        File file=resolve(requested);if(!"r".equals(mode))throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri requested,String[] projection,String selection,String[] args,String order){
        File file=resolve(requested);
        String[] columns=projection!=null?projection:new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE};
        MatrixCursor cursor=new MatrixCursor(columns,1);MatrixCursor.RowBuilder row=cursor.newRow();
        for(String column:columns)row.add(OpenableColumns.DISPLAY_NAME.equals(column)?"RADAZ.apk":OpenableColumns.SIZE.equals(column)?file.length():null);
        return cursor;
    }
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String sel,String[] args){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String sel,String[] args){throw new UnsupportedOperationException();}
}
