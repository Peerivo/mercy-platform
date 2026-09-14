# Архитектура

Next.js App Router — UI/server actions; официальный `@supabase/ssr` проверяет пользователя через `auth.getUser()`. Обычный доступ идёт с JWT. PostgreSQL — источник истины; active row в `case_assignments` определяет единственного координатора. RLS проверяет владельца либо текущее назначение при каждом SELECT/INSERT, включая Realtime.

Контуры: public catalog; private case/chat/plan; staff administration through narrow RPC; immutable audit. Service role отсутствует в runtime. Rate limits сообщений и обращений транзакционно проверяются в БД. Multi-instance edge throttling/WAF остаётся deployment responsibility.

Каталог специалистов — отдельный Mercy-owned контур: Auth account, professional profile и Mercy qualification/publication assertions разделены. Владелец пишет профиль через узкий RPC с `auth.uid()`, ADMIN модерирует отдельным RPC, а анонимный поиск читает только опубликованную проекцию с лимитом и стабильной сортировкой.

Будущий `IdentityLink` связывает local user/provider/external subject только после доказательства владения обоими аккаунтами и отдельного consent; email не доказательство. Связь отзываема. Обращения, беременность, семейный кризис, документы и чат никогда не переносятся в публичный Peerivo profile/reputation/AI twin. Peerivo protocol неизвестен — интеграция не реализована.

Будущий AI проходит единый controlled gateway, проверку consent, least privilege и human approval. AI Constitution/AI Critical — PLANNED, API не предполагается.
