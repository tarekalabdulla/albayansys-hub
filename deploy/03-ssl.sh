#!/usr/bin/env bash
# تركيب شهادة SSL مجانية من Let's Encrypt
# تأكد قبل التشغيل: A record لـ api.hulul-albayan.com يشير لـ 184.94.215.64
set -euo pipefail

DOMAIN="api.hulul-albayan.com"
EMAIL="admin@hulul-albayan.com"   # غيّره لبريدك

echo "→ التحقق من DNS..."
RESOLVED=$(dig +short A "$DOMAIN" | tail -n1)
EXPECTED="184.94.215.64"
if [[ "$RESOLVED" != "$EXPECTED" ]]; then
  echo "⚠️  DNS لـ $DOMAIN يشير إلى '$RESOLVED' بدلاً من '$EXPECTED'"
  echo "   أضف A record عند مزود الدومين قبل المتابعة. اكتب YES للمتابعة على أي حال."
  read -r CONF
  [[ "$CONF" == "YES" ]] || exit 1
fi

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "✅ SSL جاهز. اختبر:  curl https://$DOMAIN/api/health"
