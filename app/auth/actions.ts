"use server";
import { redirect } from "next/navigation";import { z } from "zod";import { serverSupabase } from "@/lib/supabase/server";import {siteUrl} from "@/lib/config";
const creds=z.object({email:z.email(),password:z.string().min(10).max(128)});
export async function signIn(fd:FormData){const x=creds.parse(Object.fromEntries(fd));const s=await serverSupabase();const {error}=await s.auth.signInWithPassword(x);if(error)redirect("/auth?error=signin");redirect("/cabinet")}
export async function signUp(fd:FormData){const x=creds.parse(Object.fromEntries(fd));const s=await serverSupabase();const origin=siteUrl();const {error}=await s.auth.signUp({...x,options:{emailRedirectTo:`${origin}/auth/callback`}});if(error)redirect("/auth?error=signup");redirect("/auth?check=email")}
export async function reset(fd:FormData){const email=z.email().parse(fd.get("email"));const s=await serverSupabase();await s.auth.resetPasswordForEmail(email,{redirectTo:`${siteUrl()}/auth/callback?next=/auth/update-password`});redirect("/auth?check=reset")}
export async function updatePassword(fd:FormData){const password=z.string().min(10).max(128).parse(fd.get("password"));const s=await serverSupabase();const {data:{user}}=await s.auth.getUser();if(!user)redirect("/auth?error=session");const {error}=await s.auth.updateUser({password});if(error)redirect("/auth/update-password?error=update");redirect("/cabinet")}
export async function signOut(){const s=await serverSupabase();await s.auth.signOut();redirect("/")}
