# Приватность и доступ

Автор видит только свои обращения; координатор — только активное назначение. ADMIN видит очередь с минимальными метаданными и получает content только через явное назначение, записанное в audit. Reassignment/revoke немедленно закрывает новый DB/API/Realtime access; уже прочитанное на чужом устройстве удалить нельзя. Role/user/owner/author/service fields закрыты column grants и RPC.

Псевдоним допустим; email остаётся в Auth. Телефон, имя, адрес не обязательны. External contact and future integration consents отдельны от required request-processing consent and revocable. Логи/audit не включают тексты, контакты, email и visitor coordinates. Нет trackers/session replay/offline private cache. Private routes get `no-store/noindex`.

В публичном каталоге специалистов доступны только строки `PUBLISHED` и выбранные профессиональные поля; контакт появляется лишь при `show_contacts`. Черновик, отклонённая/заблокированная анкета и квалификационные документы закрыты также при прямом запросе. Bucket документов приватный; чтение разрешено владельцу пути и ADMIN. Публичный экспорт не содержит документы и их пути.

Quick exit синхронно очищает local/session storage и делает `location.replace('/safe')`; network logout не задерживает уход. Neutral page предупреждает об истории браузера. Back/BFCache проверяется дополнительно при browser acceptance.

Deletion request — заявка администратору, не свершившееся удаление. До реального запуска владелец утверждает jurisdiction-specific retention/SLA. Удаление выполняется проверенным runbook; encrypted backups истекают по backup lifecycle, мгновенное selective deletion не обещается.

Предложения добровольцев не публикуются. Владелец видит только свои строки; ADMIN получает приватное содержание и контакт только в отдельной moderation queue. Создание атомарно связывает owner из JWT и отдельное согласие; клиент не может подставить owner/review status. Решение ADMIN ограничено переходом PENDING → VERIFIED/REJECTED и журналируется без текста предложения или контакта. Статус помощника не связан с `staff_roles` и не открывает обращения, сообщения или назначения.
