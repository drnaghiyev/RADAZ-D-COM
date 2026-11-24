import {storeIncomingDicom} from '../lib/local-archive';

type Reply={ticket?:string;study:string;uid:string;sha:string;size:number;error?:string;message?:string};
type InboxWindow=Window&{radazInboxResult?:(id:string,reply:Reply)=>void};
if(typeof window!=='undefined'&&location.origin==='https://appassets.androidplatform.net'&&location.pathname==='/'){
  const app=window as InboxWindow;
  const waiting=new Map<string,(reply:Reply)=>void>();
  app.radazInboxResult=(id,reply)=>waiting.get(id)?.(reply);
  function request(action:string,ticket?:string){
    return new Promise<Reply>((resolve,reject)=>{
      const id=crypto.randomUUID();
      const fail=()=>{waiting.delete(id);reject(Error('Qəbul xidməti cavab vermədi.'));};
      const timer=setTimeout(fail,120000);
      waiting.set(id,reply=>{clearTimeout(timer);waiting.delete(id);if(reply.error)reject(Error(reply.error));else resolve(reply);});
      if(window.prompt('radaz-tablet/inbox',JSON.stringify({id,action,ticket}))!=='ok'){clearTimeout(timer);fail();}
    });
  }
  let busy=false,timer:ReturnType<typeof setTimeout>;
  async function poll(){
    if(busy)return;
    busy=true;clearTimeout(timer);
    let delay=4000;
    try{
      const item=await request('next');
      if(item.ticket){
        try{
          const response=await fetch('/_tablet/inbox/'+encodeURIComponent(item.ticket),{cache:'no-store'});
          if(!response.ok)throw Error('Görüntü oxunmadı.');
          await storeIncomingDicom(new File([await response.blob()],item.uid+'.dcm',{type:'application/dicom'}),item);
        }catch(error){await request('retry',item.ticket);throw error;}
        await request('stored',item.ticket);
        delay=0;
      }
    }catch{delay=5000;}
    finally{
      busy=false;
      if(delay===0)void poll();
      else timer=setTimeout(poll,delay);
    }
  }
  window.addEventListener('online',poll);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
  timer=setTimeout(poll,1000);
}
