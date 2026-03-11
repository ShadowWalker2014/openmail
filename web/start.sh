#!/bin/sh
# Resolve the container's actual DNS nameserver at startup and inject it
# into nginx.conf so nginx can re-resolve Railway private hostnames
# (api.railway.internal) without caching stale IPs across service restarts.
#
# Railway containers use a non-Docker DNS (not 127.0.0.11) — the correct
# nameserver is in /etc/resolv.conf at runtime.

NS=$(grep -m1 nameserver /etc/resolv.conf | awk '{print $2}')
if [ -z "$NS" ]; then
  echo "WARN: Could not read nameserver from /etc/resolv.conf, defaulting to 8.8.8.8"
  NS="8.8.8.8"
fi

echo "INFO: Using DNS resolver: $NS"
sed -i "s|__DNS_RESOLVER__|$NS|g" /etc/nginx/conf.d/default.conf

exec nginx -g "daemon off;"
