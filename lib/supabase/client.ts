import { createBrowserClient } from "@supabase/ssr";
import { publicConfig } from "@/lib/config";
let client:ReturnType<typeof createBrowserClient>|undefined;
export function browserSupabase(){const {url,key}=publicConfig();return client??=createBrowserClient(url,key)}
