"""UP-34: full network-enabled E1 reconstruction from exogenous topology/events.

The Python oracle does not import experiment.py and does not call the JS
algorithm under test for expected answers. Initial graph and individual random
observation/message outcomes are inputs; connectivity, queues, bounded
bandwidth, Bayesian trust, reputation, decisions and isolation are computed
independently and compared on every tick. Graph sampling distributions are
outside this event-tape verification.
"""
import copy
import json
import math
import subprocess
import unittest
from pathlib import Path

from test_up34_deterministic import (
    BRIDGE, ROOT, beta_reference, eigen_reference, trim_reference,
    quantile, check_close,
)


def network_components(edges, running, groups, partition):
    n=len(running)
    adjacency=[set() for _ in range(n)]
    for a,b in edges:
        assert 0<=a<b<n and b not in adjacency[a], "invalid graph edge"
        adjacency[a].add(b)
        adjacency[b].add(a)
    labels=[-1]*n
    components=[]
    for i in range(n):
        if not running[i] or labels[i]>=0:
            continue
        members=[]
        q=[i]
        labels[i]=len(components)
        cursor=0
        while cursor<len(q):
            node=q[cursor]
            cursor+=1
            members.append(node)
            for target in sorted(adjacency[node]):
                if running[target] and labels[target]<0 and (
                    not partition or groups[node]==groups[target]):
                    labels[target]=labels[i]
                    q.append(target)
        components.append(members)
    return components,labels,adjacency


def assert_topology_semantics(c, topology, adjacency):
    n=c["n_agents"]+c["n_sybil_agents"]
    assert topology["n"]==n
    assert len(topology["partitionGroups"])==n
    assert all(x in (0,1) for x in topology["partitionGroups"])
    assert len(topology["byzantine"])==n
    assert topology["sybil"]==[i>=c["n_agents"] for i in range(n)]
    for i in range(n):
        assert i not in adjacency[i]
        for j in adjacency[i]:
            assert i in adjacency[j]
    if not c["network_enabled"] or c["network_topology"]=="complete":
        for i in range(n):
            assert adjacency[i]==set(range(n))-{i}
    elif c["network_topology"]=="random" and c["network_edge_probability"]==0:
        for i in range(c["n_agents"]):
            for j in range(i+1,c["n_agents"]):
                assert j not in adjacency[i], "G(N,0) acquired invented base edge"
    elif c["network_topology"]=="ring" and c["n_sybil_agents"]==0:
        for i in range(n):
            assert adjacency[i]=={(i-1)%n,(i+1)%n}
    for sybil in range(c["n_agents"],n):
        for other in range(c["n_agents"],n):
            if other!=sybil:
                assert other in adjacency[sybil]
        for anchor in range(min(c["n_agents"],c["n_byzantine"]+2)):
            assert anchor in adjacency[sybil]


def independent_network_trace(result):
    c=result["configuration"]
    assert c["network_enabled"] is True
    assert result["sourceEventSchema"]==2
    assert result["sourceEventAudit"]["valid"]
    n=c["n_agents"]+c["n_sybil_agents"]
    steps=c["n_steps"]
    events=result["sourceEvents"]
    top=[e for e in events if e["kind"]=="topology"]
    assert len(top)==1 and top[0]["step"]==0
    topology=top[0]
    edges=topology["edges"]
    groups=topology["partitionGroups"]
    adjacency=[set() for _ in range(n)]
    for a,b in edges:
        assert 0<=a<b<n and b not in adjacency[a]
        adjacency[a].add(b)
        adjacency[b].add(a)
    assert_topology_semantics(c,topology,adjacency)
    journal={step:{"proposal_generated":[],"proposal_attempt":[],
                  "proposal_final":[],"evidence":[]} for step in range(1,steps+1)}
    for event in events:
        if event["kind"]=="topology":
            continue
        assert event["kind"] in journal[event["step"]],event
        journal[event["step"]][event["kind"]].append(event)

    sybil=topology["sybil"]
    bad=topology["byzantine"]
    active=[not b for b in sybil]
    low=[0]*n
    until=[-1]*n
    isolated=[None]*n
    detection=[None]*n
    queue=[]
    last_values=[None]*n
    last_sent=[-1000000000]*n
    history=[]
    decisions={method:[] for method in (
        "arithmetic_mean","trust_weighted_mean","coordinate_trimmed_mean","proposed_robust")}
    expected_isolations=[]
    channel={
        key:{field:0 for field in ("attempted","delivered","lost","bandwidth_dropped","expired")}
        for key in ("proposal","evidence")}
    prev_total_attempted=0
    for t in range(steps):
        step=t+1
        tick_journal=journal[step]
        eligible=[not sybil[i] or step>=c["sybil_activation_step"] for i in range(n)]
        for i in range(n):
            if not active[i] and eligible[i] and (
                (sybil[i] and until[i]<0) or (until[i]>=0 and until[i]<t)):
                active[i]=True
                low[i]=0
        running=[active[i] and eligible[i] for i in range(n)]
        generated=tick_journal["proposal_generated"]
        assert len(generated)==n
        proposed=[None]*n
        for source in generated:
            i=source["source"]-1
            assert proposed[i] is None and source["active"]==running[i]
            assert source["byzantine"]==bad[i] and source["sybil"]==sybil[i]
            proposed[i]=source["value"]
        assert all(v is not None for v in proposed)

        partition=bool(c["partition_enabled"] and
                       c["partition_start_step"]<=step<=c["partition_end_step"])
        comps,labels,_=network_components(edges,running,groups,partition)
        largest=sorted(comps,key=lambda x:(-len(x),x[0]))[0] if comps else []
        direct=beta_reference({"history":history,"prior":c["initial_trust"],
                               "strength":c["trust_prior_strength"],
                               "forgetting":c["forgetting_factor"]}) if history else (
                               [[c["initial_trust"]]*n for _ in range(n)])
        scores=[c["initial_trust"]]*n
        for comp in comps:
            for j in comp:
                scores[j]=quantile([direct[i][j] for i in comp],.5)
        eigen=eigen_reference({"matrix":direct,"active":running,
                               "damping":c["reputation_damping"]})
        rep=[.7*scores[i]+.3*eigen[i] for i in range(n)]

        attempts=tick_journal["proposal_attempt"]
        assert len(attempts)==len(largest),(step,len(attempts),largest)
        assert {e["source"]-1 for e in attempts}==set(largest)
        lost_count=0
        for event in attempts:
            i=event["source"]-1
            assert event["sent"]==step and event["value"]==proposed[i]
            assert event["status"] in ("lost","queued")
            if event["status"]=="lost":
                lost_count+=1
                continue
            due=event["due"]
            assert step+c["message_delay_min_steps"]<=due<=step+c["message_delay_max_steps"]
            queue.append({"sent":step,"due":due,"source":i,"value":proposed[i]})
        queue.sort(key=lambda x:x["due"])
        budget=c["bandwidth_messages_per_step"]
        completed=[]
        retained=[]
        actual_deliveries=0
        actual_expired=0
        delays=[]
        for message in queue:
            if t-(message["sent"]-1)>c["max_message_staleness_steps"]:
                completed.append({**message,"status":"expired"})
                actual_expired+=1
            elif message["due"]<=step and budget>0:
                completed.append({**message,"status":"delivered"})
                budget-=1
                actual_deliveries+=1
                delays.append(t-(message["sent"]-1))
                last_values[message["source"]]=message["value"]
                last_sent[message["source"]]=message["sent"]-1
            else:
                retained.append(message)
        queue=retained
        finalized=tick_journal["proposal_final"]
        assert len(finalized)==len(completed)
        for actual,expected in zip(finalized,completed):
            assert actual["step"]==step
            assert actual["status"]==expected["status"]
            assert actual["source"]==expected["source"]+1
            assert actual["sent"]==expected["sent"]
            assert actual["due"]==expected["due"]
            check_close(actual["value"],expected["value"],"E1.finalized.value")
        available=[i in largest and last_values[i] is not None and
                   t-last_sent[i]<=c["max_message_staleness_steps"] for i in range(n)]
        available_ids=[i for i in range(n) if available[i]]
        values=[last_values[i] for i in available_ids]
        weights=[max(rep[i],c["minimum_weight"]) for i in available_ids]
        if values:
            project=lambda x:min(c["safe_action_max"],max(c["safe_action_min"],x))
            trusted_positions=[j for j,i in enumerate(available_ids)
                               if rep[i]>=c["aggregation_trust_threshold"]]
            if trusted_positions:
                trusted_values=[values[j] for j in trusted_positions]
                trusted_weights=[weights[j] for j in trusted_positions]
                combined=project(trim_reference({"values":trusted_values,
                    "weights":trusted_weights,"k":c["trim_each_side"]}))
            else:
                combined=None
            decision={
                "arithmetic_mean":project(sum(values)/len(values)),
                "trust_weighted_mean":project(sum(x*w for x,w in zip(values,weights))/sum(weights)),
                "coordinate_trimmed_mean":project(trim_reference({"values":values,
                    "weights":[1.0]*len(values),"k":c["trim_each_side"]})),
                "proposed_robust":combined
            }
        else:
            decision={method:None for method in decisions}
        row=result["series"][t]
        for method,value in decision.items():
            decisions[method].append(value)
            check_close(row[method],value,f"E1.network.{method}.{step}")
        evidence=[[None]*n for _ in range(n)]
        evidence_events=tick_journal["evidence"]
        active_count=sum(running)
        assert len(evidence_events)==active_count**2
        pairs={}
        candidate_count=0
        missed=0
        dropped=0
        evidence_delivered=0
        for ev in evidence_events:
            i,j=ev["observer"]-1,ev["target"]-1
            assert running[i] and running[j] and (i,j) not in pairs
            pairs[(i,j)]=ev
            connected=labels[i]>=0 and labels[i]==labels[j]
            status=ev["status"]
            assert status in ("not_attempted","lost","delivered","dropped")
            if not connected:
                assert status=="not_attempted"
            else:
                assert status!="not_attempted"
                if status=="lost":
                    assert i!=j
                    missed+=1
                else:
                    candidate_count+=1
                    if status=="dropped":
                        dropped+=1
                    else:
                        evidence_delivered+=1
                        check_close(ev["generated"],ev["value"],"E1.evidence.value")
                        evidence[i][j]=ev["value"]
            if status!="delivered":
                assert ev["value"] is None
        assert evidence_delivered==min(budget,candidate_count)
        assert dropped==candidate_count-evidence_delivered
        for i in range(n):
            for j in range(n):
                if running[i] and running[j]:
                    assert (i,j) in pairs
        attempted_evidence=candidate_count+missed
        expected_attempted= sum(len(comp)**2 for comp in comps)
        assert attempted_evidence==expected_attempted

        updates={
            "proposal":{"attempted":len(largest),"delivered":actual_deliveries,
                        "lost":lost_count,"bandwidth_dropped":0,"expired":actual_expired},
            "evidence":{"attempted":attempted_evidence,"delivered":evidence_delivered,
                        "lost":missed,"bandwidth_dropped":dropped,"expired":0}}
        ledger=result["messageLedger"][t]
        for name in ("proposal","evidence"):
            for key,value in updates[name].items():
                channel[name][key]+=value
            channel[name]["pending"]=len(queue) if name=="proposal" else 0
            channel[name]["balance"]=channel[name]["attempted"]-sum(
                channel[name][field] for field in (
                    "delivered","lost","bandwidth_dropped","expired","pending"))
            assert channel[name]["balance"]==0
            check_close(ledger[name],channel[name],f"E1.ledger.{name}.tick{step}")
        total={k:channel["proposal"][k]+channel["evidence"][k] for k in channel["proposal"]}
        check_close(ledger["total"],total,f"E1.total.tick{step}")

        history.append(evidence)
        if len(history)>c["trust_window_steps"]:
            history.pop(0)
        updated=beta_reference({"history":history,"prior":c["initial_trust"],
                                "strength":c["trust_prior_strength"],
                                "forgetting":c["forgetting_factor"]})
        isolation_score=[c["initial_trust"]]*n
        for comp in comps:
            for j in comp:
                isolation_score[j]=quantile([updated[i][j] for i in comp],.5)
        if c["isolation_enabled"] and step>=c["minimum_evidence_steps"]:
            for i in range(n):
                low[i]=low[i]+1 if running[i] and isolation_score[i]<c["isolation_threshold"] else 0
                if running[i] and low[i]>=c["isolation_patience"]:
                    if isolated[i] is None:
                        isolated[i]=step
                    if bad[i] and step>=c["attack_start_step"] and detection[i] is None:
                        detection[i]=step
                    expected_isolations.append((step,i+1,isolation_score[i],low[i]))
                    active[i]=False
                    until[i]=t+c["isolation_cooldown_steps"]

        check_close(row["active_agents"],sum(running[i] and active[i] for i in range(n)),
                    f"E1.active_agents.{step}")
        check_close(row["isolated_agents"],sum(eligible[i] and not active[i] for i in range(n)),
                    f"E1.isolated_agents.{step}")
        check_close(row["available_agents"],len(available_ids),f"E1.available_agents.{step}")
        check_close(row["largest_component"],len(largest),f"E1.component_size.{step}")
        check_close(row["messages_delivered"],actual_deliveries+evidence_delivered,
                    f"E1.messages_delivered.{step}")
        check_close(row["messages_lost"],lost_count+missed,f"E1.messages_lost.{step}")
        check_close(row["messages_bandwidth_dropped"],dropped,f"E1.messages_dropped.{step}")
        check_close(row["messages_expired"],actual_expired,f"E1.messages_expired.{step}")
        check_close(row["messages_backlogged"],sum(q["due"]<=step for q in queue),
                    f"E1.messages_backlogged.{step}")
        check_close(row["messages_queued"],len(queue),f"E1.messages_queued.{step}")
        check_close(row["partition_active"],int(partition),f"E1.partition_active.{step}")
        attack=step>=c["attack_start_step"] and (
            result["scenario"]!="on_off" or
            (step-c["attack_start_step"])%c["on_off_period"]<c["on_off_attack_steps"])
        check_close(row["attack_active"],int(attack),f"E1.attack.{step}")
        network_row=result["networkSeries"][t]
        check_close(network_row["mean_message_delay"],
                    sum(delays)/len(delays) if delays else 0,"E1.mean_delay")
        check_close(network_row["delivery_ratio"],
                    total["delivered"]/max(1,total["attempted"]),"E1.delivery_ratio")
        check_close(network_row["message_balance"],0,"E1.message_balance")
        check_close(network_row["proposal_message_balance"],0,"E1.proposal_balance")
        check_close(network_row["evidence_message_balance"],0,"E1.evidence_balance")
        reputation=[e for e in result["reputation"] if e["step"]==step]
        states=[e for e in result["states"] if e["step"]==step]
        assert len(reputation)==n and len(states)==n
        for i,rep_row in enumerate(reputation):
            for key,value in (("localTrust",scores[i]),
                              ("eigenReputation",eigen[i]),
                              ("reputation",rep[i]),
                              ("isolationScore",isolation_score[i])):
                check_close(rep_row[key],value,f"E1.agent{i+1}.{step}.{key}")
            assert rep_row["active"]==active[i]
            state=("dormant" if sybil[i] and not eligible[i] else
                   "isolated" if not active[i] else
                   "sybil" if sybil[i] else
                   "byzantine" if bad[i] else "honest")
            assert states[i]["state"]==state and states[i]["agent"]==i+1

    assert len(expected_isolations)==len(result["events"])
    for actual,(step,agent,score,confirmations) in zip(result["events"],expected_isolations):
        assert actual["step"]==step and actual["agent"]==agent
        assert actual["confirmations"]==confirmations
        check_close(actual["isolationScore"],score,"E1.isolation.score")
    terminal=result["summary"]
    check_close(terminal["communication_attempted"],total["attempted"],"E1.final.attempted")
    check_close(terminal["communication_delivered"],total["delivered"],"E1.final.delivered")
    check_close(terminal["communication_expired"],total["expired"],"E1.final.expired")
    check_close(terminal["communication_lost"],total["lost"],"E1.final.lost")
    check_close(terminal["communication_bandwidth_dropped"],total["bandwidth_dropped"],"E1.final.dropped")
    check_close(terminal["communication_queued"],len(queue),"E1.final.queue")
    byzantine_count=sum(bad)
    detected=[x for x in detection if x is not None]
    check_close(terminal["detection_rate"],len(detected)/max(1,byzantine_count),"E1.detection")
    check_close(terminal["mean_detection_delay_steps"],
                sum(x-c["attack_start_step"] for x in detected)/len(detected)
                if detected else None,"E1.detection_delay")
    check_close(terminal["preserved_functionality"],
                sum(active[i] and not bad[i] for i in range(n))/
                max(1,n-byzantine_count),"E1.preserved")
    for metric in result["rows"]:
        if metric["method"] not in decisions:
            continue
        xs=decisions[metric["method"]]
        accepted=[x for x in xs if x is not None]
        right=sum(x is not None and abs(x-c["desired_action"])<=c["correctness_tolerance"]
                  for x in xs)
        check_close(metric["probability_correct"],right/len(xs),"E1.probability_correct")
        check_close(metric["mae"],sum(abs(x-c["desired_action"]) for x in accepted)/
                    len(accepted) if accepted else None,"E1.mae")
        check_close(metric["rmse"],math.sqrt(sum((x-c["desired_action"])**2
                    for x in accepted)/len(accepted)) if accepted else None,"E1.rmse")
        check_close(metric["bias"],sum(x-c["desired_action"] for x in accepted)/
                    len(accepted) if accepted else None,"E1.bias")


class FullNetworkTraceVerification(unittest.TestCase):
    def test_networked_e1_event_tape_scenarios(self):
        common={"n_agents":7,"n_byzantine":2,"trim_each_side":2,
                "n_steps":19,"attack_start_step":4,
                "minimum_evidence_steps":2,"isolation_cooldown_steps":3,
                "source_event_limit":25000,"network_enabled":True,
                "message_delay_min_steps":0,"message_delay_max_steps":3,
                "max_message_staleness_steps":2,
                "on_off_period":5,"on_off_attack_steps":2}
        plans=[
            {"scenario":"on_off","runIndex":1,
             "config":{**common,"seed":20261109,"network_topology":"ring",
              "n_sybil_agents":2,"sybil_activation_step":5,
              "partition_enabled":True,"partition_start_step":8,
              "partition_end_step":14,"partition_fraction":.45,
              "message_loss_probability":.2,"bandwidth_messages_per_step":4,
              "isolation_enabled":True,"isolation_threshold":.65,"isolation_patience":1}},
            {"scenario":"static_bias","runIndex":2,
             "config":{**common,"seed":20261110,"network_topology":"random",
              "network_edge_probability":0,"n_sybil_agents":1,"sybil_activation_step":3,
              "message_loss_probability":.3,"bandwidth_messages_per_step":1,
              "isolation_enabled":False}},
            {"scenario":"collusion","runIndex":3,
             "config":{**common,"seed":20261111,"network_topology":"small_world",
              "small_world_neighbors":2,"small_world_rewire_probability":.6,
              "n_sybil_agents":2,"sybil_activation_step":6,
              "message_loss_probability":.5,"bandwidth_messages_per_step":3,
              "isolation_enabled":True,"isolation_threshold":.7,"isolation_patience":2}},
            {"scenario":"subtle_bias","runIndex":4,
             "config":{**common,"seed":20261112,"network_topology":"complete",
              "n_sybil_agents":0,"message_loss_probability":1,
              "bandwidth_messages_per_step":0,"isolation_enabled":False}},
            {"scenario":"on_off","runIndex":5,
             "config":{**common,"seed":20261113,"network_topology":"ring",
              "n_sybil_agents":0,"message_loss_probability":0,
              "bandwidth_messages_per_step":6,"max_message_staleness_steps":0,
              "message_delay_min_steps":1,"message_delay_max_steps":3,
              "isolation_enabled":False}}
        ]
        proc=subprocess.run(["node",str(BRIDGE)],input=json.dumps({"cases":[
            {"type":"trust_trace",**plan} for plan in plans]}),cwd=ROOT,
            capture_output=True,text=True,timeout=90)
        self.assertEqual(proc.returncode,0,proc.stderr[-4000:])
        result=json.loads(proc.stdout)
        self.assertEqual(result["schema"],"up34-parity-v2")
        self.assertEqual(len(result["results"]),len(plans))
        for idx,item in enumerate(result["results"]):
            with self.subTest(scenario=idx):
                independent_network_trace(item)

        # Mutation controls: changing just one exogenous event must invalidate
        # the independent reconstructed numerical solution, even if the
        # serialized aggregates and the JS-side audit flag remain untouched.
        corrupt=copy.deepcopy(result["results"][0])
        evidence=next(e for e in corrupt["sourceEvents"]
                      if e["kind"]=="evidence" and e["status"]=="delivered")
        evidence["value"]=.0 if evidence["value"]>=.5 else 1.0
        evidence["generated"]=evidence["value"]
        with self.assertRaises(AssertionError):
            independent_network_trace(corrupt)

        corrupt=copy.deepcopy(result["results"][4])
        delivery=next(e for e in corrupt["sourceEvents"]
                      if e["kind"]=="proposal_final")
        delivery["due"]+=1
        with self.assertRaises(AssertionError):
            independent_network_trace(corrupt)

        corrupt=copy.deepcopy(result["results"][1])
        topology=next(e for e in corrupt["sourceEvents"] if e["kind"]=="topology")
        topology["edges"].append([0,0])
        with self.assertRaises(AssertionError):
            independent_network_trace(corrupt)


if __name__=="__main__":
    unittest.main()
