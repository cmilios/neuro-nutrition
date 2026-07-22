# Record per-user AI usage in a durable ledger

AI provider calls will be attributed to the authenticated user in immutable AI Usage Records containing measured token usage, model, outcome, provider identifiers, and the cost estimate applicable at the time. A database-backed ledger was chosen over diagnostic logs because per-user billing must remain queryable after logs expire; server logs remain limited to non-sensitive operational diagnostics.
