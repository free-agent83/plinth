# Dependency posture

`npm audit` on this repository reports **9 advisories: 6 moderate, 3 high**, and
that number is deliberate rather than neglected. This file says which ones,
why they are still here, and what would have to happen to clear them.

A clean audit badge is easy to buy by upgrading something that then breaks, and
harder to justify than an explained one.

## What is left, and why

Every remaining advisory comes from three transitive packages, all of them
build-time tooling. None of them reach a browser, and none of them process
anything but this repository's own files.

| Package | Class | Reached through | Why it stays |
|---|---|---|---|
| `brace-expansion` | Denial of service, unbounded intermediate arrays | Nx's glob matching | No fixed version is reachable from any Nx release yet. It parses glob patterns written in this repository. |
| `js-yaml` | Quadratic CPU on `!!omap` | Storybook tooling | Fix not backported to the major this toolchain pins. It parses configuration authored in this repository. |
| `uuid` | Missing buffer bounds check in v3/v5/v6 | `@storybook/test-runner` → `jest-playwright-preset` | See below: the only fix is a two-major Storybook upgrade. |

All three are resource-exhaustion issues that require hostile input. The input
here is the repository's own globs, config and stories, so the attack requires
someone who can already commit to the repository, at which point a slow glob is
not the interesting problem.

## What was fixed

Two advisories were closed by patch bumps within the same major version, so no
behaviour changed:

- `next` 16.2.10 → 16.3.0
- `nx` 22.7.6 → 22.7.8

That took the count from 14 to 9.

## The one that is not worth fixing yet

`@storybook/test-runner@0.21.3` carries the `uuid` and part of the `js-yaml`
exposure. The fixed line, 0.24.x, declares a peer dependency on **Storybook 10**;
this repository is on Storybook 8.6.

So clearing that advisory is not a dependency bump, it is a two-major Storybook
upgrade: every story file, the addon set, and `.storybook/` configuration. That
is a real piece of work with a real chance of breaking the component
documentation, traded against a bounds check in a package that runs only when
somebody executes the Storybook test runner locally.

It is worth doing on its own terms, as part of keeping the toolchain current.
It is not worth doing as a security fix, and pretending otherwise would be the
wrong reason to make a risky change.

## How this is checked

`.github/workflows/ci.yml` runs `npm audit --audit-level=critical` on every push
and pull request as an **advisory** job: it reports, it does not block.

The threshold is `critical` rather than `high` on purpose. The nine advisories
above are known and accounted for, so failing on `high` would paint this job red
on every run forever, for things already understood. That is the check nobody
reads, and a permanently red job teaches people to ignore the one run that
actually matters. `critical` is the level not already explained here, so a
failure means something new arrived and someone should look.

There are no critical advisories today. A change in the numbers above should
prompt a decision and an update to this file, not an automatic merge block.

## Scope

This is a reference design system, MIT licensed. It is not deployed, holds
no data, has no users and no runtime services, so the classes of risk that
matter for a production system (authentication, secrets handling, data
exposure) do not arise. What is in scope is the supply chain of a package a
consuming team would install, and that is what the table above accounts for.
