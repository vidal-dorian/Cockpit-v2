---
steps:
  - agent: test-writer
    model: haiku
    does: "writes the failing acceptance tests from the criteria"
  - agent: developer
    model: sonnet
    does: "implements until the tests pass, without touching them"
---
