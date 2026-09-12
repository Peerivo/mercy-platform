# mercy-platform — CURRENT

## Назначение и границы
«Язык милосердия» — русскоязычная платформа добровольной поддержки материнства, семьи и людей в кризисе: приватное обращение, назначенный координатор, чат, совместный план и проверенный каталог. Это не медицинская организация и не 24/7 экстренная служба. Помощь не зависит от решения человека или участия в религиозной поддержке; опасные отношения не предлагается сохранять.

## Инфраструктура
Модульный монолит Next.js 16 / React 19, Supabase Auth/PostgreSQL/PostGIS/Realtime, SQL-only migrations, Docker. Production Supabase внешний; секретов в репозитории нет. Remote migrations intentionally not applied.

## IMPLEMENTED
Публичная главная, каталог/гео-RPC, Auth flows, приватная форма обращения, кабинет, история/Realtime чат с idempotency, просмотр плана, предложение помощи, быстрый выход; строгая схема, RLS/grants, assignment/status RPC, audit, consent and IdentityLink contract; CI, controlled migration deployment, docs and Docker.

## IN_PROGRESS
Полный браузерный UI рабочего места администратора/координатора и полноценный Supabase integration suite требуют подключённого временного Docker/Supabase при приёмке.

## PLANNED
Организационные кабинеты, guest access, модерируемая взаимопомощь, группы, безопасные вложения/видео, уведомления, локализации, пожертвования и отдельно согласованные Peerivo/AI integrations. См. `docs/ROADMAP.md`.

## Следующее действие
Владелец создаёт staging Supabase, запускает CI migration/integration job, bootstrap первого администратора и проводит сценарий приёмки до подключения реальных пользователей.
