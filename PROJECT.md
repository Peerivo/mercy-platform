# mercy-platform — CURRENT

## Назначение и границы
«Язык милосердия» — русскоязычная платформа добровольной поддержки материнства, семьи и людей в кризисе: приватное обращение, назначенный координатор, чат, совместный план и проверенный каталог. Это не медицинская организация и не 24/7 экстренная служба. Помощь не зависит от решения человека или участия в религиозной поддержке; опасные отношения не предлагается сохранять.

## Инфраструктура
Модульный монолит Next.js 16 / React 19, Supabase Auth/PostgreSQL/PostGIS/Realtime, SQL-only migrations, Docker. Production Supabase внешний; секретов в репозитории нет. Remote migrations intentionally not applied.

## IMPLEMENTED
Публичная главная, каталог/гео-RPC, Auth flows, приватная форма обращения, кабинет, история/Realtime чат с RPC-idempotency, просмотр плана, предложение помощи, быстрый выход с BFCache guard; строгая схема, RLS/grants, assignment/status/staff-role RPC, audit, consent and IdentityLink contract; CI, controlled migration deployment, docs and Docker. Disposable Supabase harness воспроизводит схему и запускает pgTAP, настоящие Auth/API/Realtime и минимальные Chromium-сценарии без облачных credentials.

## IN_PROGRESS
Полный браузерный UI рабочего места администратора/координатора остаётся в работе. Новый integration suite должен быть фактически подтверждён GitHub-hosted runner с Docker; текущая среда без Docker не является таким подтверждением.

## PLANNED
Организационные кабинеты, guest access, модерируемая взаимопомощь, группы, безопасные вложения/видео, уведомления, локализации, пожертвования и отдельно согласованные Peerivo/AI integrations. См. `docs/ROADMAP.md`.

## Следующее действие
Владелец запускает CI последнего SHA и подтверждает зелёный `supabase-integration`; затем реализуется staff UI. Облачный staging и bootstrap первого администратора нужны позднее для операционной приёмки, не для этого disposable набора.
