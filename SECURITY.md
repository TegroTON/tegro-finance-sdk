# Security Policy

Thank you for taking the time to look into the security of this package. We treat security reports as a first-class contribution.

## Supported versions

We follow [Semantic Versioning](https://semver.org/). Security fixes land on the **latest minor of the current major**.

| Version | Status |
| ------- | ------ |
| `0.1.x` | ✅ Active — security fixes land here. |
| `< 0.1` | ❌ No support. Please upgrade. |

When `1.0.0` ships, the table is rewritten and grace windows reset.

## Reporting a vulnerability

**Please do not open public issues for security problems.**

Use **GitHub Private Vulnerability Reporting** instead:

1. Go to the [Security tab](https://github.com/TegroTON/tegro-finance-sdk/security/advisories/new) of this repository.
2. Click **Report a vulnerability**.
3. Fill in the form. Include reproduction steps and a proposed severity if you can — it speeds up triage.

The report stays private between you and the maintainers until a fix is published. If GitHub is unreachable to you, fall back to the contact details on the [TegroTON organization page](https://github.com/TegroTON).

## Threat model

This package ships **client-side library code** that reads a public DEX API and builds transaction payloads for a user's wallet to sign. It is **non-custodial**: it never holds, derives, or transmits a private key, and it does not sign anything. With that in mind, in-scope issues include:

- A built transaction that does not match what the user intended (wrong destination, wrong amount, missing slippage floor) due to an SDK mapping bug.
- Amount-conversion bugs that lose or inflate value (`toUnits` / `fromUnits` / `applySlippage`).
- Loss of integer precision on the wire (BigInt serialization).
- The TON Connect adapter mangling or dropping a payload.
- Dependency vulnerabilities reachable from the published `dist/` output.
- Documentation that demonstrably leads a careful integrator into an unsafe configuration (e.g. trusting a server-supplied minimum without flooring it).

## Out of scope

- Vulnerabilities in the Tegro Finance backend, smart contracts, or the TON network itself — report those through the [Tegro Finance](https://tegro.finance) channels / contract security process.
- Vulnerabilities in a wallet's TON Connect implementation — report to the wallet vendor.
- Issues requiring an attacker to already control the consumer's process environment, secrets store, or DOM.
- DoS by sending the library extremely large payloads. Apply request limits at your HTTP layer.

## Response SLA

Best-effort, no contractual guarantee:

| Event | Target |
| --- | --- |
| Acknowledge receipt | within 72 hours |
| Triage decision (in-scope / not) | within 7 days |
| Fix or mitigation for a confirmed issue | within 30 days for High/Critical |
| Public advisory + patched release | coordinated with reporter |

## Coordinated disclosure

After a fix ships, a GitHub Security Advisory is published (with a CVE where applicable), the CHANGELOG references the advisory ID, and the reporter is credited unless they ask otherwise. If you have a disclosure deadline, tell us up front and we'll work to meet it.
