"""UP-34: executable evidence of LEGACY Python vs CURRENT JS non-equivalence.

These tests intentionally protect historical Python behavior from being silently
described as identical to the remediation model. Do not 'fix' them by forcing
either model to behave like the other; any migration needs its own specification.
"""
import unittest

import numpy as np

from experiment import ExperimentConfig, build_adjacency, aggregate_actions, verification_matrix


class KnownLegacyDivergences(unittest.TestCase):
    def test_legacy_random_graph_has_a_forced_ring_at_p_zero(self):
        cfg = ExperimentConfig(n_agents=6,n_byzantine=0,trim_each_side=1,
                               network_enabled=True,network_topology="random",
                               network_edge_probability=0)
        cfg.validate()
        adjacency = build_adjacency(cfg,np.random.default_rng(20261106))
        # Corrected JS G(N,0) is an empty graph, protected by
        # gui/src/trustEngine.test.mjs and UP-34 graph_zero event-tape oracle.
        np.testing.assert_array_equal(adjacency.sum(axis=1),np.full(6,2))
        self.assertEqual(int(adjacency.sum()),12)

    def test_legacy_offline_observations_are_not_masked_for_inactive_agents(self):
        cfg = ExperimentConfig(n_agents=4,n_byzantine=0,trim_each_side=1,
                               network_enabled=False)
        cfg.validate()
        active = np.asarray([True,False,True,True])
        matrix, counters = verification_matrix(
            0,"static_bias",np.zeros(4,dtype=bool),active,
            np.zeros(4,dtype=int),100,np.random.default_rng(50),cfg)
        # Legacy matrix contains finite observations from inactive agent 2.
        # Corrected JS masks both its row and column. Hence full parity fails.
        self.assertTrue(np.isfinite(matrix[1]).all())
        self.assertTrue(np.isfinite(matrix[:,1]).all())
        self.assertEqual(counters["attempted"],9)

    def test_legacy_fallback_produces_action_where_current_js_abstains(self):
        cfg=ExperimentConfig(n_agents=4,n_byzantine=0,trim_each_side=1)
        cfg.validate()
        fallback={"arithmetic_mean":.6,"trust_weighted_mean":.6,"proposed_robust":.6}
        outcome=aggregate_actions(np.full(4,np.nan),np.zeros(4),
                                  np.zeros(4,dtype=bool),cfg,fallback=fallback)
        self.assertEqual(outcome,fallback)
        # Corrected JS aggregate returns three nulls in this case, and thus
        # records decision_coverage=0. Legacy version counts a fallback decision.


if __name__=="__main__":
    unittest.main()
