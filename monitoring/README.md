# Deploy payment alerts

The code logs sanitized security events. Logging alone does not send alerts.
Choose an approved Cloud Monitoring notification channel in your own project.
No alert or message has been sent by this implementation.

```bash
gcloud logging metrics create mlmlive_payment_security --description="MLMLIVE payment verification, webhook and recovery failures" --log-filter='severity>=WARNING AND (jsonPayload.message="payment_verification_denied" OR jsonPayload.message="payment_webhook_bad_signature" OR jsonPayload.message="payment_reconcile_failed" OR jsonPayload.message="payment_webhook_processing_failed")'
```

Put the full notification channel resource name into
`payment-alert-policy.json.notificationChannels`, then create the policy:

```bash
gcloud monitoring policies create --policy-from-file=monitoring/payment-alert-policy.json
```

Run a test invalid signature against staging and confirm the log metric and
notification arrive. Set a suitable threshold for your real traffic. Also set
provider failed-payment/dispute notifications and monitor `creation_unknown`
and `needsReview` purchases in Admin.
