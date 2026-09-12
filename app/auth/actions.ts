"use server";
import { redirect } from "next/navigation";import { z } from "zod";import { serverSupabase } from "@/lib/supabase/server";
const creds=z.object({email:z.email(),password:z.string().min(10).max(128)});
export async function signIn(fd:FormData){const x=creds.parse(Object.fromEntries(fd));const s=await serverSupabase();const {error}=await s.auth.signInWithPassword(x);if(error)redirect("/auth?error=signin");redirect("/cabinet")}
export async function signUp(fd:FormData){const x=creds.parse(Object.fromEntries(fd));const s=await serverSupabase();const origin=process.env.NEXT_PUBLIC_SITE_URL||"http://localhost:3000";const {error}=await s.auth.signUp({...x,options:{emailRedirectTo:`${origin}/auth/callback`}});if(error)redirect("/auth?error=signup");redirect("/auth?check=email")}
export async function reset(fd:FormData){const email=z.email().parse(fd.get("email"));const s=await serverSupabase();await s.auth.resetPasswordForEmail(email,{redirectTo:`${process.env.NEXT_PUBLIC_SITE_URL||"http://localhost:3000"}/auth/callback?next=/auth/update-password`});redirect("/auth?check=reset")}
export async function signOut(){const s=await serverSupabase();await s.auth.signOut();redirect("/")}
