import {useEffect,type RefObject} from 'react';
/** Scoped alternate shortcuts; never route editing keystrokes into the main viewer. */
export function useSmartShortcuts(root:RefObject<HTMLElement|null>,enabled:boolean){
 useEffect(()=>{const node=root.current;if(!node||!enabled)return;const keys='1234567890abcdefghijklmnopqrstuvwxyz',buttons=Array.from(node.querySelectorAll<HTMLButtonElement>('button')).filter(b=>!b.closest('.sv-surface')||node.classList.contains('sv-surface'));
 buttons.forEach((b,i)=>{if(!keys[i])return;const label=b.dataset.shortcutLabel||(b.title||b.getAttribute('aria-label')||b.textContent||'Alət');b.dataset.shortcutLabel=label;b.title=label+' · Alt+'+keys[i].toUpperCase();b.setAttribute('aria-keyshortcuts','Alt+'+keys[i]);});
 const key=(e:KeyboardEvent)=>{if(!e.altKey||e.ctrlKey||e.metaKey||(e.target as HTMLElement).closest('input,select,textarea,[contenteditable=true]'))return;const button=buttons[keys.indexOf(e.key.toLowerCase())];if(!button)return;e.preventDefault();e.stopImmediatePropagation();if(!button.disabled)button.click();};const target=node.ownerDocument.defaultView||window;target.addEventListener('keydown',key,true);return()=>target.removeEventListener('keydown',key,true);
 });
}
