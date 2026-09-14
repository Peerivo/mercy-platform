"use server";
import {revalidatePath} from "next/cache";
import {serverSupabase} from "@/lib/supabase/server";
import {assignmentSchema,caseStatusSchema} from "@/lib/validation";
export type StaffActionState={ok:boolean;message:string};
const initialError=(message:string):StaffActionState=>({ok:false,message});
export async function assignCase(_:StaffActionState,fd:FormData):Promise<StaffActionState>{
 const parsed=assignmentSchema.safeParse({caseId:fd.get("caseId"),coordinatorId:fd.get("coordinatorId"),currentCoordinatorId:fd.get("currentCoordinatorId")??"",reason:fd.get("reason")});
 if(!parsed.success)return initialError("Проверьте координатора и основание (не менее 3 символов).");
 const s=await serverSupabase();const {data:{user}}=await s.auth.getUser();if(!user)return initialError("Сессия завершена. Войдите снова.");
 const {error}=await s.rpc("assign_case",{case_id:parsed.data.caseId,new_coordinator:parsed.data.coordinatorId,reason_text:parsed.data.reason});
 if(error)return initialError("Назначение не сохранено. Обновите очередь и повторите попытку.");
 revalidatePath("/staff/cases");revalidatePath("/cabinet");return {ok:true,message:"Назначение сохранено."};
}
export async function changeCaseStatus(_:StaffActionState,fd:FormData):Promise<StaffActionState>{
 const parsed=caseStatusSchema.safeParse({caseId:fd.get("caseId"),status:fd.get("status")});if(!parsed.success)return initialError("Выберите допустимый статус.");
 const s=await serverSupabase();const {data:{user}}=await s.auth.getUser();if(!user)return initialError("Сессия завершена. Войдите снова.");
 const {error}=await s.rpc("change_case_status",{case_id:parsed.data.caseId,new_status:parsed.data.status});if(error)return initialError("Статус не изменён: переход недоступен или доступ отозван.");
 revalidatePath(`/cabinet/requests/${parsed.data.caseId}`);revalidatePath("/staff/cases");return {ok:true,message:"Статус изменён."};
}
