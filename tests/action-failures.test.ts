import { expect, test, vi, beforeEach } from 'vitest';
const mock=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),redirect:vi.fn((url:string)=>{throw new Error('REDIRECT:'+url)})}));
vi.mock('@/lib/supabase/server',()=>({serverSupabase:async()=>({auth:{getUser:mock.auth},rpc:mock.rpc})}));
vi.mock('next/navigation',()=>({redirect:mock.redirect}));
import { createRequest } from '../app/help/actions';
const initial={ok:false,message:''};
function form(){const f=new FormData();for(const [k,v]of Object.entries({category:'OTHER',country:'Россия',city:'Test',description:'SYNTHETIC private description',urgency:'NORMAL',consent:'on'}))f.set(k,v);return f;}
beforeEach(()=>{vi.clearAllMocks();mock.auth.mockResolvedValue({data:{user:{id:'synthetic'}}});});
test('normal RPC error returns only safe feedback',async()=>{mock.rpc.mockResolvedValue({data:null,error:{message:'SYNTHETIC secret'}});expect(JSON.stringify(await createRequest(initial,form()))).not.toContain('SYNTHETIC');});
test('thrown RPC/network error returns safe result',async()=>{mock.rpc.mockRejectedValue(new TypeError('SYNTHETIC network'));const result=await createRequest(initial,form());expect(result.ok).toBe(false);expect(JSON.stringify(result)).not.toContain('SYNTHETIC');});
test('expired session returns auth-required without redirect or RPC',async()=>{mock.auth.mockResolvedValue({data:{user:null}});expect(await createRequest(initial,form())).toMatchObject({ok:false,authRequired:true});expect(mock.rpc).not.toHaveBeenCalled();expect(mock.redirect).not.toHaveBeenCalled();});
test('auth transport exception returns safe feedback',async()=>{mock.auth.mockRejectedValue(new TypeError('SYNTHETIC auth failure'));expect(JSON.stringify(await createRequest(initial,form()))).not.toContain('SYNTHETIC');});
test('success returns only saved id for navigation',async()=>{mock.rpc.mockResolvedValue({data:'synthetic-id',error:null});expect(await createRequest(initial,form())).toEqual({ok:true,message:'',requestId:'synthetic-id'});});
