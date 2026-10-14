'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/** Next App Router adaptation of Interlude's MIT-licensed slide-over transition.
 * A still clone keeps the outgoing page visible while the ready route enters.
 * It never replaces routing or prevents default browser/link behaviour. */
export function SlideOverTransition() {
  const pathname=usePathname(); const oldPath=useRef(pathname); const layer=useRef(null); const backward=useRef(false); const loader=useRef(null);
  useEffect(()=>{
    const click=(event)=>{const link=event.target.closest?.('a[href]');if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target||link.hasAttribute('download'))return;let url;try{url=new URL(link.href,location.href)}catch{return}if(url.origin!==location.origin||url.pathname===location.pathname&&url.search===location.search)return;backward.current=false;capture();loader.current=setTimeout(()=>document.documentElement.classList.add('route-waiting'),180);};
    const pop=()=>{backward.current=true;capture();};
    const capture=()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const source=document.querySelector('.shell-root')||document.querySelector('main');if(!source)return;layer.current?.remove();const stage=document.createElement('div');stage.className='route-old-page';stage.setAttribute('aria-hidden','true');stage.inert=true;const copy=source.cloneNode(true);stage.append(copy);document.body.append(stage);layer.current=stage;};
    addEventListener('click',click,true);addEventListener('popstate',pop);return()=>{removeEventListener('click',click,true);removeEventListener('popstate',pop);clearTimeout(loader.current);layer.current?.remove();document.documentElement.classList.remove('route-waiting');};
  },[]);
  useEffect(()=>{if(oldPath.current===pathname)return;oldPath.current=pathname;clearTimeout(loader.current);document.documentElement.classList.remove('route-waiting');const old=layer.current;const current=document.querySelector('.shell-root')||document.querySelector('main');if(!old||!current)return;old.classList.add(backward.current?'route-old-back':'route-old-forward');current.animate(backward.current?[{transform:'translateY(0)'},{transform:'translateY(100vh)'}]:[{transform:'translateY(100vh)'},{transform:'translateY(0)'}],{duration:700,easing:'cubic-bezier(.76,0,.24,1)'});setTimeout(()=>{old.remove();if(layer.current===old)layer.current=null;},720);},[pathname]);
  return <div className="route-wait-indicator" aria-hidden="true"/>;
}
