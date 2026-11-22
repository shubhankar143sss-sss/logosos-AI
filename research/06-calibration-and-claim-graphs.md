# 06 Calibration and claim graphs

Two related ideas, one small and one large.

## CSE: Calibrated Stability Engine (small, start here)

A reasoning engine for **one domain** (the example is economics) that:

1. collects structured signals,
2. produces claims with a probability, e.g. "recession probability rising",
3. runs perturbations and Monte Carlo variations to test whether the claim is stable,
4. records what actually happened,
5. updates confidence and tracks calibration (when it says 70%, is it right about 70% of the time?),
6. reports an instability index.

Goal: reduce surprise and measure how well-calibrated the system is. This is testable: forecasts and outcomes are logged, and calibration can be plotted. A reasonable first project is a single-domain forecaster scored with a proper scoring rule such as the Brier score.

## SCKCN: Self-Correcting Knowledge Network (large, speculative)

A shared graph of atomic claims, each with sources and confidence; confidence evolves as evidence arrives; a monitor flags dense clusters of contradiction; corrections propagate.

This resembles knowledge graphs and fact-checking systems that exist. The hard parts are incentives, governance and abuse resistance, not the data structure. Treat it as a long-term research direction, not a product plan.

## Takeaway

Calibration is the practical piece: any system that makes claims or predictions should measure how often it is right and show that number. This also gives the kernel a principled "act only if confidence is high enough" rule.
