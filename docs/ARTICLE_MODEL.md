# IMAS article model: methodology and implementation status

Version: `imas-article-1.0.0`. Development branch: `codex/imas-article-model-20261110`, based on `IMAS_LaB_test`.

## Separation and reproducibility

The existing `trust-js-2.10.0-remediation` model remains in `gui/src/trustEngine.js`. The new model is implemented in `gui/src/articleModel/` and `gui/src/articleEngine.js`. `trustWorker.js` dispatches only when `config.model === "article"`. No legacy mathematical functions are rewritten. Separate IndexedDB database `imas-article-model-v1` is used for new model results. The cache key includes the full validated configuration and the mathematical model version.

Independent keyed xorshift32 streams with Box-Muller are derived from (seed, run, subsystem, time, agent, observer). Pairwise attack/clean runs consume identical exogenous noise values even when isolation changes active sets. The code explicitly distinguishes the latent compromised identities from activation of adversarial behavior.

## Formulas and modules

| Reference | Implementation | Notes |
|---|---|---|
| (1)–(3), attacker §1.3 | `agents.js` | Vector x*, partial observations with missing coordinates, five strategies. |
| (8) | `quality.js` | Synthetic or computed quality c/s/g; synthetic q is an explicitly assumed experimental input. |
| (9), (11)–(13) | `trust.js` | D update only on active observed pairs; rho determined from previous-tick tau; excludes self and isolated agents. |
| (14), §3.4 | `isolation.js` | Confirmed threshold rule, optional nonnegative accumulation z; isolation events include cause and tick. |
| (15)–(16) | `choice.js` | Safe action selection, automatic/OP fallback; synthetic utilities; irreversible segment isolation excluded from auto. |
| (17)–(18) | `aggregation.js` | Norm clipping, four methods, explicit fallback to coordinate median when 2b >= active participants. |
| (19)–(21) | `resilience.js` | Four synthetic indicators, weighted J, paired ratio; Psi is **not** clipped at one. |

**Metric passport:** time steps are 0...T−1; an attack begins at t>=t_a; isolation latency is t_isolation−t_a+1 (only isolations during attacks). Errors are Euclidean vector norms, averaged over steps t>=t_a per run and then over independent runs with sample standard deviation (ddof=1). The 95% confidence interval for Psi is the percentile interval of a run-index paired bootstrap. Chi indicators are computed from the synthetic state: availability 1 for automatic, 0.5 for operator, 0 for failure; correctness max(0,1−error/e_max); safety 1 for safe action/transfer else 0; recovery share of isolated attackers under attack, 1 outside attack. Gamma defaults to 1/4 each.

## Missing evidence — do not claim reproduction of published results

The attached implementation plan identifies parameters missing from the published experiment (alpha, epsilon_E, admission threshold, confirmation count, quality parameters, accumulation thresholds, clipping norm and step, gamma, etc.). Values currently shipped in `ARTICLE_DEFAULTS` are **demonstration assumptions**. They do NOT establish numerical parity with Tables 2–3 of the article. Before scientific publication, retrieve the original version of `experiment.py` or another provenance-certified generator and record those values in the manuscript and the stand documentation.

For example, the default amplitude vector is (1,1,1,1) rather than a unit Euclidean direction, so Δ=4 adds +4 to *each* observable coordinate; with 4 of 21 agents this produces the familiar pre-isolation arithmetic mean displacement f Δ √d / N ≈ 1.524. This is a scenario-specific expectation, not a guaranteed whole-run average.

The state-dependent utilities and the concrete definitions of chi1–chi4 must be approved for the actual special-purpose system. Excluding self and isolated raters is an explicit implementation choice, not implicit in formulas (11)–(13) as stated in the plan. Model behavior has not been validated on a calibrated digital twin or a protected facility. On/off cases and stochastic series need sensitivity analysis; a claim that Psi is monotone in amplitude is a hypothesis, not a mathematical property for every finite sample.

## Automated tests

Run `cd gui && npm test` for seed reproducibility, validation constraints, closed-form direct trust, bounded D/tau, CUSUM, robustness of Trim_b, and the neutral Psi ratio. Run `npm run build` for the UI. The existing `verify-2027.yml` CI pipeline must pass before merging.

## Remaining methodological tasks

1. Independent Python reference with complete cross-language bit-level PRNG and trajectory comparison;
2. Scientific provenance for source Tables 2–3 and their unspecified parameters;
3. Exhaustive multi-scenario Table 3 and falsification tests for claims 1–2;
4. UI documentation displaying every formula in the source article, subject to the exact manuscript text;
5. Experimental calibration and final manuscript/result reconciliation.

This staged record is not a claim that all six phases from the uploaded plan have been completed.
