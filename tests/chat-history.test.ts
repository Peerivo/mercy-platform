import {describe,expect,it} from "vitest";
import {CHAT_PAGE_SIZE,ChatMessage,compareMessages,drainChatHistory} from "../lib/chat-history";

const message=(number:number,created_at=`2026-01-01T00:00:${String(number).padStart(2,"0")}.000Z`):ChatMessage=>({
  id:`00000000-0000-4000-8000-${String(number).padStart(12,"0")}`,
  body:`message ${number}`,
  created_at,
  author_id:"00000000-0000-4000-8000-000000000999",
  client_nonce:`10000000-0000-4000-8000-${String(number).padStart(12,"0")}`,
});

describe("chat history catch-up",()=>{
  it("loads every page by the created_at/id cursor and merges a Realtime arrival without gaps or duplicates",async()=>{
    const timestamp="2026-01-01T00:00:00.000Z";
    const history=Array.from({length:CHAT_PAGE_SIZE+5},(_,index)=>message(index,timestamp));
    const realtime=message(999,"2026-01-02T00:00:00.000Z");
    let combined:ChatMessage[]=[];
    let calls=0;
    const merge=(rows:ChatMessage[])=>{combined=Array.from(new Map([...combined,...rows].map(row=>[row.id,row])).values()).sort(compareMessages)};
    await drainChatHistory({isCurrent:()=>true,acceptPage:rows=>{merge(rows);if(calls===1)merge([realtime])},loadPage:async cursor=>{
      calls++;
      return history.filter(row=>!cursor||compareMessages(row,cursor)>0).slice(0,CHAT_PAGE_SIZE);
    }});
    expect(calls).toBe(2);
    expect(combined).toHaveLength(history.length+1);
    expect(new Set(combined.map(row=>row.id)).size).toBe(combined.length);
    expect(history.every(row=>combined.some(result=>result.id===row.id))).toBe(true);
  });

  it("does not apply a response after its request is no longer current",async()=>{
    let current=true;
    let release!:()=>void;
    const waiting=new Promise<void>(resolve=>{release=resolve});
    const accepted:ChatMessage[]=[];
    const work=drainChatHistory({isCurrent:()=>current,acceptPage:rows=>accepted.push(...rows),loadPage:async()=>{await waiting;return[message(1)]}});
    current=false;release();await work;
    expect(accepted).toEqual([]);
  });
});
