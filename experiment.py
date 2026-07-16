#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Модельный эксперимент интеллектуальной мультиагентной системы.

Версия 3 расширяет базовую модель следующими средствами:
- эмпирические области ±1σ/±2σ и квантильные области P5–P95/P25–P75;
- парный bootstrap для различий методов;
- параллельное выполнение прогонов;
- контроль прогресса, контрольные точки и возобновление прерванных серий;
- распределения итоговых метрик;
- однофакторный и многофакторный анализ чувствительности;
- модель топологии, задержек, потерь, пропускной способности, разделения сети
  и Sybil-идентичностей.

Пакетный запуск:
    python experiment.py --config config.json --output results
    python experiment.py --config config.json --output results --sensitivity
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import multiprocessing as mp
import os
import time
from collections import deque
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

import numpy as np
import pandas as pd

SCENARIOS = ("static_bias", "subtle_bias", "on_off", "collusion")
METHODS = ("arithmetic_mean", "trust_weighted_mean", "proposed_robust")
NETWORK_TOPOLOGIES = ("complete", "ring", "random", "small_world")
LOWER_IS_BETTER_METRICS = {
    "rmse_to_truth",
    "mae_to_truth",
    "consensus_error",
    "false_isolations",
    "mean_detection_time_steps",
    "aggregation_seconds",
}

ProgressCallback = Callable[[dict[str, Any]], None]
StopChecker = Callable[[], bool]


@dataclass(frozen=True)
class ExperimentConfig:
    seed: int = 20260716
    n_agents: int = 50
    n_byzantine: int = 10
    n_sybil_agents: int = 0
    sybil_activation_step: int = 20
    n_steps: int = 200
    n_runs: int = 100
    n_sensitivity_runs: int = 20
    factorial_runs_per_point: int = 6
    factorial_max_points: int = 64
    bootstrap_samples: int = 1000
    parallel_workers: int = 0
    scenarios: tuple[str, ...] = SCENARIOS
    desired_action: float = 0.60
    attack_start_step: int = 20
    attack_direction: float = -1.0
    honest_quality: float = 0.92
    byzantine_quality: float = 0.10
    honest_noise_sigma: float = 0.20
    observer_noise_sigma: float = 0.02
    static_bias: float = 4.0
    subtle_bias: float = 0.65
    collusion_bias: float = 1.50
    on_off_period: int = 10
    on_off_attack_steps: int = 4
    trust_window_steps: int = 20
    forgetting_factor: float = 0.95
    initial_trust: float = 0.50
    trust_prior_strength: float = 2.0
    minimum_weight: float = 0.05
    reputation_damping: float = 0.85
    isolation_threshold: float = 0.25
    isolation_patience: int = 3
    minimum_evidence_steps: int = 8
    isolation_cooldown_steps: int = 30
    trim_each_side: int = 10
    clip_radius: float = 1.25
    safe_action_min: float = -2.0
    safe_action_max: float = 2.0
    correctness_tolerance: float = 0.50

    # Сетевая модель.
    network_enabled: bool = False
    network_topology: str = "complete"
    network_edge_probability: float = 0.25
    small_world_neighbors: int = 4
    small_world_rewire_probability: float = 0.10
    message_loss_probability: float = 0.00
    message_delay_min_steps: int = 0
    message_delay_max_steps: int = 0
    max_message_staleness_steps: int = 5
    bandwidth_messages_per_step: int = 100000
    partition_enabled: bool = False
    partition_start_step: int = 70
    partition_end_step: int = 110
    partition_fraction: float = 0.50

    @property
    def total_agents(self) -> int:
        return self.n_agents + self.n_sybil_agents

    @property
    def total_byzantine(self) -> int:
        return self.n_byzantine + self.n_sybil_agents

    @classmethod
    def from_json(cls, path: Path) -> "ExperimentConfig":
        raw = json.loads(path.read_text(encoding="utf-8"))
        allowed = {field.name for field in fields(cls)}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"Unknown configuration fields: {sorted(unknown)}")
        if "scenarios" in raw:
            raw["scenarios"] = tuple(raw["scenarios"])
        cfg = cls(**raw)
        cfg.validate()
        return cfg

    def validate(self) -> None:
        if self.n_agents < 3:
            raise ValueError("n_agents must be at least 3")
        if not 0 <= self.n_byzantine < self.n_agents:
            raise ValueError("n_byzantine must satisfy 0 <= f < N")
        # Условие честного большинства проверяется для легитимных идентичностей.
        # Sybil-идентичности намеренно могут нарушить его и показать границу модели.
        if self.n_agents <= 2 * self.n_byzantine:
            raise ValueError("Base-agent robust aggregation requires N > 2f")
        if self.n_sybil_agents < 0:
            raise ValueError("n_sybil_agents must be non-negative")
        if self.total_agents > 160:
            raise ValueError("total number of agents must not exceed 160")
        if self.n_steps <= 0 or self.n_runs <= 0:
            raise ValueError("n_steps and n_runs must be positive")
        if self.n_sensitivity_runs <= 0 or self.factorial_runs_per_point <= 0:
            raise ValueError("sensitivity run counts must be positive")
        if self.factorial_max_points <= 0 or self.factorial_max_points > 128:
            raise ValueError("factorial_max_points must be within 1..128")
        if self.bootstrap_samples < 100 or self.bootstrap_samples > 10000:
            raise ValueError("bootstrap_samples must be within 100..10000")
        if self.parallel_workers < 0 or self.parallel_workers > 32:
            raise ValueError("parallel_workers must be within 0..32")
        if not 1 <= self.attack_start_step <= self.n_steps:
            raise ValueError("attack_start_step must be within 1..n_steps")
        if self.n_sybil_agents > 0 and not 1 <= self.sybil_activation_step <= self.n_steps:
            raise ValueError("sybil_activation_step must be within 1..n_steps when Sybil agents are enabled")
        if self.trust_window_steps <= 0:
            raise ValueError("trust_window_steps must be positive")
        if not 0 < self.initial_trust < 1:
            raise ValueError("initial_trust must be in (0, 1)")
        if self.minimum_weight < 0:
            raise ValueError("minimum_weight must be non-negative")
        if not 0 < self.forgetting_factor <= 1:
            raise ValueError("forgetting_factor must be in (0, 1]")
        if not 0 <= self.reputation_damping < 1:
            raise ValueError("reputation_damping must be in [0, 1)")
        if self.safe_action_min >= self.safe_action_max:
            raise ValueError("safe_action_min must be below safe_action_max")
        if self.network_topology not in NETWORK_TOPOLOGIES:
            raise ValueError(f"Unsupported network_topology: {self.network_topology}")
        if not 0 <= self.network_edge_probability <= 1:
            raise ValueError("network_edge_probability must be in [0, 1]")
        if not 0 <= self.small_world_rewire_probability <= 1:
            raise ValueError("small_world_rewire_probability must be in [0, 1]")
        if self.small_world_neighbors < 2:
            raise ValueError("small_world_neighbors must be at least 2")
        if not 0 <= self.message_loss_probability <= 1:
            raise ValueError("message_loss_probability must be in [0, 1]")
        if self.message_delay_min_steps < 0 or self.message_delay_max_steps < self.message_delay_min_steps:
            raise ValueError("invalid message delay interval")
        if self.max_message_staleness_steps < 0:
            raise ValueError("max_message_staleness_steps must be non-negative")
        if self.bandwidth_messages_per_step <= 0:
            raise ValueError("bandwidth_messages_per_step must be positive")
        if self.partition_enabled and not 1 <= self.partition_start_step <= self.n_steps:
            raise ValueError("partition_start_step must be within 1..n_steps when partitioning is enabled")
        if self.partition_enabled and not self.partition_start_step <= self.partition_end_step <= self.n_steps:
            raise ValueError("partition_end_step must be within partition_start..n_steps when partitioning is enabled")
        if not 0 < self.partition_fraction < 1:
            raise ValueError("partition_fraction must be in (0, 1)")
        bad = set(self.scenarios) - set(SCENARIOS)
        if bad:
            raise ValueError(f"Unsupported scenarios: {sorted(bad)}")


def _json_default(value: Any) -> Any:
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(type(value).__name__)


def stable_signature(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=_json_default)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _emit_progress(
    callback: ProgressCallback | None,
    *,
    stage: str,
    completed: int,
    total: int,
    started: float,
    message: str = "",
    resumed: int = 0,
) -> None:
    if callback is None:
        return
    elapsed = max(time.perf_counter() - started, 0.0)
    rate = completed / elapsed if completed > 0 and elapsed > 0 else 0.0
    eta = (total - completed) / rate if rate > 0 else None
    callback(
        {
            "stage": stage,
            "completed": int(completed),
            "total": int(total),
            "percent": float(100.0 * completed / max(total, 1)),
            "elapsed_seconds": float(elapsed),
            "eta_seconds": None if eta is None else float(max(eta, 0.0)),
            "message": message,
            "resumed": int(resumed),
        }
    )


def regularized_eigentrust(
    direct_trust: np.ndarray,
    active: np.ndarray,
    damping: float,
    tolerance: float = 1e-12,
    max_iter: int = 500,
) -> np.ndarray:
    """Solve r = damping*C.T*r + (1-damping)*v by fixed-point iteration."""
    n = direct_trust.shape[0]
    active_idx = np.flatnonzero(active)
    result = np.zeros(n, dtype=float)
    if active_idx.size == 0:
        return result

    sub = np.clip(direct_trust[np.ix_(active_idx, active_idx)] - 0.5, 0.0, None)
    row_sum = sub.sum(axis=1, keepdims=True)
    uniform = np.full_like(sub, 1.0 / active_idx.size)
    c = np.divide(sub, row_sum, out=uniform, where=row_sum > 1e-15)
    v = np.full(active_idx.size, 1.0 / active_idx.size)
    r = v.copy()
    for _ in range(max_iter):
        next_r = damping * c.T.dot(r) + (1.0 - damping) * v
        if np.linalg.norm(next_r - r, ord=1) < tolerance:
            r = next_r
            break
        r = next_r
    result[active_idx] = r / max(float(r.max()), 1e-15)
    return result


def weighted_trimmed_mean(values: np.ndarray, weights: np.ndarray, trim_each_side: int) -> float:
    """Coordinate-wise weighted trimmed mean for a scalar decision."""
    if values.size == 0:
        raise ValueError("Cannot aggregate an empty set")
    order = np.argsort(values, kind="mergesort")
    values = values[order]
    weights = np.maximum(weights[order], 0.0)
    k = min(trim_each_side, max((values.size - 1) // 2, 0))
    if k:
        values = values[k:-k]
        weights = weights[k:-k]
    total = float(weights.sum())
    return float(np.mean(values) if total <= 1e-15 else np.dot(values, weights) / total)


def project_safe(value: float, cfg: ExperimentConfig) -> float:
    return float(np.clip(value, cfg.safe_action_min, cfg.safe_action_max))


def attack_is_active(step: int, scenario: str, cfg: ExperimentConfig) -> bool:
    if step + 1 < cfg.attack_start_step:
        return False
    if scenario != "on_off":
        return True
    relative = step + 1 - cfg.attack_start_step
    return (relative % cfg.on_off_period) < cfg.on_off_attack_steps


def direct_trust_from_history(history: deque[np.ndarray], cfg: ExperimentConfig) -> np.ndarray:
    """Discounted Beta posterior; NaN elements mean absent observations."""
    n = cfg.total_agents
    prior_alpha = cfg.initial_trust * cfg.trust_prior_strength
    prior_beta = (1.0 - cfg.initial_trust) * cfg.trust_prior_strength
    alpha = np.full((n, n), prior_alpha, dtype=float)
    beta = np.full((n, n), prior_beta, dtype=float)
    for age, evidence in enumerate(reversed(history)):
        weight = cfg.forgetting_factor**age
        valid = np.isfinite(evidence)
        alpha += weight * np.where(valid, evidence, 0.0)
        beta += weight * np.where(valid, 1.0 - evidence, 0.0)
    return alpha / np.maximum(alpha + beta, 1e-15)


def initialize_agents(cfg: ExperimentConfig, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    byzantine = np.zeros(cfg.total_agents, dtype=bool)
    sybil = np.zeros(cfg.total_agents, dtype=bool)
    if cfg.n_byzantine:
        bad_idx = rng.choice(cfg.n_agents, size=cfg.n_byzantine, replace=False)
        byzantine[bad_idx] = True
    if cfg.n_sybil_agents:
        sybil[cfg.n_agents :] = True
        byzantine[cfg.n_agents :] = True
    return byzantine, sybil


def make_proposals(
    truth: float,
    step: int,
    scenario: str,
    byzantine: np.ndarray,
    sybil: np.ndarray,
    rng: np.random.Generator,
    cfg: ExperimentConfig,
) -> np.ndarray:
    proposals = truth + rng.normal(0.0, cfg.honest_noise_sigma, cfg.total_agents)
    bad_idx = np.flatnonzero(byzantine)
    if bad_idx.size == 0 or not attack_is_active(step, scenario, cfg):
        return proposals

    if scenario == "static_bias":
        proposals[bad_idx] = truth + cfg.attack_direction * cfg.static_bias + rng.normal(0.0, 0.05, bad_idx.size)
    elif scenario == "subtle_bias":
        proposals[bad_idx] = truth + cfg.attack_direction * cfg.subtle_bias + rng.normal(0.0, 0.05, bad_idx.size)
    elif scenario == "on_off":
        proposals[bad_idx] = truth + cfg.attack_direction * cfg.static_bias + rng.normal(0.0, 0.05, bad_idx.size)
    elif scenario == "collusion":
        common = truth + cfg.attack_direction * cfg.collusion_bias + rng.normal(0.0, 0.02)
        proposals[bad_idx] = common + rng.normal(0.0, 0.01, bad_idx.size)
    else:
        raise ValueError(f"Unknown scenario: {scenario}")

    # Sybil-идентичности передают практически идентичное согласованное значение.
    sybil_idx = np.flatnonzero(sybil)
    if sybil_idx.size:
        common = truth + cfg.attack_direction * cfg.collusion_bias + rng.normal(0.0, 0.005)
        proposals[sybil_idx] = common + rng.normal(0.0, 0.002, sybil_idx.size)
    return proposals


def build_adjacency(cfg: ExperimentConfig, rng: np.random.Generator) -> np.ndarray:
    n = cfg.total_agents
    if not cfg.network_enabled or cfg.network_topology == "complete":
        adjacency = np.ones((n, n), dtype=bool)
        np.fill_diagonal(adjacency, False)
        return adjacency

    adjacency = np.zeros((n, n), dtype=bool)
    if cfg.network_topology == "ring":
        for i in range(n):
            adjacency[i, (i - 1) % n] = True
            adjacency[i, (i + 1) % n] = True
    elif cfg.network_topology == "random":
        upper = rng.random((n, n)) < cfg.network_edge_probability
        adjacency = np.triu(upper, 1)
        adjacency |= adjacency.T
        # Кольцевой остов исключает случайную полную фрагментацию исходной сети.
        for i in range(n):
            adjacency[i, (i + 1) % n] = True
            adjacency[(i + 1) % n, i] = True
    elif cfg.network_topology == "small_world":
        k = min(max(2, cfg.small_world_neighbors), max(n - 1, 2))
        if k % 2:
            k -= 1
        half = max(1, k // 2)
        for i in range(n):
            for offset in range(1, half + 1):
                j = (i + offset) % n
                adjacency[i, j] = adjacency[j, i] = True
        # Упрощенная процедура Watts–Strogatz: перенаправление только правых ребер.
        for i in range(n):
            for offset in range(1, half + 1):
                j = (i + offset) % n
                if rng.random() >= cfg.small_world_rewire_probability:
                    continue
                candidates = np.flatnonzero(~adjacency[i])
                candidates = candidates[(candidates != i) & (candidates != j)]
                if candidates.size == 0:
                    continue
                new_j = int(rng.choice(candidates))
                adjacency[i, j] = adjacency[j, i] = False
                adjacency[i, new_j] = adjacency[new_j, i] = True
    np.fill_diagonal(adjacency, False)

    # Sybil-идентичности создают плотный кластер и дополнительные связи с нарушителями.
    if cfg.n_sybil_agents:
        sybil_idx = np.arange(cfg.n_agents, n)
        adjacency[np.ix_(sybil_idx, sybil_idx)] = True
        np.fill_diagonal(adjacency, False)
        anchors = np.arange(min(cfg.n_byzantine + 2, cfg.n_agents))
        for s in sybil_idx:
            adjacency[s, anchors] = True
            adjacency[anchors, s] = True
    return adjacency


def make_partition_groups(cfg: ExperimentConfig, rng: np.random.Generator) -> np.ndarray:
    n = cfg.total_agents
    groups = np.zeros(n, dtype=int)
    count = int(round(n * cfg.partition_fraction))
    count = min(max(count, 1), n - 1)
    groups[rng.choice(n, size=count, replace=False)] = 1
    return groups


def effective_adjacency(
    base: np.ndarray,
    step: int,
    active: np.ndarray,
    partition_groups: np.ndarray,
    cfg: ExperimentConfig,
) -> tuple[np.ndarray, bool]:
    adjacency = base.copy()
    partition_active = bool(
        cfg.network_enabled
        and cfg.partition_enabled
        and cfg.partition_start_step <= step + 1 <= cfg.partition_end_step
    )
    if partition_active:
        adjacency &= partition_groups[:, None] == partition_groups[None, :]
    adjacency &= active[:, None] & active[None, :]
    np.fill_diagonal(adjacency, False)
    return adjacency, partition_active


def connected_components(adjacency: np.ndarray, active: np.ndarray) -> tuple[list[np.ndarray], np.ndarray]:
    n = adjacency.shape[0]
    labels = np.full(n, -1, dtype=int)
    components: list[np.ndarray] = []
    for start in np.flatnonzero(active):
        if labels[start] >= 0:
            continue
        label = len(components)
        stack = [int(start)]
        members: list[int] = []
        labels[start] = label
        while stack:
            node = stack.pop()
            members.append(node)
            neighbors = np.flatnonzero(adjacency[node] & active)
            for neighbor in neighbors:
                if labels[neighbor] < 0:
                    labels[neighbor] = label
                    stack.append(int(neighbor))
        components.append(np.asarray(members, dtype=int))
    return components, labels


def verification_matrix(
    step: int,
    scenario: str,
    byzantine: np.ndarray,
    active: np.ndarray,
    component_labels: np.ndarray,
    evidence_budget: int,
    rng: np.random.Generator,
    cfg: ExperimentConfig,
) -> tuple[np.ndarray, dict[str, int]]:
    """Generate observer-target evidence and apply communication constraints."""
    n = cfg.total_agents
    active_attack = attack_is_active(step, scenario, cfg)
    target_quality = np.full(n, cfg.honest_quality, dtype=float)
    if active_attack:
        target_quality[byzantine] = cfg.byzantine_quality

    evidence = np.empty((n, n), dtype=float)
    for observer in range(n):
        if not byzantine[observer]:
            draws = rng.binomial(1, target_quality, size=n).astype(float)
            noise = rng.normal(0.0, cfg.observer_noise_sigma, n)
            evidence[observer] = np.clip(draws + noise, 0.0, 1.0)
        else:
            evidence[observer] = np.where(byzantine, 0.98, 0.02)
    np.fill_diagonal(evidence, cfg.honest_quality)

    if not cfg.network_enabled:
        attempted = int(active.sum()) ** 2
        return evidence, {"attempted": attempted, "delivered": attempted, "lost": 0, "bandwidth_dropped": 0}

    same_component = (
        (component_labels[:, None] >= 0)
        & (component_labels[:, None] == component_labels[None, :])
        & active[:, None]
        & active[None, :]
    )
    np.fill_diagonal(same_component, active)
    attempted_idx = np.argwhere(same_component)
    attempted = int(attempted_idx.shape[0])
    valid = same_component.copy()

    if cfg.message_loss_probability > 0 and attempted:
        loss_draw = rng.random((n, n)) < cfg.message_loss_probability
        loss_draw &= same_component
        np.fill_diagonal(loss_draw, False)
        valid &= ~loss_draw
    lost = attempted - int(valid.sum())

    bandwidth_dropped = 0
    valid_idx = np.argwhere(valid)
    if valid_idx.shape[0] > max(evidence_budget, 0):
        keep_count = max(int(evidence_budget), 0)
        if keep_count:
            selected = rng.choice(valid_idx.shape[0], size=keep_count, replace=False)
            selected_idx = valid_idx[selected]
            keep = np.zeros_like(valid)
            keep[selected_idx[:, 0], selected_idx[:, 1]] = True
            valid = keep
        else:
            valid[:] = False
        bandwidth_dropped = int(valid_idx.shape[0] - keep_count)

    evidence[~valid] = np.nan
    return evidence, {
        "attempted": attempted,
        "delivered": int(valid.sum()),
        "lost": int(lost),
        "bandwidth_dropped": int(bandwidth_dropped),
    }


def component_trust_scores(
    direct_trust: np.ndarray,
    components: list[np.ndarray],
    active: np.ndarray,
    initial_trust: float,
) -> np.ndarray:
    scores = np.full(active.shape[0], initial_trust, dtype=float)
    for component in components:
        members = component[active[component]]
        if members.size:
            scores[members] = np.median(direct_trust[np.ix_(members, members)], axis=0)
    return scores


def aggregate_actions(
    proposals: np.ndarray,
    reputation: np.ndarray,
    active: np.ndarray,
    cfg: ExperimentConfig,
    fallback: dict[str, float] | None = None,
) -> dict[str, float]:
    idx = np.flatnonzero(active & np.isfinite(proposals))
    if idx.size == 0:
        if fallback is not None:
            return dict(fallback)
        center = (cfg.safe_action_min + cfg.safe_action_max) / 2.0
        return {method: float(center) for method in METHODS}
    values = proposals[idx]
    weights = np.maximum(reputation[idx], cfg.minimum_weight)

    arithmetic = float(values.mean())
    trust_mean = float(np.dot(values, weights) / max(float(weights.sum()), 1e-15))
    center = float(np.median(values))
    clipped = np.clip(values, center - cfg.clip_radius, center + cfg.clip_radius)
    robust = weighted_trimmed_mean(clipped, weights, cfg.trim_each_side)
    robust = project_safe(robust, cfg)
    return {
        "arithmetic_mean": arithmetic,
        "trust_weighted_mean": trust_mean,
        "proposed_robust": robust,
    }


def _transport_proposals(
    *,
    step: int,
    proposals: np.ndarray,
    active: np.ndarray,
    components: list[np.ndarray],
    queue: list[tuple[int, int, float, int]],
    last_values: np.ndarray,
    last_steps: np.ndarray,
    rng: np.random.Generator,
    cfg: ExperimentConfig,
) -> tuple[np.ndarray, np.ndarray, dict[str, int | float], int]:
    """Deliver proposals to the logical consensus layer.

    The largest connected component is interpreted as the component capable of
    forming the global decision. Delayed messages can be reused while their age
    does not exceed max_message_staleness_steps.
    """
    if not cfg.network_enabled:
        return proposals.copy(), active.copy(), {
            "component_size": int(active.sum()),
            "attempted": int(active.sum()),
            "delivered": int(active.sum()),
            "lost": 0,
            "bandwidth_dropped": 0,
            "queued": 0,
            "mean_delay": 0.0,
        }, cfg.bandwidth_messages_per_step

    largest = max(components, key=lambda item: (item.size, -int(item.min()) if item.size else 0), default=np.array([], dtype=int))
    component_mask = np.zeros(cfg.total_agents, dtype=bool)
    component_mask[largest] = True
    attempted = int(largest.size)
    lost = 0
    delays: list[int] = []
    for source in largest:
        if rng.random() < cfg.message_loss_probability:
            lost += 1
            continue
        delay = int(rng.integers(cfg.message_delay_min_steps, cfg.message_delay_max_steps + 1))
        queue.append((step + delay, int(source), float(proposals[source]), delay))

    queue.sort(key=lambda item: item[0])
    budget = cfg.bandwidth_messages_per_step
    delivered = 0
    retained: list[tuple[int, int, float, int]] = []
    due_but_dropped = 0
    for item in queue:
        deliver_step, source, value, delay = item
        if deliver_step <= step and budget > 0:
            last_values[source] = value
            last_steps[source] = step
            delivered += 1
            budget -= 1
            delays.append(delay)
        elif deliver_step <= step and budget <= 0:
            retained.append(item)
            due_but_dropped += 1
        else:
            retained.append(item)
    queue[:] = retained

    age = step - last_steps
    available = component_mask & np.isfinite(last_values) & (age <= cfg.max_message_staleness_steps)
    transported = last_values.copy()
    return transported, available, {
        "component_size": int(largest.size),
        "attempted": attempted,
        "delivered": delivered,
        "lost": lost,
        "bandwidth_dropped": due_but_dropped,
        "queued": len(queue),
        "mean_delay": float(np.mean(delays)) if delays else 0.0,
    }, budget


def _simulate_run_core(
    cfg: ExperimentConfig,
    scenario: str,
    run_index: int,
    scenario_index: int,
    collect_trajectory: bool = False,
    collect_details: bool = False,
    progress_callback: ProgressCallback | None = None,
    stop_checker: StopChecker | None = None,
) -> tuple[list[dict[str, float | int | str]], list[dict[str, float | int]], dict[str, Any] | None]:
    seed_seq = np.random.SeedSequence([cfg.seed, scenario_index, run_index])
    rng = np.random.default_rng(seed_seq)
    byzantine, sybil = initialize_agents(cfg, rng)
    base_adjacency = build_adjacency(cfg, rng)
    partition_groups = make_partition_groups(cfg, rng)

    evidence_history: deque[np.ndarray] = deque(maxlen=cfg.trust_window_steps)
    active = np.ones(cfg.total_agents, dtype=bool)
    if cfg.n_sybil_agents:
        active[sybil] = False
    low_counter = np.zeros(cfg.total_agents, dtype=int)
    isolated_at = np.full(cfg.total_agents, np.nan)
    isolated_until = np.full(cfg.total_agents, -1, dtype=int)

    proposal_queue: list[tuple[int, int, float, int]] = []
    last_values = np.full(cfg.total_agents, np.nan)
    last_steps = np.full(cfg.total_agents, -10**9, dtype=int)
    last_decisions = {method: float(cfg.desired_action) for method in METHODS}

    errors = {method: [] for method in METHODS}
    signed_errors = {method: [] for method in METHODS}
    correct = {method: [] for method in METHODS}
    consensus = {method: [] for method in METHODS}
    coverage95 = {method: [] for method in METHODS}
    communication_attempted = 0
    communication_delivered = 0
    communication_lost = 0
    communication_bandwidth_dropped = 0
    computation_seconds = 0.0
    trajectory: list[dict[str, float | int]] = []

    reputation_history: list[dict[str, object]] = []
    states: list[dict[str, object]] = []
    events: list[dict[str, object]] = []
    network_series: list[dict[str, object]] = []
    started = time.perf_counter()

    for step in range(cfg.n_steps):
        if stop_checker and stop_checker():
            break

        eligible = ~sybil | (step + 1 >= cfg.sybil_activation_step)
        newly_activated = sybil & eligible & (isolated_until < 0) & ~active
        active[newly_activated] = True

        reactivated = eligible & (~active) & (isolated_until >= 0) & (isolated_until < step)
        active[reactivated] = True
        low_counter[reactivated] = 0
        if not (active & eligible).any():
            # Управляемая деградация: возвращается хотя бы один легитимный узел.
            first = int(np.flatnonzero(~sybil)[0])
            active[first] = True
            isolated_until[first] = -1
            low_counter[first] = 0

        adjacency, partition_active = effective_adjacency(base_adjacency, step, active & eligible, partition_groups, cfg)
        components, component_labels = connected_components(adjacency, active & eligible)

        truth = float(cfg.desired_action)
        proposals = make_proposals(truth, step, scenario, byzantine, sybil, rng, cfg)
        direct_trust = direct_trust_from_history(evidence_history, cfg)
        robust_local = component_trust_scores(direct_trust, components, active & eligible, cfg.initial_trust)
        global_rep = regularized_eigentrust(direct_trust, active & eligible, cfg.reputation_damping)
        reputation = 0.70 * robust_local + 0.30 * global_rep

        transported, available, proposal_comm, remaining_budget = _transport_proposals(
            step=step,
            proposals=proposals,
            active=active & eligible,
            components=components,
            queue=proposal_queue,
            last_values=last_values,
            last_steps=last_steps,
            rng=rng,
            cfg=cfg,
        )

        calc_started = time.perf_counter()
        decisions = aggregate_actions(transported, reputation, available, cfg, fallback=last_decisions)
        computation_seconds += time.perf_counter() - calc_started
        last_decisions = decisions

        honest_available = available & ~byzantine
        reference = float(np.median(transported[honest_available])) if honest_available.any() else truth
        honest_count = int(honest_available.sum())
        interval_half_width = 1.96 * cfg.honest_noise_sigma / math.sqrt(max(honest_count, 1))
        for method, decision in decisions.items():
            signed_error = float(decision - truth)
            error = abs(signed_error)
            errors[method].append(error)
            signed_errors[method].append(signed_error)
            correct[method].append(error <= cfg.correctness_tolerance)
            consensus[method].append(abs(decision - reference))
            coverage95[method].append(error <= interval_half_width)

        evidence, evidence_comm = verification_matrix(
            step,
            scenario,
            byzantine,
            active & eligible,
            component_labels,
            remaining_budget,
            rng,
            cfg,
        )
        evidence_history.append(evidence)

        communication_attempted += int(proposal_comm["attempted"]) + evidence_comm["attempted"]
        communication_delivered += int(proposal_comm["delivered"]) + evidence_comm["delivered"]
        communication_lost += int(proposal_comm["lost"]) + evidence_comm["lost"]
        communication_bandwidth_dropped += int(proposal_comm["bandwidth_dropped"]) + evidence_comm["bandwidth_dropped"]

        if step + 1 >= cfg.minimum_evidence_steps:
            updated_trust = direct_trust_from_history(evidence_history, cfg)
            scores = component_trust_scores(updated_trust, components, active & eligible, cfg.initial_trust)
            low_counter = np.where(
                active & eligible & (scores < cfg.isolation_threshold),
                low_counter + 1,
                0,
            )
            newly_isolated = active & eligible & (low_counter >= cfg.isolation_patience)
            for agent in np.flatnonzero(newly_isolated):
                if not np.isfinite(isolated_at[agent]):
                    isolated_at[agent] = step + 1
                if collect_details:
                    events.append(
                        {
                            "step": step + 1,
                            "agent": int(agent + 1),
                            "type": "sybil" if sybil[agent] else "byzantine" if byzantine[agent] else "false_positive",
                            "reason": "reputation_below_threshold",
                            "confirmations": int(low_counter[agent]),
                            "duration": int(cfg.isolation_cooldown_steps),
                            "reputation": float(scores[agent]),
                        }
                    )
            isolated_until[newly_isolated] = step + cfg.isolation_cooldown_steps
            active[newly_isolated] = False

        row: dict[str, float | int] = {
            "step": step + 1,
            "truth": truth,
            "active_agents": int((active & eligible).sum()),
            "available_agents": int(available.sum()),
            "isolated_agents": int((eligible & ~active).sum()),
            "largest_component": int(proposal_comm["component_size"]),
            "messages_delivered": int(proposal_comm["delivered"] + evidence_comm["delivered"]),
            "messages_lost": int(proposal_comm["lost"] + evidence_comm["lost"]),
            "messages_bandwidth_dropped": int(proposal_comm["bandwidth_dropped"] + evidence_comm["bandwidth_dropped"]),
            "partition_active": int(partition_active),
            "attack_active": int(attack_is_active(step, scenario, cfg)),
            **{method: float(decisions[method]) for method in METHODS},
        }
        if collect_trajectory:
            trajectory.append(row)

        if collect_details:
            network_series.append(
                {
                    **row,
                    "proposal_queue": int(proposal_comm["queued"]),
                    "mean_message_delay": float(proposal_comm["mean_delay"]),
                    "delivery_ratio": float(
                        (proposal_comm["delivered"] + evidence_comm["delivered"])
                        / max(proposal_comm["attempted"] + evidence_comm["attempted"], 1)
                    ),
                }
            )
            for agent in range(cfg.total_agents):
                reputation_history.append(
                    {
                        "step": step + 1,
                        "agent": agent + 1,
                        "reputation": float(reputation[agent]),
                        "byzantine": bool(byzantine[agent]),
                        "sybil": bool(sybil[agent]),
                        "active": bool(active[agent]),
                    }
                )
                if sybil[agent] and not eligible[agent]:
                    state = "dormant"
                elif not active[agent]:
                    state = "isolated"
                elif sybil[agent]:
                    state = "sybil"
                elif byzantine[agent]:
                    state = "byzantine"
                else:
                    state = "honest"
                states.append({"step": step + 1, "agent": agent + 1, "state": state})

        if progress_callback and (step == 0 or (step + 1) % max(1, cfg.n_steps // 50) == 0 or step + 1 == cfg.n_steps):
            _emit_progress(
                progress_callback,
                stage="trace",
                completed=step + 1,
                total=cfg.n_steps,
                started=started,
                message="Моделирование одного прогона",
            )

    completed_steps = len(trajectory) if collect_trajectory else (len(errors[METHODS[0]]))
    honest = ~byzantine
    ever_isolated = np.isfinite(isolated_at)
    detected_bad = ever_isolated & byzantine
    detected_times = isolated_at[detected_bad]
    detection_rate = float(detected_bad.sum() / max(byzantine.sum(), 1))
    mean_detection_time = float(np.nanmean(detected_times)) if detected_times.size else math.nan
    false_isolations = int((ever_isolated & honest).sum())
    preserved_functionality = float((active & honest).sum() / max(honest.sum(), 1))
    delivery_ratio = float(communication_delivered / max(communication_attempted, 1))

    rows: list[dict[str, float | int | str]] = []
    for method in METHODS:
        error_array = np.asarray(errors[method], dtype=float)
        if error_array.size == 0:
            error_array = np.asarray([math.nan])
        rows.append(
            {
                "scenario": scenario,
                "run": run_index,
                "method": method,
                "probability_correct": float(np.nanmean(correct[method])) if correct[method] else math.nan,
                "mae_to_truth": float(np.nanmean(error_array)),
                "rmse_to_truth": float(np.sqrt(np.nanmean(error_array**2))),
                "bias": float(np.nanmean(signed_errors[method])) if signed_errors[method] else math.nan,
                "coverage95": float(np.nanmean(coverage95[method])) if coverage95[method] else math.nan,
                "consensus_error": float(np.nanmean(consensus[method])) if consensus[method] else math.nan,
                "detection_rate": detection_rate,
                "mean_detection_time_steps": mean_detection_time,
                "false_isolations": false_isolations,
                "preserved_functionality": preserved_functionality,
                "communication_messages": communication_delivered,
                "communication_attempted": communication_attempted,
                "communication_lost": communication_lost,
                "communication_bandwidth_dropped": communication_bandwidth_dropped,
                "delivery_ratio": delivery_ratio,
                "aggregation_seconds": computation_seconds,
                "completed_steps": completed_steps,
            }
        )

    details: dict[str, Any] | None = None
    if collect_details:
        metrics = [
            {
                "method": method,
                "probability_correct": rows[index]["probability_correct"],
                "mae": rows[index]["mae_to_truth"],
                "rmse": rows[index]["rmse_to_truth"],
                "bias": rows[index]["bias"],
                "coverage95": rows[index]["coverage95"],
            }
            for index, method in enumerate(METHODS)
        ]
        details = {
            "series": trajectory,
            "network_series": network_series,
            "reputation": reputation_history,
            "states": states,
            "events": events,
            "metrics": metrics,
            "agents": [
                {
                    "agent": agent + 1,
                    "byzantine": bool(byzantine[agent]),
                    "sybil": bool(sybil[agent]),
                    "active": bool(active[agent]),
                    "isolated_at": None if not np.isfinite(isolated_at[agent]) else int(isolated_at[agent]),
                }
                for agent in range(cfg.total_agents)
            ],
            "summary": {
                "detection_rate": detection_rate,
                "mean_detection_time": None if not np.isfinite(mean_detection_time) else mean_detection_time,
                "false_isolations": false_isolations,
                "preserved_functionality": preserved_functionality,
                "delivery_ratio": delivery_ratio,
                "communication_attempted": communication_attempted,
                "communication_delivered": communication_delivered,
                "communication_lost": communication_lost,
                "communication_bandwidth_dropped": communication_bandwidth_dropped,
                "honest_majority_with_sybils": bool(cfg.total_agents > 2 * cfg.total_byzantine),
                "completed_steps": completed_steps,
            },
            "configuration": {**asdict(cfg), "effective_agent_count": cfg.total_agents, "effective_byzantine_count": cfg.total_byzantine},
            "scenario": scenario,
            "run_index": run_index,
            "partial": completed_steps < cfg.n_steps,
        }
    return rows, trajectory, details


def simulate_run(cfg: ExperimentConfig, scenario: str, run_index: int, scenario_index: int) -> list[dict[str, float | int | str]]:
    rows, _, _ = _simulate_run_core(cfg, scenario, run_index, scenario_index, collect_trajectory=False)
    return rows


def simulate_trace(
    cfg: ExperimentConfig,
    scenario: str,
    run_index: int = 0,
    scenario_index: int = 0,
    progress_callback: ProgressCallback | None = None,
    stop_checker: StopChecker | None = None,
) -> dict[str, object]:
    _, _, details = _simulate_run_core(
        cfg,
        scenario,
        run_index,
        scenario_index,
        collect_trajectory=True,
        collect_details=True,
        progress_callback=progress_callback,
        stop_checker=stop_checker,
    )
    assert details is not None
    return details


def _worker_run(task: tuple[str, ExperimentConfig, str, int, int, bool]) -> tuple[str, int, list[dict[str, Any]], list[dict[str, Any]]]:
    tag, cfg, scenario, run_index, scenario_index, collect_trajectory = task
    rows, trajectory, _ = _simulate_run_core(
        cfg,
        scenario,
        run_index,
        scenario_index,
        collect_trajectory=collect_trajectory,
    )
    return tag, run_index, rows, trajectory


def resolved_worker_count(cfg: ExperimentConfig, total_tasks: int) -> int:
    if cfg.parallel_workers > 0:
        return min(cfg.parallel_workers, max(total_tasks, 1))
    cpu = os.cpu_count() or 2
    return min(max(cpu - 1, 1), max(total_tasks, 1), 8)


def _iter_task_results(
    tasks: list[tuple[str, ExperimentConfig, str, int, int, bool]],
    workers: int,
    stop_checker: StopChecker | None,
) -> Iterator[tuple[str, int, list[dict[str, Any]], list[dict[str, Any]]]]:
    if workers <= 1 or len(tasks) <= 1:
        for task in tasks:
            if stop_checker and stop_checker():
                break
            yield _worker_run(task)
        return

    # Spawn is used on every platform to avoid inheriting threads, open files
    # and numerical-library state into workers. This is slower to start than
    # fork, but deterministic and safe for the HTTP server and Python 3.13+.
    context = mp.get_context("spawn")
    pool = context.Pool(processes=workers)
    try:
        iterator = pool.imap_unordered(_worker_run, tasks, chunksize=1)
        for result in iterator:
            yield result
            if stop_checker and stop_checker():
                pool.terminate()
                return
        pool.close()
    finally:
        pool.join()


def run_experiment(cfg: ExperimentConfig) -> pd.DataFrame:
    records: list[dict[str, float | int | str]] = []
    for scenario_index, scenario in enumerate(cfg.scenarios):
        tasks = [(f"{scenario_index}:{run_index}", cfg, scenario, run_index, scenario_index, False) for run_index in range(cfg.n_runs)]
        for _, _, rows, _ in _iter_task_results(tasks, resolved_worker_count(cfg, len(tasks)), None):
            records.extend(rows)
    frame = pd.DataFrame.from_records(records)
    if not frame.empty:
        frame = frame.sort_values(["scenario", "run", "method"], kind="stable").reset_index(drop=True)
    return frame


def summarize(raw: pd.DataFrame) -> pd.DataFrame:
    metrics = [
        "probability_correct",
        "mae_to_truth",
        "rmse_to_truth",
        "bias",
        "coverage95",
        "consensus_error",
        "detection_rate",
        "mean_detection_time_steps",
        "false_isolations",
        "preserved_functionality",
        "communication_messages",
        "communication_attempted",
        "communication_lost",
        "communication_bandwidth_dropped",
        "delivery_ratio",
        "aggregation_seconds",
        "completed_steps",
    ]
    available = [metric for metric in metrics if metric in raw.columns]
    grouped = raw.groupby(["scenario", "method"], sort=False)[available]
    mean = grouped.mean().add_suffix("_mean")
    std = grouped.std(ddof=1).fillna(0.0).add_suffix("_std")
    count = grouped.count()
    ci = 1.96 * grouped.std(ddof=1).fillna(0.0) / np.sqrt(count.clip(lower=1))
    ci.columns = [f"{name}_ci95" for name in ci.columns]
    return pd.concat([mean, std, ci], axis=1).reset_index()


def _trajectory_statistics(trajectories: list[list[dict[str, Any]]], cfg: ExperimentConfig) -> list[dict[str, Any]]:
    if not trajectories:
        return []
    minimum_steps = min(len(item) for item in trajectories)
    if minimum_steps == 0:
        return []
    count = len(trajectories)
    matrices = {
        method: np.asarray([[row[method] for row in trajectory[:minimum_steps]] for trajectory in trajectories], dtype=float)
        for method in METHODS
    }
    active_matrix = np.asarray([[row["active_agents"] for row in trajectory[:minimum_steps]] for trajectory in trajectories], dtype=float)
    available_matrix = np.asarray([[row["available_agents"] for row in trajectory[:minimum_steps]] for trajectory in trajectories], dtype=float)
    component_matrix = np.asarray([[row["largest_component"] for row in trajectory[:minimum_steps]] for trajectory in trajectories], dtype=float)

    result: list[dict[str, Any]] = []
    for step in range(minimum_steps):
        item: dict[str, Any] = {
            "step": step + 1,
            "truth": float(cfg.desired_action),
            "run_count": count,
            "active_agents_mean": float(np.mean(active_matrix[:, step])),
            "active_agents_std": float(np.std(active_matrix[:, step], ddof=1)) if count > 1 else 0.0,
            "available_agents_mean": float(np.mean(available_matrix[:, step])),
            "largest_component_mean": float(np.mean(component_matrix[:, step])),
            "tolerance_band": [
                float(cfg.desired_action - cfg.correctness_tolerance),
                float(cfg.desired_action + cfg.correctness_tolerance),
            ],
        }
        for method in METHODS:
            values = matrices[method][:, step]
            mean = float(np.mean(values))
            std = float(np.std(values, ddof=1)) if count > 1 else 0.0
            q05, q25, q50, q75, q95 = [float(value) for value in np.quantile(values, [0.05, 0.25, 0.50, 0.75, 0.95])]
            item.update(
                {
                    f"{method}_mean": mean,
                    f"{method}_std": std,
                    f"{method}_band1": [mean - std, mean + std],
                    f"{method}_band2": [mean - 2.0 * std, mean + 2.0 * std],
                    f"{method}_q05": q05,
                    f"{method}_q25": q25,
                    f"{method}_median": q50,
                    f"{method}_q75": q75,
                    f"{method}_q95": q95,
                    f"{method}_band50": [q25, q75],
                    f"{method}_band90": [q05, q95],
                }
            )
        result.append(item)
    return result


def paired_bootstrap_differences(raw: pd.DataFrame, cfg: ExperimentConfig) -> list[dict[str, Any]]:
    if raw.empty:
        return []
    metrics = ["rmse_to_truth", "mae_to_truth", "probability_correct", "consensus_error"]
    result: list[dict[str, Any]] = []
    rng = np.random.default_rng(np.random.SeedSequence([cfg.seed, 99173]))
    proposed = "proposed_robust"
    for metric in metrics:
        pivot = raw.pivot_table(index="run", columns="method", values=metric, aggfunc="first")
        for baseline in ("arithmetic_mean", "trust_weighted_mean"):
            if proposed not in pivot or baseline not in pivot:
                continue
            pair = pivot[[proposed, baseline]].dropna()
            if pair.empty:
                continue
            raw_difference = pair[proposed].to_numpy() - pair[baseline].to_numpy()
            benefit = -raw_difference if metric in LOWER_IS_BETTER_METRICS else raw_difference
            n = benefit.size
            if n == 1:
                boot = np.repeat(benefit, cfg.bootstrap_samples)
            else:
                indices = rng.integers(0, n, size=(cfg.bootstrap_samples, n))
                boot = benefit[indices].mean(axis=1)
            low, high = np.quantile(boot, [0.025, 0.975])
            result.append(
                {
                    "metric": metric,
                    "baseline": baseline,
                    "proposed": proposed,
                    "n_pairs": int(n),
                    "raw_difference_mean": float(np.mean(raw_difference)),
                    "benefit_mean": float(np.mean(benefit)),
                    "benefit_ci_low": float(low),
                    "benefit_ci_high": float(high),
                    "probability_better": float(np.mean(boot > 0.0)),
                    "significant": bool(low > 0.0 or high < 0.0),
                    "direction": "positive_benefit_means_proposed_is_better",
                    "bootstrap_samples": cfg.bootstrap_samples,
                }
            )
    return result


def distribution_payload(raw: pd.DataFrame) -> list[dict[str, Any]]:
    metrics = ["rmse_to_truth", "mae_to_truth", "probability_correct", "detection_rate", "mean_detection_time_steps"]
    result: list[dict[str, Any]] = []
    for method in METHODS:
        part = raw[raw["method"] == method]
        for metric in metrics:
            values = part[metric].dropna().to_numpy(dtype=float)
            if values.size == 0:
                continue
            q05, q25, q50, q75, q95 = np.quantile(values, [0.05, 0.25, 0.50, 0.75, 0.95])
            if np.allclose(values.min(), values.max()):
                center = float(values[0])
                width = max(abs(center) * 0.05, 0.01)
                edges = np.linspace(center - width, center + width, 6)
                counts, edges = np.histogram(values, bins=edges)
            else:
                bins = min(24, max(6, int(round(math.sqrt(values.size)))))
                counts, edges = np.histogram(values, bins=bins)
            histogram = [
                {
                    "x0": float(edges[index]),
                    "x1": float(edges[index + 1]),
                    "center": float((edges[index] + edges[index + 1]) / 2.0),
                    "count": int(counts[index]),
                    "label": f"{edges[index]:.3f}–{edges[index + 1]:.3f}",
                }
                for index in range(len(counts))
            ]
            result.append(
                {
                    "method": method,
                    "metric": metric,
                    "count": int(values.size),
                    "min": float(values.min()),
                    "q05": float(q05),
                    "q25": float(q25),
                    "median": float(q50),
                    "q75": float(q75),
                    "q95": float(q95),
                    "max": float(values.max()),
                    "mean": float(values.mean()),
                    "std": float(values.std(ddof=1)) if values.size > 1 else 0.0,
                    "histogram": histogram,
                }
            )
    return result


def _save_checkpoint(path: Path | None, payload: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, default=_json_default), encoding="utf-8")
    temporary.replace(path)


def _load_checkpoint(path: Path | None, signature: str) -> dict[str, Any] | None:
    if path is None or not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if payload.get("signature") == signature else None


def run_monte_carlo_analysis(
    cfg: ExperimentConfig,
    scenario: str,
    progress_callback: ProgressCallback | None = None,
    stop_checker: StopChecker | None = None,
    checkpoint_path: Path | None = None,
) -> dict[str, Any]:
    local = replace(cfg, scenarios=(scenario,))
    signature = stable_signature({"kind": "monte_carlo_v3", "config": asdict(local), "scenario": scenario})
    checkpoint = _load_checkpoint(checkpoint_path, signature)
    completed: dict[int, dict[str, Any]] = {}
    if checkpoint:
        for item in checkpoint.get("completed", []):
            completed[int(item["run_index"])] = item

    pending = [index for index in range(local.n_runs) if index not in completed]
    tasks = [(str(index), local, scenario, index, 0, True) for index in pending]
    workers = resolved_worker_count(local, len(tasks))
    started = time.perf_counter()
    resumed_count = len(completed)
    _emit_progress(
        progress_callback,
        stage="monte_carlo",
        completed=resumed_count,
        total=local.n_runs,
        started=started,
        message=f"Запуск в {workers} параллельных процессах" if workers > 1 else "Последовательный расчет",
        resumed=resumed_count,
    )

    checkpoint_interval = max(1, local.n_runs // 20)
    for _tag, run_index, rows, trajectory in _iter_task_results(tasks, workers, stop_checker):
        completed[run_index] = {"run_index": run_index, "rows": rows, "trajectory": trajectory}
        count = len(completed)
        _emit_progress(
            progress_callback,
            stage="monte_carlo",
            completed=count,
            total=local.n_runs,
            started=started,
            message="Расчет независимых прогонов и траекторий",
            resumed=resumed_count,
        )
        if count % checkpoint_interval == 0 or count == local.n_runs:
            _save_checkpoint(
                checkpoint_path,
                {"version": 3, "signature": signature, "completed": list(completed.values())},
            )
        if stop_checker and stop_checker():
            break

    ordered = [completed[index] for index in sorted(completed)]
    records = [row for item in ordered for row in item["rows"]]
    trajectories = [item["trajectory"] for item in ordered if item["trajectory"]]
    raw = pd.DataFrame.from_records(records)
    partial = len(completed) < local.n_runs
    if not partial and checkpoint_path and checkpoint_path.exists():
        checkpoint_path.unlink(missing_ok=True)
    elif partial:
        _save_checkpoint(checkpoint_path, {"version": 3, "signature": signature, "completed": ordered})

    summary = summarize(raw).to_dict(orient="records") if not raw.empty else []
    trajectory_statistics = _trajectory_statistics(trajectories, local)
    return {
        "summary": summary,
        "runs": raw.to_dict(orient="records") if not raw.empty else [],
        "trajectory_statistics": trajectory_statistics,
        "trajectory_statistics_definition": {
            "center": "sample_mean_and_median",
            "dispersion": "sample_standard_deviation",
            "ddof": 1,
            "run_count": len(completed),
            "requested_run_count": local.n_runs,
            "bands": ["mean ± 1s", "mean ± 2s", "P25–P75", "P5–P95"],
            "quantiles": [0.05, 0.25, 0.50, 0.75, 0.95],
        },
        "bootstrap_comparisons": paired_bootstrap_differences(raw, local) if not raw.empty else [],
        "distributions": distribution_payload(raw) if not raw.empty else [],
        "configuration": {**asdict(local), "effective_agent_count": local.total_agents, "effective_byzantine_count": local.total_byzantine},
        "scenario": scenario,
        "partial": partial,
        "completed_runs": len(completed),
        "requested_runs": local.n_runs,
        "resumed_runs": resumed_count,
        "parallel_workers_used": workers,
    }


def run_experiment_with_trajectory_statistics(cfg: ExperimentConfig) -> tuple[pd.DataFrame, dict[str, list[dict[str, object]]]]:
    records: list[dict[str, Any]] = []
    statistics: dict[str, list[dict[str, object]]] = {}
    for scenario in cfg.scenarios:
        result = run_monte_carlo_analysis(replace(cfg, scenarios=(scenario,)), scenario)
        records.extend(result["runs"])
        statistics[scenario] = result["trajectory_statistics"]
    return pd.DataFrame.from_records(records), statistics


def run_one_factor_sensitivity(
    cfg: ExperimentConfig,
    scenario: str,
    f_values: Iterable[int],
    progress_callback: ProgressCallback | None = None,
    stop_checker: StopChecker | None = None,
    checkpoint_path: Path | None = None,
) -> dict[str, Any]:
    valid = sorted({int(value) for value in f_values if 0 <= int(value) < cfg.n_agents / 2})
    signature = stable_signature({"kind": "one_factor_v3", "config": asdict(cfg), "scenario": scenario, "f_values": valid})
    checkpoint = _load_checkpoint(checkpoint_path, signature)
    completed: dict[str, dict[str, Any]] = {}
    if checkpoint:
        completed = {str(item["task_id"]): item for item in checkpoint.get("completed", [])}

    task_specs: list[tuple[str, ExperimentConfig, int]] = []
    for f in valid:
        local = replace(
            cfg,
            n_byzantine=f,
            trim_each_side=f,
            n_runs=cfg.n_sensitivity_runs,
            scenarios=(scenario,),
        )
        for run_index in range(cfg.n_sensitivity_runs):
            task_id = f"{f}:{run_index}"
            if task_id not in completed:
                task_specs.append((task_id, local, run_index))
    tasks = [(task_id, local, scenario, run_index, 0, False) for task_id, local, run_index in task_specs]
    workers = resolved_worker_count(cfg, len(tasks))
    started = time.perf_counter()
    total = len(valid) * cfg.n_sensitivity_runs
    resumed = len(completed)
    _emit_progress(progress_callback, stage="sensitivity", completed=resumed, total=total, started=started, message="Однофакторный анализ", resumed=resumed)

    for task_id, run_index, rows, _ in _iter_task_results(tasks, workers, stop_checker):
        local_cfg = next(local for candidate_id, local, candidate_run in task_specs if candidate_id == task_id and candidate_run == run_index)
        f = local_cfg.n_byzantine
        for row in rows:
            row["n_byzantine"] = int(f)
        completed[task_id] = {"task_id": task_id, "rows": rows}
        count = len(completed)
        _emit_progress(progress_callback, stage="sensitivity", completed=count, total=total, started=started, message="Варьирование числа нарушителей", resumed=resumed)
        if count % max(1, total // 20) == 0:
            _save_checkpoint(checkpoint_path, {"version": 3, "signature": signature, "completed": list(completed.values())})
        if stop_checker and stop_checker():
            break

    records = [row for item in completed.values() for row in item["rows"]]
    raw = pd.DataFrame.from_records(records)
    partial = len(completed) < total
    if not partial and checkpoint_path:
        checkpoint_path.unlink(missing_ok=True)
    else:
        _save_checkpoint(checkpoint_path, {"version": 3, "signature": signature, "completed": list(completed.values())})

    if raw.empty:
        aggregated: list[dict[str, Any]] = []
    else:
        aggregated = (
            raw.groupby(["n_byzantine", "method"], as_index=False)
            .agg(
                probability_correct=("probability_correct", "mean"),
                rmse=("rmse_to_truth", "mean"),
                detection_rate=("detection_rate", "mean"),
                delivery_ratio=("delivery_ratio", "mean"),
            )
            .to_dict(orient="records")
        )
    return {
        "mode": "one_factor",
        "sensitivity": aggregated,
        "raw_runs": records,
        "configuration": {**asdict(cfg), "effective_agent_count": cfg.total_agents},
        "partial": partial,
        "completed_tasks": len(completed),
        "requested_tasks": total,
        "parallel_workers_used": workers,
    }


def default_factor_ranges(cfg: ExperimentConfig) -> dict[str, tuple[float, float]]:
    max_f = max((cfg.n_agents - 1) // 2, 0)
    low_f = max(0, int(round(cfg.n_byzantine * 0.5)))
    high_f = min(max_f, max(low_f + 1, int(round(cfg.n_byzantine * 1.5))))
    return {
        "n_byzantine": (float(low_f), float(high_f)),
        "isolation_threshold": (max(0.05, cfg.isolation_threshold - 0.10), min(0.90, cfg.isolation_threshold + 0.10)),
        "trust_window_steps": (float(max(2, int(round(cfg.trust_window_steps * 0.60)))), float(min(100, max(3, int(round(cfg.trust_window_steps * 1.40)))))),
        "forgetting_factor": (max(0.60, cfg.forgetting_factor - 0.05), min(1.0, cfg.forgetting_factor + 0.04)),
        "attack_intensity_multiplier": (0.60, 1.40),
        "honest_noise_sigma": (max(0.01, cfg.honest_noise_sigma * 0.60), min(2.0, cfg.honest_noise_sigma * 1.40)),
    }


def _apply_factor_levels(
    cfg: ExperimentConfig,
    factors: list[str],
    ranges: dict[str, tuple[float, float]],
    coded: tuple[int, ...],
    scenario: str,
) -> tuple[ExperimentConfig, dict[str, float]]:
    values = {factor: ranges[factor][1 if level > 0 else 0] for factor, level in zip(factors, coded)}
    kwargs: dict[str, Any] = {}
    for factor, value in values.items():
        if factor == "attack_intensity_multiplier":
            multiplier = float(value)
            kwargs.update(
                static_bias=cfg.static_bias * multiplier,
                subtle_bias=cfg.subtle_bias * multiplier,
                collusion_bias=cfg.collusion_bias * multiplier,
            )
        elif factor in {"n_byzantine", "trust_window_steps"}:
            kwargs[factor] = int(round(value))
        else:
            kwargs[factor] = float(value)
    if "n_byzantine" in kwargs:
        kwargs["trim_each_side"] = int(kwargs["n_byzantine"])
    local = replace(cfg, **kwargs, n_runs=cfg.factorial_runs_per_point, scenarios=(scenario,))
    local.validate()
    return local, values


def run_factorial_sensitivity(
    cfg: ExperimentConfig,
    scenario: str,
    factor_ranges: dict[str, tuple[float, float]] | None = None,
    progress_callback: ProgressCallback | None = None,
    stop_checker: StopChecker | None = None,
    checkpoint_path: Path | None = None,
) -> dict[str, Any]:
    ranges = default_factor_ranges(cfg)
    if factor_ranges:
        for key, value in factor_ranges.items():
            if key in ranges and len(value) == 2:
                ranges[key] = (float(value[0]), float(value[1]))
    factors = list(ranges)
    combinations = list(itertools.product((-1, 1), repeat=len(factors)))
    if len(combinations) > cfg.factorial_max_points:
        rng = np.random.default_rng(np.random.SeedSequence([cfg.seed, 541]))
        chosen = np.sort(rng.choice(len(combinations), size=cfg.factorial_max_points, replace=False))
        combinations = [combinations[int(index)] for index in chosen]

    designs: list[dict[str, Any]] = []
    for design_index, coded in enumerate(combinations):
        local, values = _apply_factor_levels(cfg, factors, ranges, coded, scenario)
        designs.append({"design_index": design_index, "coded": coded, "values": values, "config": local})

    signature = stable_signature(
        {
            "kind": "factorial_v3",
            "config": asdict(cfg),
            "scenario": scenario,
            "factors": factors,
            "ranges": ranges,
            "combinations": combinations,
        }
    )
    checkpoint = _load_checkpoint(checkpoint_path, signature)
    completed: dict[str, dict[str, Any]] = {}
    if checkpoint:
        completed = {str(item["task_id"]): item for item in checkpoint.get("completed", [])}

    task_specs: list[tuple[str, dict[str, Any], int]] = []
    for design in designs:
        for run_index in range(cfg.factorial_runs_per_point):
            task_id = f"{design['design_index']}:{run_index}"
            if task_id not in completed:
                task_specs.append((task_id, design, run_index))
    tasks = [(spec[0], spec[1]["config"], scenario, spec[2], spec[1]["design_index"], False) for spec in task_specs]
    workers = resolved_worker_count(cfg, len(tasks))
    total = len(designs) * cfg.factorial_runs_per_point
    resumed = len(completed)
    started = time.perf_counter()
    _emit_progress(progress_callback, stage="factorial", completed=resumed, total=total, started=started, message="Двухуровневый факторный план", resumed=resumed)

    design_by_task = {task_id: design for task_id, design, _ in task_specs}
    for task_id, run_index, rows, _ in _iter_task_results(tasks, workers, stop_checker):
        design = design_by_task[task_id]
        for row in rows:
            row["design_index"] = design["design_index"]
            row.update({f"factor_{key}": value for key, value in design["values"].items()})
            row.update({f"coded_{factor}": level for factor, level in zip(factors, design["coded"])})
        completed[task_id] = {"task_id": task_id, "rows": rows}
        count = len(completed)
        _emit_progress(progress_callback, stage="factorial", completed=count, total=total, started=started, message="Расчет точек факторного плана", resumed=resumed)
        if count % max(1, total // 20) == 0:
            _save_checkpoint(checkpoint_path, {"version": 3, "signature": signature, "completed": list(completed.values())})
        if stop_checker and stop_checker():
            break

    records = [row for item in completed.values() for row in item["rows"]]
    raw = pd.DataFrame.from_records(records)
    partial = len(completed) < total
    if not partial and checkpoint_path:
        checkpoint_path.unlink(missing_ok=True)
    else:
        _save_checkpoint(checkpoint_path, {"version": 3, "signature": signature, "completed": list(completed.values())})

    if raw.empty:
        design_summary = pd.DataFrame()
    else:
        design_summary = (
            raw.groupby(["design_index", "method"], as_index=False)
            .agg(
                probability_correct=("probability_correct", "mean"),
                rmse_to_truth=("rmse_to_truth", "mean"),
                detection_rate=("detection_rate", "mean"),
                delivery_ratio=("delivery_ratio", "mean"),
            )
        )
        design_lookup = {design["design_index"]: design for design in designs}
        for factor in factors:
            design_summary[f"factor_{factor}"] = design_summary["design_index"].map(lambda index: design_lookup[int(index)]["values"][factor])
            design_summary[f"coded_{factor}"] = design_summary["design_index"].map(lambda index: design_lookup[int(index)]["coded"][factors.index(factor)])

    effects: list[dict[str, Any]] = []
    interactions: list[dict[str, Any]] = []
    proposed = design_summary[design_summary["method"] == "proposed_robust"] if not design_summary.empty else pd.DataFrame()
    for metric in ("probability_correct", "rmse_to_truth", "detection_rate", "delivery_ratio"):
        if proposed.empty:
            continue
        for factor in factors:
            high = proposed[proposed[f"coded_{factor}"] > 0][metric]
            low = proposed[proposed[f"coded_{factor}"] < 0][metric]
            if high.empty or low.empty:
                continue
            raw_effect = float(high.mean() - low.mean())
            benefit_effect = -raw_effect if metric in LOWER_IS_BETTER_METRICS or metric == "rmse_to_truth" else raw_effect
            effects.append(
                {
                    "metric": metric,
                    "factor": factor,
                    "effect_high_minus_low": raw_effect,
                    "benefit_effect": benefit_effect,
                    "low_value": ranges[factor][0],
                    "high_value": ranges[factor][1],
                }
            )
        for first, second in itertools.combinations(factors, 2):
            code = proposed[f"coded_{first}"] * proposed[f"coded_{second}"]
            high = proposed[code > 0][metric]
            low = proposed[code < 0][metric]
            if high.empty or low.empty:
                continue
            raw_effect = float(high.mean() - low.mean())
            interactions.append(
                {
                    "metric": metric,
                    "factors": [first, second],
                    "effect": raw_effect,
                    "absolute_effect": abs(raw_effect),
                }
            )
    interactions.sort(key=lambda row: row["absolute_effect"], reverse=True)

    return {
        "mode": "factorial",
        "factors": factors,
        "factor_ranges": {key: list(value) for key, value in ranges.items()},
        "design_points": design_summary.to_dict(orient="records") if not design_summary.empty else [],
        "main_effects": effects,
        "interaction_effects": interactions[:30],
        "raw_runs": records,
        "configuration": {**asdict(cfg), "effective_agent_count": cfg.total_agents},
        "partial": partial,
        "completed_tasks": len(completed),
        "requested_tasks": total,
        "parallel_workers_used": workers,
    }


def run_sensitivity(cfg: ExperimentConfig) -> pd.DataFrame:
    maximum = (cfg.n_agents - 1) // 2
    f_values = sorted(set(value for value in (0, 2, 4, 6, 8, maximum) if value <= maximum))
    result = run_one_factor_sensitivity(cfg, "static_bias", f_values)
    return pd.DataFrame.from_records(result["raw_runs"])


def plot_summary(summary: pd.DataFrame, output: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    labels = {
        "arithmetic_mean": "Arithmetic mean",
        "trust_weighted_mean": "Trust-weighted mean",
        "proposed_robust": "Proposed robust",
    }
    scenarios = list(dict.fromkeys(summary["scenario"]))
    x = np.arange(len(scenarios))
    width = 0.25
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), constrained_layout=True)
    indexed = summary.set_index(["scenario", "method"])
    for offset, method in enumerate(METHODS):
        part = indexed.loc[[(scenario, method) for scenario in scenarios]]
        axes[0].bar(x + (offset - 1) * width, part["probability_correct_mean"], width, yerr=part["probability_correct_ci95"], capsize=2, label=labels[method])
        axes[1].bar(x + (offset - 1) * width, part["rmse_to_truth_mean"], width, yerr=part["rmse_to_truth_ci95"], capsize=2, label=labels[method])
    axes[0].set_title("Probability of a correct decision")
    axes[0].set_ylim(0, 1.05)
    axes[1].set_title("RMSE relative to the desired action")
    for axis in axes:
        axis.set_xticks(x, scenarios, rotation=18, ha="right")
        axis.grid(axis="y", alpha=0.25)
    axes[0].legend(loc="lower left", fontsize=8)
    fig.savefig(output / "comparison.png", dpi=200)
    plt.close(fig)


def plot_sensitivity(raw: pd.DataFrame, output: Path, n_agents: int) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    grouped = raw.groupby(["n_byzantine", "method"])["probability_correct"].mean().unstack()
    fig, ax = plt.subplots(figsize=(8, 5), constrained_layout=True)
    for method in METHODS:
        if method in grouped:
            ax.plot(grouped.index / n_agents, grouped[method], marker="o", label=method)
    ax.set_xlabel("Byzantine fraction f/N")
    ax.set_ylabel("Probability of a correct decision")
    ax.set_ylim(0, 1.05)
    ax.grid(alpha=0.25)
    ax.legend(fontsize=8)
    fig.savefig(output / "sensitivity_by_f.png", dpi=200)
    plt.close(fig)


def write_manifest(cfg: ExperimentConfig, output: Path, elapsed: float) -> None:
    payload = {
        "configuration": asdict(cfg),
        "effective_agent_count": cfg.total_agents,
        "effective_byzantine_count": cfg.total_byzantine,
        "elapsed_seconds": elapsed,
        "methods": METHODS,
        "scenarios": cfg.scenarios,
        "version": 3,
    }
    (output / "manifest.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("config.json"))
    parser.add_argument("--output", type=Path, default=Path("results"))
    parser.add_argument("--sensitivity", action="store_true")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    cfg = ExperimentConfig.from_json(args.config)
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    raw = run_experiment(cfg)
    summary = summarize(raw)
    raw.to_csv(args.output / "raw_runs.csv", index=False, sep=";", encoding="utf-8-sig")
    summary.to_csv(args.output / "summary.csv", index=False, sep=";", encoding="utf-8-sig")
    plot_summary(summary, args.output)
    if args.sensitivity:
        sensitivity = run_sensitivity(cfg)
        sensitivity.to_csv(args.output / "sensitivity_raw.csv", index=False, sep=";", encoding="utf-8-sig")
        plot_sensitivity(sensitivity, args.output, cfg.n_agents)
    write_manifest(cfg, args.output, time.perf_counter() - started)
    return 0


if __name__ == "__main__":
    mp.freeze_support()
    raise SystemExit(main())
