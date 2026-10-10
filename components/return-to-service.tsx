"use client";
import { useLocale } from "@/components/locale-provider";

import {useRouter} from "next/navigation";
export function ReturnToService(){
  const { t } = useLocale();
const router=useRouter();return <button className="btn" onClick={()=>{sessionStorage.removeItem("mercy_quick_exit");router.push("/")}}>{t("Вернуться в сервис")}</button>}
