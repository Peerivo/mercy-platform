"use client";
import {useCallback,useEffect,useState} from "react";
import {z} from "zod";
import type {AuthChangeEvent,Session} from "@supabase/supabase-js";
import {browserSupabase} from "@/lib/supabase/client";
import {CHAT_PAGE_SIZE,ChatCursor,ChatMessage,compareMessages,drainChatHistory} from "@/lib/chat-history";
import {subscribeWhenPostgresReady} from "@/lib/supabase/realtime-ready";

const messageSchema=z.object({id:z.string().uuid(),body:z.string(),created_at:z.string(),author_id:z.string().uuid(),client_nonce:z.string().uuid()});
const messagesSchema=z.array(messageSchema);

export function Chat({requestId,initial,userId}:{requestId:string;initial:ChatMessage[];userId:string}){
  const [messages,setMessages]=useState(initial),[body,setBody]=useState(""),[state,setState]=useState("");
  const merge=useCallback((rows:ChatMessage[])=>setMessages(old=>Array.from(new Map([...old,...rows].map(x=>[x.id,x])).values()).sort(compareMessages)),[]);
  useEffect(()=>{
    let current=true;
    let lifecycleGeneration=0;
    let historyCursor:ChatCursor|undefined=[...initial].sort(compareMessages).at(-1);
    let syncing:Promise<void>|undefined;
    const s=browserSupabase();
    const catchUp=()=>{
      if(syncing)return syncing;
      syncing=(async()=>{try{
        historyCursor=await drainChatHistory({cursor:historyCursor,isCurrent:()=>current,acceptPage:merge,loadPage:async cursor=>{
          let q=s.from("messages").select("id,body,created_at,author_id,client_nonce").eq("help_request_id",requestId).order("created_at").order("id").limit(CHAT_PAGE_SIZE);
          if(cursor)q=q.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
          const {data,error}=await q;
          if(error)throw error;
          return messagesSchema.parse(data??[]);
        }});
      }catch{if(current)setState("Чат недоступен. Проверьте доступ и повторите попытку.")}finally{syncing=undefined}})();
      return syncing;
    };
    let subscription:ReturnType<typeof subscribeWhenPostgresReady>|undefined;
    const disconnect=()=>{const old=subscription;subscription=undefined;if(old)void old.unsubscribe()};
    const connect=()=>{
      if(!current||subscription)return;
      const channel=s.channel(`case-${requestId}-${crypto.randomUUID()}`).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`help_request_id=eq.${requestId}`},(p:{new:unknown})=>{
        const parsed=messageSchema.safeParse(p.new);if(current&&parsed.success)merge([parsed.data]);
      });
      const next=subscribeWhenPostgresReady(channel,{onReady:catchUp});subscription=next;
      void next.ready.catch(()=>{if(current&&subscription===next)setState("Соединение с чатом потеряно.")});
      void next.failure.catch(()=>{if(current&&subscription===next)setState("Соединение с чатом потеряно.")});
    };
    const quickExitActive=()=>{try{return sessionStorage.getItem("mercy_quick_exit")==="1"}catch{return true}};
    const onPageHide=()=>{lifecycleGeneration++;disconnect();void s.realtime.disconnect()};
    const onPageShow=(event:PageTransitionEvent)=>{if(!event.persisted)return;void (async()=>{
      if(quickExitActive())return;
      const generation=++lifecycleGeneration;
      const {data}=await s.auth.getUser();
      if(!current||generation!==lifecycleGeneration||quickExitActive())return;
      if(!data.user){location.replace("/auth");return}

      // Re-check access through the same help_requests RLS policy used by the
      // server page. The internal authorization helper stays out of the Data API.
      const { data: visibleCase, error } = await s
        .from("help_requests")
        .select("id")
        .eq("id",requestId)
        .maybeSingle();

      if (
        !current ||
        generation !== lifecycleGeneration ||
        quickExitActive()
      ) {
        return;
      }

      if (error || !visibleCase) {
        location.replace(`/cabinet/requests/${requestId}`);
        return;
      }

      connect();
    })()};
    addEventListener("pagehide",onPageHide);
    addEventListener("pageshow",onPageShow);
    connect();
    const auth=s.auth.onAuthStateChange((_event:AuthChangeEvent,session:Session|null)=>{if(!session)current=false});
    return()=>{current=false;removeEventListener("pagehide",onPageHide);removeEventListener("pageshow",onPageShow);disconnect();auth.data.subscription.unsubscribe()};
  },[requestId,initial,merge]);
  async function send(){if(!body.trim())return;setState("Отправка…");const nonce=crypto.randomUUID(),s=browserSupabase();const {data,error}=await s.rpc("send_message",{case_id:requestId,message_body:body.trim(),message_nonce:nonce});const parsed=messageSchema.safeParse(data);if(error||!parsed.success){setState("Не отправлено. Повторите попытку.");return}merge([parsed.data]);setBody("");setState("")}
  return <div className="card"><h2>Приватный чат</h2><div aria-live="polite">{messages.map(m=><p key={m.id}><strong>{m.author_id===userId?"Вы":"Координатор"}:</strong> {m.body}</p>)}</div><label>Сообщение<textarea value={body} maxLength={4000} onChange={e=>setBody(e.target.value)}/></label><button className="btn" onClick={send}>Отправить</button> <span>{state}</span></div>
}
