#!/bin/bash
# Usage: ./cron_marketing.sh <job_name> [site]
#
# job_name  — the cron job to trigger (blog_publish, social_publish, facebook_publish, etc.)
# site      — optional, defaults to 'ls' (LitigationSpace)
#             pass 'bc' to run Build Champions jobs once BC credentials are configured
#
# Examples:
#   ./cron_marketing.sh blog_publish          # LitigationSpace blog (default)
#   ./cron_marketing.sh social_publish        # LitigationSpace social (default)
#   ./cron_marketing.sh facebook_publish      # LitigationSpace Facebook (default)
#   ./cron_marketing.sh blog_publish bc       # Build Champions blog
#   ./cron_marketing.sh social_publish bc     # Build Champions social
#   ./cron_marketing.sh facebook_publish bc   # Build Champions Facebook

BASE="http://127.0.0.1:8000/api/growth/cron/trigger"
SECRET="ls-cron-2026"
JOB="$1"
SITE="${2:-ls}"

if [ -z "$JOB" ]; then
  echo "Usage: $0 <job_name> [site]"
  echo "  site defaults to 'ls' if not provided"
  exit 1
fi

curl -s -X POST "${BASE}/${JOB}?secret=${SECRET}&site=${SITE}" \
  -H "Content-Type: application/json" \
  >> /var/log/litigationspace-cron.log 2>&1
echo "" >> /var/log/litigationspace-cron.log
