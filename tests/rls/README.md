# Row-level security tests

The executable pgTAP suite lives at `supabase/tests/database/rls.test.sql`, the
location recognized by the Supabase CLI. It creates two transaction-scoped test
users and proves that reads, writes, updates, and collection membership cannot
cross the owner boundary. The transaction is rolled back.

Run it against the local Supabase stack:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

The test requires Docker because the Supabase CLI starts an isolated local
Postgres stack. It never connects to the linked production project.
