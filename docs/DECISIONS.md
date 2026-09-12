# Решения

1. SQL без ORM: Supabase/PostGIS/RLS/RPC требуют проверяемого SQL, второй schema source исключён.
2. PostgreSQL + Realtime, без Redis/LLM: MVP не имеет подтверждённой нагрузки/интеграции.
3. User JWT + RLS; SECURITY DEFINER только для bounded RPC/helpers с пустым search_path и закрытым EXECUTE.
4. Каталог публичен лишь после organization+location verification; shelter geometry невозможна constraint-ом.
5. Геолокация передаётся прямо RPC и не сохраняется. Расстояние — по прямой.
6. Email confirmation не отключается; настройки зависят от среды.
7. NEXT_PUBLIC config — build-time contract; missing runtime config fails explicitly, no mocks.
