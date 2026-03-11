#!/bin/sh
# Resolve the container's actual DNS nameserver at startup and inject it
# into nginx.conf so nginx can re-resolve Railway private hostnames
# (api.railway.internal) without caching stale IPs across service restarts.
#
# Railway uses IPv6 DNS (e.g. fd12::10) — nginx requires IPv6 addresses
# to be wrapped in brackets: [fd12::10]

NS=$(grep -m1 nameserver /etc/resolv.conf | awk '{print $2}')
if [ -z "$NS" ]; then
  echo "WARN: Could not read nameserver from /etc/resolv.conf, defaulting to 8.8.8.8"
  NS="8.8.8.8"
fi

# Wrap IPv6 addresses in brackets for nginx resolver directive
if echo "$NS" | grep -q ':'; then
  NS="[$NS]"
fi

echo "INFO: Using DNS resolver: $NS"
sed -i "s|__DNS_RESOLVER__|$NS|g" /etc/nginx/conf.d/default.conf

exec nginx -g "daemon off;"
