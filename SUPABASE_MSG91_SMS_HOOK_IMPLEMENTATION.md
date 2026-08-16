# Supabase → MSG91 Send SMS Hook

1. **Endpoint:** `POST /auth/send-sms-hook`

2. **Required environment variables:**
   - `SUPABASE_SEND_SMS_HOOK_SECRET` — exact Supabase-generated value in `v1,whsec_<base64-secret>` format
   - `MSG91_AUTH_KEY`
   - `MSG91_SMS_TEMPLATE_ID`
   - `MSG91_OTP_VARIABLE` — optional; defaults to `VAR1`

3. **Expected Supabase payload:**

   ```json
   {"user":{"phone":"E164_PHONE_PLACEHOLDER"},"sms":{"otp":"OTP_PLACEHOLDER"}}
   ```

4. **MSG91 API:** `POST https://control.msg91.com/api/v5/flow` with the configured template, the phone normalized to international digits, and the exact Supabase OTP placed in the configured template variable.

5. **Signature verification:** The endpoint reads at most 20 KB as an unchanged raw body. `standardwebhooks@1.0.0` verifies the `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers (including timestamp tolerance) using the Supabase hook secret before the payload is parsed or used.

6. **Placeholder curl:** Replace every placeholder with values produced by a Standard Webhooks-compatible testing tool. The signature must cover the exact body bytes shown.

   ```bash
   curl --request POST "https://YOUR_RENDER_HOST/auth/send-sms-hook" \
     --header "content-type: application/json" \
     --header "webhook-id: msg_PLACEHOLDER" \
     --header "webhook-timestamp: UNIX_TIMESTAMP_PLACEHOLDER" \
     --header "webhook-signature: v1,SIGNATURE_PLACEHOLDER" \
     --data-raw '{"user":{"phone":"E164_PHONE_PLACEHOLDER"},"sms":{"otp":"OTP_PLACEHOLDER"}}'
   ```

7. **Status codes:** `200` means MSG91 accepted the request (or the same verified webhook ID was already accepted); `400` means the verified payload is invalid; `401` means signature verification failed; `413` means the body exceeded 20 KB; `500` means server configuration is unavailable; `502` means MSG91, the network, or the provider timeout failed.
