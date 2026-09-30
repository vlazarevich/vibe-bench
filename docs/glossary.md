# Domain terminology

These names describe the engineering model. Executable schemas become authoritative as the corresponding code is implemented.

| Term | Meaning |
| --- | --- |
| Suite | A named collection of task definitions and evaluation configuration |
| Suite revision | A user-designated version label |
| Content version | An immutable stored suite definition beneath a revision |
| Task | Prompt, inputs, execution limits, expected outputs, and evaluation configuration |
| Entrant | The harness, model, settings, permissions, and available version information being evaluated |
| Runtime | A machine with installed tools and execution capacity |
| Run | Execution against an immutable snapshot of selected inputs and settings |
| Attempt slot | A run/task/entrant combination grouping its attempts |
| Attempt | One execution, with a new identity for a retry or re-execution |
| Assignment | A runtime's authority to execute and report an attempt |
| Result | The task-declared artifacts produced by an attempt |
| Manifest | Metadata identifying an attempt's collected objects |
| Execution statistics | Observations with units and reported, estimated, or unavailable provenance |
| Evaluation session | One review context with persistent presentation mappings |
| Judgment | A saved human selection associated with a result and criterion |
| Grade | The numeric representation of a judgment under its saved configuration |

Product choices such as attempt inclusion, grade conversion, and aggregation come from the current requirements and must be encoded in the relevant implementation and tests.
