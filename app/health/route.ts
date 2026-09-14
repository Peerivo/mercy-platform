import {NextResponse} from "next/server";import {releaseInfo} from "@/lib/release-info";
export const dynamic="force-dynamic";
export function GET(){return NextResponse.json(releaseInfo(),{headers:{"Cache-Control":"no-store"}})}
