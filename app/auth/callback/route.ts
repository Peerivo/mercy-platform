import {NextResponse} from "next/server";import {serverSupabase} from "@/lib/supabase/server";
export async function GET(req:Request){const u=new URL(req.url),code=u.searchParams.get("code"),next=u.searchParams.get("next")||"/cabinet";if(code){const s=await serverSupabase();await s.auth.exchangeCodeForSession(code)}return NextResponse.redirect(new URL(next,u.origin))}
