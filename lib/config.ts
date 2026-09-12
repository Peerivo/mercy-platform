import { z } from "zod";
const schema=z.object({url:z.string().url(),key:z.string().min(20)});
export function publicConfig(){const result=schema.safeParse({url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY});if(!result.success)throw new Error("Не настроено подключение Supabase: задайте NEXT_PUBLIC_SUPABASE_URL и publishable key до сборки.");return result.data}
