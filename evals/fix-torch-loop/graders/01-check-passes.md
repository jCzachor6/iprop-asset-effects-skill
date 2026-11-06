---
type: llm
focus: trace
weight: 1
---

torch/torch.ips still declares size 64x96 and origin 32,90, and the last check-fx run on it printed PASS, with no seam warning and no failure.
