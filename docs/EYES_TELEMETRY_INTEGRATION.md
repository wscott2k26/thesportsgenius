# Optional EyesOnYourAI instrumentation for Sports Genius

This is an opt-in, server-only integration with the EyesOnYourAI intelligence receiver. It is OFF unless EOYAI_METRICS_ENABLED=1 and valid EOYAI_ORIGIN/EOYAI_SOURCE_KEY environment variables are configured. Do not enable in production before EyesOnYourAI PR #72 is merged, deployed and its receiving endpoint verified.

- No new dependencies or paid resources.
- Default 5% sample of /api/ requests only, excluding Stripe webhooks. Request counts are sampled and must NOT be presented as total traffic or used for billing.
- Only numeric request_count, latency_ms and 5xx error_count are sent. No URL, cookies, customer identifiers, prompts, API response bodies or user content.
- Delivery failures never change the customer response. Revoke the source key in EyesOnYourAI to stop accepted ingestion.
- Sample rate: EOYAI_SAMPLE_RATE=0.05 by default, 0 < rate <= 1. Increase only after measuring ingest volume and quotas.
- Keep the source key in Railway environment variables; do not add it to .env.example with a value, frontend JS or the repository.
- After merge and explicit opt-in, test a synthetic API request, confirm only numeric metrics appear in the intended Eyes workspace, and disable on unexpected traffic/usage.

This branch is not a production deployment and does not change Stripe or subscriptions.
