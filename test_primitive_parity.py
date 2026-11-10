"""UP-34: independently run Python reference primitives on the same fixed vectors as JS.

This verifies ONLY core deterministic numerical operations. It does not prove
equivalence of the old Python simulator and the changed JS model, whose
random generators, isolation semantics and network handling differ.
"""
import json
import unittest
from collections import deque
from pathlib import Path

import numpy as np
from experiment import (
    ExperimentConfig,
    direct_trust_from_history,
    regularized_eigentrust,
    weighted_trimmed_mean,
)

FIXTURE = json.loads((Path(__file__).resolve().parent /
                      "audit/scientific-integrity/03_parity/primitive_vectors.json").read_text(encoding="utf-8"))


class PrimitiveParity(unittest.TestCase):
    def test_beta_posterior(self):
        v = FIXTURE["beta"]
        cfg = ExperimentConfig(n_agents=v["n"], n_byzantine=0, trim_each_side=1,
                               initial_trust=v["initialTrust"],
                               trust_prior_strength=v["priorStrength"],
                               forgetting_factor=v["forgettingFactor"])
        cfg.validate()
        history = deque(np.asarray(m, dtype=float) for m in (v["oldest"], v["newest"]))
        result = direct_trust_from_history(history, cfg)
        np.testing.assert_allclose(result, np.asarray(v["expected"]),
                                   rtol=0, atol=FIXTURE["tolerance"])

    def test_weighted_trim(self):
        v = FIXTURE["trimmed"]
        actual = weighted_trimmed_mean(np.asarray(v["values"], dtype=float),
                                       np.asarray(v["weights"], dtype=float),
                                       v["trimEachSide"])
        self.assertAlmostEqual(actual, v["expected"], delta=FIXTURE["tolerance"])

    def test_eigentrust(self):
        v = FIXTURE["eigen"]
        actual = regularized_eigentrust(np.asarray(v["trust"], dtype=float),
                                        np.asarray(v["active"], dtype=bool),
                                        v["damping"])
        np.testing.assert_allclose(actual, np.asarray(v["expected"]),
                                   rtol=0, atol=FIXTURE["tolerance"])


if __name__ == "__main__":
    unittest.main()
