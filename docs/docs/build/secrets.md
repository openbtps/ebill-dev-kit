---
title: Rotate secrets
---

# Rotate secrets

Your app has two secrets, each shown once when it is made:

- the **client secret**, which your server sends with its client id to trade a code or a refresh token;
- the **webhook secret**, which signs every delivery.

Either can be rotated without a moment when your app stops working, because two work at once while you change over.

## Rotating

1. In the developer portal, on your app, choose **Make a new one** for the secret. It is shown once. The old one still works.
2. Put the new one in your server.
   - For the webhook secret, accept both while you change over: deliveries are signed with each secret in force.

     ```ts
     verifyWebhook({ rawBody, signatureHeader, deliveryHeader, secret: [current, next] });
     ```

3. Once every instance of your server has the new one, choose **Retire the older one**.

Keep secrets out of your code and your repository: read them from your server's environment or secret store.
