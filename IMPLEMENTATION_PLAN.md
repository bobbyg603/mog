# Implementation Plan for #2

- [x] Add a Docker Desktop version requirement note to the Prerequisites section clarifying that Docker Desktop must include `docker sandbox` support (available in Docker Desktop 4.40+)
- [x] Add a verification step to the Quick Start section recommending users run `docker sandbox ls` before first use to confirm sandbox support is available
- [x] Add troubleshooting entries for "Docker sandbox state is stale" (restart Docker Desktop or run `docker sandbox rm mog && mog init`) and "docker: 'sandbox' is not a docker command" (update Docker Desktop to a version that supports `docker sandbox`)
