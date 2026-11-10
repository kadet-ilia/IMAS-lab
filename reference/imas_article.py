#!/usr/bin/env python3
"""Independent Python reference for the synthetic imas-article-1.0.0 kernel.

Protocol: JSON on stdin {"config": {...}, "run": 0}; emits a compact JSON
comparison snapshot. This is deliberately not a Python-to-JS code translation.
All exogenous streams are independently keyed to enable exact input parity.
"""
import json
import math
import sys

METHODS = ("arithmetic_mean", "trust_mean", "trimmed_mean", "trust_trimmed_mean")
ACTIONS = ("verification_priority", "reauthenticate", "limit_session", "monitor", "isolate_segment")


def stable_seed(*keys):
    h = 2166136261
    for part in keys:
        for ch in str(part):
            h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
        h = ((h ^ 255) * 16777619) & 0xffffffff
    return h or 1


class RandomStream:
    def __init__(self, *keys):
        self.s = stable_seed(*keys)
        self.spare = None

    def uniform(self):
        self.s ^= (self.s << 13) & 0xffffffff
        self.s ^= self.s >> 17
        self.s ^= (self.s << 5) & 0xffffffff
        self.s &= 0xffffffff
        return self.s / 4294967296

    def normal(self):
        if self.spare is not None:
            z, self.spare = self.spare, None
            return z
        u, v = max(self.uniform(), 1e-12), self.uniform()
        radius, angle = math.sqrt(-2 * math.log(u)), 2 * math.pi * v
        self.spare = radius * math.sin(angle)
        return radius * math.cos(angle)

    def integer(self, count):
        return int(self.uniform() * count)


def avg(values):
    return sum(values) / len(values) if values else None


def med(values):
    values = sorted(values)
    if not values:
        return None
    n = len(values)
    return values[n // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2


def clamp(x, a=0., b=1.):
    return min(b, max(a, x))


def length(vector):
    return math.sqrt(sum(x * x for x in vector))


def get_bad(c, run):
    agents = list(range(c["n_agents"]))
    gen = RandomStream(c["seed"], run, "attack", "membership")
    for i in range(len(agents) - 1, 0, -1):
        j = gen.integer(i + 1)
        agents[i], agents[j] = agents[j], agents[i]
    return set(agents[:c["n_byzantine"]])


def active(c, t, attacked):
    if not attacked or c["n_byzantine"] == 0 or c["attack_shift"] == 0 or t < c["attack_start_step"]:
        return False
    return c["attack_scenario"] != "on_off" or ((t - c["attack_start_step"]) % c["on_off_period"]) < c["on_off_attack_steps"]


def observe(c, run, t, bad, attacked):
    attack = active(c, t, attacked)
    truth = [x + c["reference_drift"] * t * (-1 if k % 2 else 1)
             for k, x in enumerate(c["reference_vector"])]
    msgs = []
    for i in range(c["n_agents"]):
        noise = RandomStream(c["seed"], run, "noise", t, i)
        mask = RandomStream(c["seed"], run, "observation", i)
        message = [x + c["honest_noise_sigma"] * noise.normal()
                   if mask.uniform() < c["observation_fraction"] else None for x in truth]
        if attack and i in bad:
            shift = 0 if c["attack_scenario"] == "trust" else (c["subtle_shift"]
                    if c["attack_scenario"] == "subtle" else c["attack_shift"])
            message = [None if x is None else x + shift * c["attack_vector"][k]
                       for k, x in enumerate(message)]
        msgs.append(message)
    return attack, truth, msgs


def evidence(c, run, t, bad, isolated, previous, msgs, attack):
    n = c["n_agents"]
    q = [[None for _ in range(n)] for _ in range(n)]
    for i in range(n):
        if isolated[i]:
            continue
        for j in range(n):
            if i == j or isolated[j]:
                continue
            observed = [k for k in range(c["decision_dim"]) if msgs[j][k] is not None]
            if not observed:
                continue
            if attack and i in bad and c["manipulate_reputation"]:
                q[i][j] = 1 if j in bad else c["reputation_low"]
                continue
            if c["quality_mode"] == "synthetic":
                value = (c["mask_quality"] if c["attack_scenario"] == "mask"
                         else c["byzantine_quality"]) if (attack and j in bad) else c["honest_quality"]
                gen = RandomStream(c["seed"], run, "quality", t, i, j)
                q[i][j] = clamp(value + c["quality_sigma"] * gen.normal())
            else:
                common = [k for k in observed if any(m != j and m != i and not isolated[m]
                                                    and msgs[m][k] is not None for m in range(n))]
                if not common:
                    continue
                diffs = []
                for k in common:
                    comparison = [msgs[m][k] for m in range(n)
                                  if m != j and m != i and not isolated[m] and msgs[m][k] is not None]
                    diffs.append(msgs[j][k] - med(comparison))
                consistency = 1 - min(1, length(diffs) / c["consistency_scale"])
                temporal = ([] if previous is None else
                            [msgs[j][k] - previous[j][k] for k in common if previous[j][k] is not None])
                stability = 1 - min(1, length(temporal) / c["stability_scale"]) if temporal else 1
                b = c["quality_weights"]
                q[i][j] = clamp(b[0] * consistency + b[1] * stability + b[2])
    return q


def update_trust(c, st, q):
    live = [j for j, flag in enumerate(st["isolated"]) if not flag]
    old_tau = st["tauPrev"][:]
    for i in live:
        for j in live:
            if i != j and q[i][j] is not None:
                st["D"][i][j] = clamp(c["trust_memory"] * st["D"][i][j]
                                        + (1-c["trust_memory"]) * q[i][j])
    for j in live:
        raters = [i for i in live if i != j and q[i][j] is not None]
        if not raters:
            continue
        weights = [old_tau[i] + c["reputation_eps"] for i in raters]
        reputation = sum(w * st["D"][i][j] for w, i in zip(weights, raters)) / sum(weights)
        st["E"][j] = clamp(reputation)
        for i in raters:
            st["T"][i][j] = clamp(c["trust_alpha"] * st["D"][i][j]
                                + (1-c["trust_alpha"]) * st["E"][j])
        st["tau"][j] = clamp(med([st["T"][i][j] for i in raters]))
    st["tauPrev"] = st["tau"][:]


def isolate(c, st, q, t, attack, bad):
    n = c["n_agents"]
    for j in range(n):
        if st["isolated"][j]:
            continue
        live = [i for i in range(n) if not st["isolated"][i]]
        values = [q[i][j] for i in live if i != j and q[i][j] is not None]
        quality = med(values)
        if quality is None:
            continue
        st["below"][j] = st["below"][j] + 1 if st["tau"][j] < c["isolation_threshold"] else 0
        if c["cusum_enabled"]:
            st["z"][j] = max(0, st["z"][j] + c["cusum_mu"] - quality)
        reason = ("threshold" if st["below"][j] >= c["isolation_patience"] else
                  "cusum" if c["cusum_enabled"] and st["z"][j] > c["cusum_limit"] else None)
        if reason:
            st["isolated"][j] = True
            st["events"].append(dict(agent=j, step=t, attackTick=t-c["attack_start_step"]+1,
                                     reason=reason, malicious=j in bad, duringAttack=attack))
    return [j for j in range(n) if not st["isolated"][j]
            and st["tau"][j] >= c["admission_threshold"]]


def choose(c, st, run, t, attack, bad, admitted):
    utility = c["action_utilities"]["attack" if attack else "normal"]
    if not admitted:
        return dict(action="refusal", automatic=False, correct=False, safe=False)
    if len(admitted) < c["minimum_admitted"]:
        return dict(action="operator", automatic=False, correct=False, safe=True)
    scores = []
    for action in range(4):  # fifth (irreversible) action needs operator authorization
        total, mass = 0., 0.
        for i in admitted:
            noise = RandomStream(c["seed"], run, "scores", t, i, action).normal()
            distortion = (c["score_attack_shift"] * (1 if action == 0 else -1)
                          if attack and i in bad else 0)
            w = st["tau"][i]
            total += w * (utility[action] + c["score_noise_sigma"] * noise + distortion)
            mass += w
        scores.append((total / mass if mass else -math.inf, action))
    scores.sort(key=lambda row: (-row[0], row[1]))
    if scores[0][0]-scores[1][0] < c["decision_margin"]:
        return dict(action="operator", automatic=False, correct=False, safe=True)
    chosen = scores[0][1]
    optimal = max(range(4), key=lambda j: utility[j])
    return dict(action=ACTIONS[chosen], automatic=True, correct=chosen==optimal, safe=True)


def aggregate(c, st, msgs, truth, admitted):
    out = {}
    live = [i for i, bad in enumerate(st["isolated"]) if not bad]
    for method in METHODS:
        eligible = admitted if method in ("trust_mean", "trust_trimmed_mean") else live
        theta = st["theta"].get(method, [0.] * c["decision_dim"])
        updates = []
        for i in eligible:
            vec = [0. if x is None else x - theta[k] for k, x in enumerate(msgs[i])]
            vec_norm = length(vec)
            if vec_norm > c["update_norm_bound"]:
                vec = [x * c["update_norm_bound"] / vec_norm for x in vec]
            updates.append(vec)
        changed, fallback, proposal = False, False, []
        for k in range(c["decision_dim"]):
            vals = [updates[p][k] for p, i in enumerate(eligible) if msgs[i][k] is not None]
            if not vals:
                proposal.append(theta[k])
                continue
            changed = True
            if method in ("trimmed_mean", "trust_trimmed_mean"):
                b = c["trim_each_side"]
                if len(vals) <= 2 * b:
                    part = med(vals)
                    fallback = True
                else:
                    ordered = sorted(vals)
                    part = avg(ordered[b:len(ordered)-b])
            else:
                part = avg(vals)
            proposal.append(theta[k] + c["global_step"] * part)
        if changed:
            st["theta"][method] = proposal
            err = length([x-y for x,y in zip(proposal,truth)])
        else:
            err = None
        out[method] = dict(error=err, fallback=fallback, value=proposal if changed else None)
    return out


def simulate(c, run=0, attacked=True):
    n = c["n_agents"]
    bad = get_bad(c, run)
    st = dict(D=[[c["initial_trust"]]*n for _ in range(n)],
              E=[c["initial_trust"]]*n,
              T=[[c["initial_trust"]]*n for _ in range(n)],
              tau=[c["initial_trust"]]*n, tauPrev=[c["initial_trust"]]*n,
              isolated=[False]*n, below=[0]*n, z=[0.]*n, events=[], theta={})
    previous = None
    errors = {m:[] for m in METHODS}
    indicators = {m:[] for m in METHODS}
    snapshot = []
    for t in range(c["n_steps"]):
        attack, truth, messages = observe(c, run, t, bad, attacked)
        q = evidence(c, run, t, bad, st["isolated"], previous, messages, attack)
        update_trust(c, st, q)
        admitted = isolate(c, st, q, t, attack, bad)
        decision = choose(c, st, run, t, attack, bad, admitted)
        aggregated = aggregate(c, st, messages, truth, admitted)
        for m in METHODS:
            e = aggregated[m]["error"]
            if t >= c["attack_start_step"] and e is not None:
                errors[m].append(e)
            chi = [
                1 if decision["automatic"] else c["operator_availability"] if decision["action"] == "operator" else 0,
                max(0.,1.-e/c["error_scale"]) if e is not None else 0.,
                1 if decision["safe"] else 0,
                len([j for j in bad if st["isolated"][j]]) / len(bad) if attack and bad else 1
            ]
            indicators[m].append(sum(a*b for a,b in zip(chi,c["resilience_weights"])))
        live = [j for j in range(n) if not st["isolated"][j]]
        snapshot.append(dict(step=t, tau=st["tau"][:],
                             trustMedian=med([st["tau"][j] for j in live]) or 0,
                             D01=st["D"][0][1],
                             errors={m:aggregated[m]["error"] for m in METHODS},
                             choice=decision["action"],bad=sorted(bad)))
        previous = messages
    J = {m:avg(indicators[m][-c["resilience_window"]:]) for m in METHODS}
    return {"J":J,"errors":{m:avg(errors[m]) for m in METHODS},
            "events":st["events"],"snapshot":snapshot}


def paired_run(c, run):
    attack = simulate(c,run,True)
    clean = simulate(c,run,False)
    ratios = {m:attack["J"][m]/clean["J"][m] for m in METHODS}
    return dict(psi=ratios,errors=attack["errors"],snapshot=attack["snapshot"],
                events=attack["events"])


def main():
    packet = json.loads(sys.stdin.read())
    config = packet["config"]
    run = packet.get("run",0)
    output = paired_run(config,run)
    json.dump(output,sys.stdout,ensure_ascii=False,allow_nan=False,sort_keys=True)


if __name__ == "__main__":
    main()
