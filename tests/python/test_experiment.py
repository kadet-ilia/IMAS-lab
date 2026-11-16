# -*- coding: utf-8 -*-
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np

from experiment import (
    ExperimentConfig,
    paired_bootstrap_differences,
    plot_sensitivity,
    project_safe,
    regularized_eigentrust,
    run_experiment,
    run_experiment_with_trajectory_statistics,
    run_factorial_sensitivity,
    run_monte_carlo_analysis,
    run_one_factor_sensitivity,
    run_sensitivity,
    simulate_trace,
    stable_signature,
    summarize,
    weighted_trimmed_mean,
)


def small_config(**kwargs):
    base = replace(
        ExperimentConfig(),
        n_agents=12,
        n_byzantine=2,
        n_steps=8,
        n_runs=3,
        n_sensitivity_runs=1,
        factorial_runs_per_point=1,
        factorial_max_points=4,
        bootstrap_samples=100,
        parallel_workers=1,
        attack_start_step=3,
        sybil_activation_step=3,
        partition_start_step=3,
        partition_end_step=6,
        minimum_evidence_steps=3,
        isolation_patience=2,
        isolation_cooldown_steps=4,
        trust_window_steps=5,
        trim_each_side=2,
    )
    cfg = replace(base, **kwargs)
    cfg.validate()
    return cfg


class ExperimentTests(unittest.TestCase):
    def test_weighted_trimmed_mean_rejects_extremes(self):
        values = np.array([-100.0, 0.9, 1.0, 1.1, 100.0])
        result = weighted_trimmed_mean(values, np.ones(5), trim_each_side=1)
        self.assertAlmostEqual(result, 1.0)

    def test_safe_projection(self):
        cfg = ExperimentConfig()
        self.assertEqual(project_safe(100.0, cfg), cfg.safe_action_max)
        self.assertEqual(project_safe(-100.0, cfg), cfg.safe_action_min)

    def test_regularized_reputation_is_finite(self):
        trust = np.full((5, 5), 0.8)
        result = regularized_eigentrust(trust, np.ones(5, dtype=bool), damping=0.85)
        self.assertTrue(np.isfinite(result).all())
        self.assertTrue(np.allclose(result, 1.0))

    def test_seed_reproducibility_with_parallel_execution(self):
        cfg = small_config(n_runs=4, parallel_workers=2)
        first = run_experiment(cfg)
        second = run_experiment(cfg)
        deterministic = [column for column in first.columns if column != "aggregation_seconds"]
        self.assertTrue(first[deterministic].equals(second[deterministic]))

    def test_proposed_method_beats_mean_in_static_scenario(self):
        cfg = small_config(n_runs=12, n_steps=20, attack_start_step=4, sybil_activation_step=4, partition_end_step=10)
        summary = summarize(run_experiment(replace(cfg, scenarios=("static_bias",)))).set_index("method")
        self.assertLess(summary.loc["proposed_robust", "rmse_to_truth_mean"], summary.loc["arithmetic_mean", "rmse_to_truth_mean"])

    def test_inter_run_statistics_include_sigma_and_quantiles(self):
        cfg = small_config(n_runs=4)
        raw, statistics = run_experiment_with_trajectory_statistics(replace(cfg, scenarios=("static_bias",)))
        self.assertEqual(len(raw), cfg.n_runs * 3)
        row = statistics["static_bias"][0]
        self.assertEqual(row["run_count"], cfg.n_runs)
        mean = row["proposed_robust_mean"]
        std = row["proposed_robust_std"]
        self.assertAlmostEqual(row["proposed_robust_band1"][0], mean - std)
        self.assertAlmostEqual(row["proposed_robust_band2"][1], mean + 2 * std)
        self.assertLessEqual(row["proposed_robust_q05"], row["proposed_robust_q25"])
        self.assertLessEqual(row["proposed_robust_q25"], row["proposed_robust_median"])
        self.assertLessEqual(row["proposed_robust_median"], row["proposed_robust_q75"])
        self.assertLessEqual(row["proposed_robust_q75"], row["proposed_robust_q95"])

    def test_one_run_has_zero_sigma_but_valid_quantiles(self):
        cfg = small_config(n_runs=1)
        _, statistics = run_experiment_with_trajectory_statistics(replace(cfg, scenarios=("subtle_bias",)))
        for row in statistics["subtle_bias"]:
            self.assertEqual(row["proposed_robust_std"], 0.0)
            self.assertEqual(row["proposed_robust_band1"][0], row["proposed_robust_band1"][1])
            self.assertEqual(row["proposed_robust_q05"], row["proposed_robust_q95"])

    def test_bootstrap_comparison_has_paired_interval(self):
        cfg = small_config(n_runs=6)
        result = run_monte_carlo_analysis(cfg, "static_bias")
        rows = result["bootstrap_comparisons"]
        self.assertGreaterEqual(len(rows), 8)
        for row in rows:
            self.assertEqual(row["n_pairs"], cfg.n_runs)
            self.assertLessEqual(row["benefit_ci_low"], row["benefit_ci_high"])
            self.assertGreaterEqual(row["probability_better"], 0.0)
            self.assertLessEqual(row["probability_better"], 1.0)

    def test_distribution_payload_is_ordered(self):
        cfg = small_config(n_runs=5)
        result = run_monte_carlo_analysis(cfg, "static_bias")
        self.assertGreater(len(result["distributions"]), 0)
        for row in result["distributions"]:
            self.assertLessEqual(row["min"], row["q05"])
            self.assertLessEqual(row["q05"], row["q25"])
            self.assertLessEqual(row["q25"], row["median"])
            self.assertLessEqual(row["median"], row["q75"])
            self.assertLessEqual(row["q75"], row["q95"])
            self.assertLessEqual(row["q95"], row["max"])
            self.assertEqual(sum(bin_["count"] for bin_ in row["histogram"]), row["count"])

    def test_checkpoint_stop_and_resume(self):
        cfg = small_config(n_runs=5)
        with TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "checkpoint.json"
            state = {"completed": 0}

            def progress(payload):
                state["completed"] = payload["completed"]

            partial = run_monte_carlo_analysis(
                cfg,
                "static_bias",
                progress_callback=progress,
                stop_checker=lambda: state["completed"] >= 2,
                checkpoint_path=checkpoint,
            )
            self.assertTrue(partial["partial"])
            self.assertEqual(partial["completed_runs"], 2)
            self.assertTrue(checkpoint.is_file())
            resumed = run_monte_carlo_analysis(cfg, "static_bias", checkpoint_path=checkpoint)
            self.assertFalse(resumed["partial"])
            self.assertEqual(resumed["resumed_runs"], 2)
            self.assertEqual(resumed["completed_runs"], 5)
            self.assertFalse(checkpoint.exists())

    def test_network_constraints_reduce_delivery(self):
        cfg = small_config(
            network_enabled=True,
            network_topology="ring",
            message_loss_probability=0.25,
            message_delay_max_steps=1,
            bandwidth_messages_per_step=25,
            partition_enabled=True,
        )
        trace = simulate_trace(cfg, "collusion")
        self.assertLess(trace["summary"]["delivery_ratio"], 1.0)
        self.assertTrue(any(row["largest_component"] < cfg.total_agents for row in trace["network_series"]))
        self.assertTrue(any(row["messages_lost"] > 0 or row["messages_bandwidth_dropped"] > 0 for row in trace["network_series"]))

    def test_sybil_identities_are_explicit_agents(self):
        cfg = small_config(n_sybil_agents=3, network_enabled=True, network_topology="small_world")
        trace = simulate_trace(cfg, "collusion")
        self.assertEqual(trace["configuration"]["effective_agent_count"], cfg.n_agents + 3)
        self.assertEqual(len(trace["agents"]), cfg.total_agents)
        states = {item["state"] for item in trace["states"]}
        self.assertIn("sybil", states)
        self.assertIn("dormant", states)

    def test_one_factor_sensitivity_and_plot(self):
        cfg = small_config()
        result = run_one_factor_sensitivity(cfg, "static_bias", [0, 2])
        self.assertEqual(len(result["sensitivity"]), 6)
        raw = run_sensitivity(cfg)
        with TemporaryDirectory() as directory:
            output = Path(directory)
            plot_sensitivity(raw, output, cfg.n_agents)
            self.assertTrue((output / "sensitivity_by_f.png").is_file())

    def test_factorial_sensitivity_returns_effects(self):
        cfg = small_config(factorial_max_points=4, factorial_runs_per_point=1)
        result = run_factorial_sensitivity(cfg, "static_bias")
        self.assertFalse(result["partial"])
        self.assertEqual(len(result["design_points"]), 4 * 3)
        self.assertEqual(len(result["main_effects"]), 6 * 4)
        self.assertGreater(len(result["interaction_effects"]), 0)

    def test_gui_trace_contains_all_steps_and_agents(self):
        cfg = small_config(n_sybil_agents=2)
        trace = simulate_trace(cfg, "static_bias")
        self.assertEqual(len(trace["series"]), cfg.n_steps)
        self.assertEqual(len(trace["reputation"]), cfg.n_steps * cfg.total_agents)
        self.assertEqual(len(trace["states"]), cfg.n_steps * cfg.total_agents)
        self.assertEqual(len(trace["metrics"]), 3)

    def test_disabled_optional_features_do_not_constrain_short_runs(self):
        cfg = replace(ExperimentConfig(), n_steps=5, attack_start_step=3, n_sybil_agents=0, sybil_activation_step=20, partition_enabled=False, partition_start_step=70, partition_end_step=110)
        cfg.validate()

    def test_stable_signature_ignores_dictionary_order(self):
        self.assertEqual(stable_signature({"b": 2, "a": 1}), stable_signature({"a": 1, "b": 2}))


if __name__ == "__main__":
    unittest.main()
