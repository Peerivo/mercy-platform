import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicConfig } from "@/lib/config";
export async function serverSupabase(){const jar=await cookies(),{url,key}=publicConfig();return createServerClient(url,key,{cookies:{getAll:()=>jar.getAll(),setAll(items){try{items.forEach(({name,value,options})=>jar.set(name,value,options))}catch{/* Server Component; middleware refreshes cookies. */}}}})}
