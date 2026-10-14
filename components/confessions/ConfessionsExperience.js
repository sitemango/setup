'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { submitConfession, loadMoreConfessions } from '@/lib/actions/confessions';
import { Button, Card, EmptyState, Notice, Textarea } from '@/components/ui';
import { ReportDialog } from '@/components/social/ReportDialog';
import { PaperToss } from './PaperToss';

const STORE='campus-confessions-state-v1';
export function ConfessionsExperience({ initialItems, initialCursor, quota }) {
  const [items,setItems]=useState(initialItems); const [cursor,setCursor]=useState(initialCursor);
  const [pending,startTransition]=useTransition(); const [error,setError]=useState(''); const [success,setSuccess]=useState(false);
  const [remaining,setRemaining]=useState(quota.remaining); const [length,setLength]=useState(0); const [tossedContent,setTossedContent]=useState(''); const formRef=useRef(null);
  useEffect(()=>{ const raw=sessionStorage.getItem(STORE); if(raw){try{const saved=JSON.parse(raw); if(Number.isFinite(saved.scrollY)) requestAnimationFrame(()=>scrollTo(0,saved.scrollY));}catch{}} const save=()=>sessionStorage.setItem(STORE,JSON.stringify({cursor,lastSeenId:items.at(-1)?.id,scrollY})); addEventListener('pagehide',save); return()=>removeEventListener('pagehide',save);},[cursor,items]);
  const complete=useCallback(()=>setSuccess(false),[]);
  function submit(event){event.preventDefault();setError('');const data=new FormData(event.currentTarget);const submitted=String(data.get('content')||'');startTransition(async()=>{const result=await submitConfession(data);if(!result?.ok){setError(result?.error||'Your confession could not be accepted.');return;}setRemaining(result.remaining);setTossedContent(submitted);setSuccess(true);formRef.current?.reset();setLength(0);});}
  function more(){if(!cursor)return;setError('');startTransition(async()=>{const fd=new FormData();fd.set('published_at',cursor.publishedAt);fd.set('id',cursor.id);const result=await loadMoreConfessions(fd);if(!result.ok){setError(result.error);return;}const fresh=result.items.filter(row=>!items.some(old=>old.id===row.id));setItems(old=>[...old,...fresh]);const last=result.items.at(-1);setCursor(result.items.length===12&&last?{publishedAt:last.published_at,id:last.id}:null);});}
  return <div className="flex flex-col gap-6">
    <Card className="confession-composer overflow-hidden p-5 sm:p-6">
      <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3">
        <div><h2 className="text-lg font-semibold">Fold up a thought</h2><p className="mt-1 text-sm text-muted">Anonymous to students. Safety staff can reveal identity only for a serious, audited investigation.</p></div>
        <label htmlFor="confession-content" className="sr-only">Your confession</label>
        <Textarea id="confession-content" name="content" minLength={10} maxLength={1000} rows={5} required disabled={pending||remaining===0} placeholder="Say what you could not say out loud…" onChange={e=>setLength(e.target.value.length)} />
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted"><span>{length}/1000 · {remaining} of {quota.limit} remaining today (IST)</span><Button type="submit" disabled={pending||remaining===0} loading={pending}>{pending?'Accepting…':'Crumple & submit'}</Button></div>
        {remaining===0?<Notice tone="neutral">You have reached today’s limit. It resets at midnight in Asia/Kolkata.</Notice>:null}
        {error?<Notice tone="danger">{error}</Notice>:null}
        {success?<Notice tone="success">Accepted for moderation. Your daily allowance has been updated.</Notice>:null}
      </form>
      <PaperToss active={success} content={tossedContent} onComplete={complete}/>
    </Card>
    <section aria-labelledby="confession-feed-title"><h2 id="confession-feed-title" className="mb-3 text-lg font-semibold">Recently unfolded</h2>
      {!items.length?<EmptyState title="No confessions yet" description="Published confessions will appear here after moderation."/>:<div className="grid gap-4 sm:grid-cols-2">{items.map((item,index)=><Card key={item.id} as="article" className="confession-paper p-5"><p className="whitespace-pre-wrap leading-relaxed">{item.content}</p><footer className="mt-5 flex items-center justify-between text-2xs text-muted"><time dateTime={item.published_at}>Confession #{items.length-index}</time><ReportDialog targetType="confession" targetRef={item.id} label="confession"/></footer></Card>)}</div>}
      <div className="mt-5 flex justify-center">{cursor?<Button variant="secondary" onClick={more} loading={pending}>Unfold more</Button>:items.length?<p className="text-sm text-muted">You are all caught up.</p>:null}</div>
    </section>
  </div>;
}
