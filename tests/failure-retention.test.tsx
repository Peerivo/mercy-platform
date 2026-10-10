import React, { act, Component } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const action = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock('../app/help/actions', () => ({ createRequest: action }));
vi.mock('next/navigation', () => ({ useRouter: () => ({push}) }));
import { HelpForm } from '../app/help/help-form';
class Boundary extends Component<{children: React.ReactNode}, {error:boolean}> {
  state = {error:false};
  static getDerivedStateFromError(){return {error:true};}
  render(){return this.state.error ? <div data-error>Failed</div> : this.props.children;}
}
let host: HTMLDivElement, root: Root;
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,React});
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  action.mockReset();push.mockReset();
  await act(async()=>root.render(<Boundary><HelpForm/></Boundary>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function fill(){
  for (const [name,value] of Object.entries({country:'Грузия',city:'Синтетический город',description:'SYNTHETIC private description long enough',contact_window:'SYNTHETIC evening',external_contact:'synthetic@example.invalid'})) {
    const input=host.querySelector(`[name="${name}"]`) as HTMLInputElement;
    const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
  }
  for (const name of ['can_call','consent']) await act(async()=>{(host.querySelector(`[name="${name}"]`) as HTMLInputElement).click();});
  await act(async()=>{(host.querySelector('[name="can_message"]') as HTMLInputElement).click();});
  for (const [name,value] of Object.entries({category:'OTHER',urgency:'URGENT'})) await act(async()=>{const el=host.querySelector(`[name="${name}"]`) as HTMLSelectElement;el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});
}
function values(){return Array.from(host.querySelectorAll('input,textarea,select')).map(el=>{const e=el as HTMLInputElement;return [e.name,e.value,e.checked];});}
async function submit(){await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});}
test('returned save error retains typed fields and allows retry',async()=>{
 await fill();const before=values();action.mockResolvedValue({ok:false,message:'Safe error'});
 await submit();expect(values()).toEqual(before);expect(host.querySelector('[role="alert"]')!.textContent).toBe('Safe error');
 await submit();expect(action).toHaveBeenCalledTimes(2);expect(values()).toEqual(before);
});
test('rejected Server Action retains all fields and can retry',async()=>{
 await fill();expect(values().length).toBeGreaterThan(5);vi.spyOn(console,'error').mockImplementation(()=>{});
 const before=values();
 action.mockRejectedValue(new TypeError('Synthetic network failure'));
 await submit();expect(host.querySelector('[data-error]')).toBeNull();expect(values()).toEqual(before);
 action.mockResolvedValue({ok:false,message:'Safe error'});await submit();expect(values()).toEqual(before);expect(action).toHaveBeenCalledTimes(2);
});
test('second attempt submits identical fields after ordinary returned error',async()=>{
 await fill();action.mockResolvedValue({ok:false,message:'Safe error'});await submit();await submit();
 const first=action.mock.calls[0][1] as FormData;const second=action.mock.calls[1][1] as FormData;
 expect(first.get('consent')).toBe('on');expect(first.get('can_call')).toBe('on');expect(first.get('can_message')).toBeNull();
 expect(Array.from(second.entries())).toEqual(Array.from(first.entries()));
});
test('expired session retains draft, offers separate-tab login, and retries without persistence or telemetry',async()=>{
 const storage=vi.spyOn(Storage.prototype,'setItem');const error=vi.spyOn(console,'error');const log=vi.spyOn(console,'log');
 await fill();const before=values();action.mockResolvedValue({ok:false,authRequired:true,message:'Sign in again'});await submit();
 expect(values()).toEqual(before);const link=host.querySelector('a[target="_blank"]');expect(link?.getAttribute('href')).toBe('/auth');expect(link?.getAttribute('rel')).toContain('noopener');
 action.mockResolvedValue({ok:false,message:'Safe error'});await submit();expect(values()).toEqual(before);
 expect(storage).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
});
test('successful result navigates to the saved request',async()=>{
 await fill();action.mockResolvedValue({ok:true,message:'',requestId:'synthetic-id'});await submit();expect(push).toHaveBeenCalledWith('/cabinet/requests/synthetic-id');expect(push).toHaveBeenCalledTimes(1);
});
test('uncertain transport outcome never auto-resubmits; retry requires explicit submit',async()=>{
 await fill();action.mockRejectedValue(new TypeError('Synthetic response lost after RPC'));
 await submit();await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
 expect(action).toHaveBeenCalledTimes(1);expect(push).not.toHaveBeenCalled();
 expect(host.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe('/cabinet');
 await submit();expect(action).toHaveBeenCalledTimes(2);
});
