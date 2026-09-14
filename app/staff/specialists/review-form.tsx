"use client";

import {useState} from "react";
import {reviewSpecialist} from "./actions";

type ReviewFormProps = {
  id: string;
  publicationStatus: string;
  qualificationStatus: string;
};

export function ReviewForm({id, publicationStatus, qualificationStatus}: ReviewFormProps) {
  const publishedVerified = publicationStatus === "PUBLISHED" && qualificationStatus === "VERIFIED";
  const [publication, setPublication] = useState(publicationStatus === "PUBLISHED" ? "BLOCKED" : "PUBLISHED");
  const [qualification, setQualification] = useState(qualificationStatus);

  return <form action={reviewSpecialist} className="grid">
    <input type="hidden" name="id" value={id}/>
    <label>Публикация<select name="publication" value={publication} onChange={event => {
      const next = event.target.value;
      setPublication(next);
      if (publishedVerified) setQualification(next === "PENDING" ? "PENDING" : qualificationStatus);
    }}>
      {publicationStatus === "PENDING" && <><option value="PUBLISHED">Опубликовать</option><option value="REJECTED">Отклонить</option></>}
      <option value="BLOCKED">Заблокировать</option>
      {publishedVerified && <option value="PENDING">Снять публикацию и проверить повторно</option>}
    </select></label>
    <label>Квалификация<select name="qualification" value={qualification} onChange={event => setQualification(event.target.value)}>
      <option value="UNVERIFIED">Не подтверждена</option>
      <option value="PENDING">Проверяется</option>
      <option value="VERIFIED">Подтверждена</option>
      <option value="REJECTED">Отклонена</option>
    </select></label>
    <label>Основание<textarea name="reason" required minLength={3} maxLength={500}/></label>
    <button className="btn">Сохранить решение</button>
  </form>;
}
