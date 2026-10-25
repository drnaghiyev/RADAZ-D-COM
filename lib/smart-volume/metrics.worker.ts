import {measureMask} from './geometry';
self.onmessage=event=>{
 try {self.postMessage({metrics:measureMask(event.data.mask,event.data.geometry,event.data.label)});}
 catch(error){self.postMessage({error:String(error)});}
};
