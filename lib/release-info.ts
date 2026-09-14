import {z} from "zod";
const revision=z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
export function releaseInfo(env:Record<string,string|undefined>=process.env){const candidate=env.VERCEL_GIT_COMMIT_SHA||env.RENDER_GIT_COMMIT||env.GIT_SHA||env.SOURCE_VERSION||"unknown";return {status:"ok" as const,environment:env.NODE_ENV||"development",version:revision.safeParse(candidate).success?candidate:"unknown"}}
