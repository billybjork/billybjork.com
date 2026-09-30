#!/usr/bin/env bash
# Print Railway's view of each custom domain on the linked service: the DNS
# records it requires (traffic target and, until verified, the ownership TXT),
# whether they have propagated, and the certificate status. Needs a logged-in,
# linked Railway CLI (`railway login`, `railway link`).
set -euo pipefail

query='query($id: String!, $project: String!) {
  customDomain(id: $id, projectId: $project) {
    domain
    status {
      certificateStatus verified verificationDnsHost verificationToken
      dnsRecords { fqdn recordType requiredValue status }
    }
  }
}'

status=$(railway status --json)
project_id=$(jq -r '.id' <<<"$status")
token=$(jq -r '.user.accessToken // .user.token' ~/.railway/config.json)

for id in $(jq -r '.environments.edges[].node.serviceInstances.edges[].node.domains.customDomains[].id' <<<"$status"); do
  jq -nc --arg q "$query" --arg id "$id" --arg p "$project_id" \
    '{query: $q, variables: {id: $id, project: $p}}' |
    curl -sS --data-binary @- https://backboard.railway.com/graphql/v2 \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/json' |
    jq -r '.data.customDomain as $d | $d.status as $s
      | "\($d.domain)  cert=\($s.certificateStatus | sub("CERTIFICATE_STATUS_TYPE_"; ""))",
        ($s.dnsRecords[] | "  \(.recordType | sub("DNS_RECORD_TYPE_"; "")) \(.fqdn) -> \(.requiredValue)  [\(.status | sub("DNS_RECORD_STATUS_"; ""))]"),
        (if $s.verified == false and ($s.verificationDnsHost // "") != ""
         then "  TXT \($s.verificationDnsHost) -> \($s.verificationToken)  [UNVERIFIED]" else empty end)'
done
