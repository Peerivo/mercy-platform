# Архитектура

Next.js App Router — UI/server actions; официальный `@supabase/ssr` проверяет пользователя через `auth.getUser()`. Обычный доступ идёт с JWT. PostgreSQL — источник истины; active row в `case_assignments` определяет единственного координатора. RLS проверяет владельца либо текущее назначение при каждом SELECT/INSERT, включая Realtime.

Контуры: public catalog; private case/chat/plan; staff administration through narrow RPC; immutable audit. Service role отсутствует в runtime. Rate limits сообщений и обращений транзакционно проверяются в БД. Multi-instance edge throttling/WAF остаётся deployment responsibility.

Mercy не содержит контур профессиональных или медицинских исполнителей, квалификационных документов, лицензирования, booking или marketplace. Эти задачи относятся к отдельному продукту и не должны расширять модель доступа Mercy.

Будущий `IdentityLink` связывает local user/external subject только после доказательства владения обоими аккаунтами и отдельного consent; email не доказательство. Связь отзываема. Обращения, беременность, семейный кризис, документы и чат никогда не переносятся в публичный Peerivo profile/reputation/AI twin. Peerivo protocol неизвестен — интеграция не реализована.

Будущий AI проходит единый controlled gateway, проверку consent, least privilege и human approval. AI Constitution/AI Critical — PLANNED, API не предполагается.
