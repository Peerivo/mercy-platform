"use client";
import {useRouter} from "next/navigation";
export function ReturnToService(){const router=useRouter();return <button className="btn" onClick={()=>{sessionStorage.removeItem("mercy_quick_exit");router.push("/")}}>Вернуться в сервис</button>}
