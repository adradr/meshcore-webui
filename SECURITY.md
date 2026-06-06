# Security Policy

## Reporting a Vulnerability

Please email **[OPERATOR-PROVIDED-EMAIL]** with the details. Do not open a public GitHub issue for security-impacting reports.

A useful report includes:
- Description and impact.
- Steps to reproduce or a proof of concept.
- Suggested mitigation (optional).

Acknowledgement: within 72 hours. Status updates every 7 days until resolution.

## Supported Versions

Only the latest tagged release published as `:latest` (manually promoted from a `:sha-<commit>` build) is supported. Operators tracking the `:edge` tag are running pre-release builds and should expect breakage.

## Hardening Checklist

See the **Public-internet hardening checklist** section of [README.md](README.md).

## Verifying Image Integrity

All images are signed with [cosign](https://github.com/sigstore/cosign) via GitHub Actions OIDC. Verify before deploying:

```bash
cosign verify ghcr.io/adradr/meshcore-webui:<tag> \
  --certificate-identity-regexp '^https://github\.com/adradr/meshcore-webui/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

Build provenance (SLSA v1) and SBOM attestations are also published. Inspect with:

```bash
cosign verify-attestation --type spdxjson \
  ghcr.io/adradr/meshcore-webui:<tag> \
  --certificate-identity-regexp '^https://github\.com/adradr/meshcore-webui/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

## Scope

- Container image and source: in scope.
- The `meshcore` device firmware: out of scope (upstream — file with [meshcore-dev](https://github.com/meshcore-dev/MeshCore)).
- Operator misconfiguration (no API key on a public-internet deployment, world-readable secrets, etc.): documented in the hardening checklist; reports against these conditions will be triaged as "documentation gap" rather than vulnerability.
