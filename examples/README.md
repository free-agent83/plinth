# Example: a real assessment

`specimen-report.html` is an assessment of a real, third-party design system.
Open it in a browser.

## What it is

| | |
|---|---|
| **Subject** | [Plane](https://github.com/makeplane/plane), the open-source project management tool. The design system is `@plane/propel`, the component library its own product is built on. |
| **Commit assessed** | `a8e53b6ac7b87bd8e3e931d21188f7679c7ab6c4`, committed 2026-07-22 |
| **Assessed** | 2026-08-08 |
| **Result** | 4/5 across the three dimensions this instrument scores statically |

The commit is stated because the report is a photograph, not a verdict. It
describes that repository at that moment. Plane's team may well have changed
any of it since, and every number in the report can be checked against the
public repository at that commit by anyone who wants to.

Plane was chosen because it is the shape most organisations actually are: a
product company whose design system exists to serve its own application, built
by its own team under delivery pressure. It is not a public-infrastructure
design system with a dedicated platform team behind it, and the findings are
more useful for that.

## What it shows

The headline finding is that 492 raw HTML elements are used in places where a
system component already exists, which is 57.3% of every replaceable element in
the application. Alongside it: 35 components the application defines itself
under a name the design system already exports, and 306 hardcoded colour values
sitting next to a token layer that already has a token for them.

None of that is incompetence. It is what happens to a good design system under
normal delivery pressure, and it is the reason a team can have a design system
and still get inconsistent results out of it.

## Why three rows say "n/a"

Constraint, fidelity and completeness are not scored here.

Constraint and fidelity need a per-framework read of every component's API,
which is done as a deep audit of one system rather than a scan across many.
Completeness cannot be measured statically at all, because a gap only exists
relative to something someone actually tried to build, so it needs a live agent
run against the system.

The instrument reports `n/a` with its reason rather than guessing, and it never
renders "I could not measure this" as "you failed this". That property is
enforced by its test suite, not by good intentions.

## What produced it

The Correct by Design assessment, an internal command-line instrument that
reads a repository it has never seen before, with no configuration file and no
cooperation from the codebase. It is not included in this repository.

The report was generated before the instrument had its present name. Its label
was changed by hand on 2026-10-08, and nothing else in it was.
