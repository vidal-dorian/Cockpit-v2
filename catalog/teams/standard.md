---
steps:
  - agent: test-writer
    model: sonnet
    does: "writes the failing acceptance tests from the criteria"
  - agent: developer
    model: sonnet
    does: "implements until the tests pass, without touching them"
  - agent: reviewer
    model: opus
    does: "reviews the diff with a fresh context"
    loop_to: developer
    until: "the verdict is ready"
---
