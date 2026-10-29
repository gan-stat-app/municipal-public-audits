"""Independent arithmetic and order-aware replay checks for the pinned reports.

The check does not approve the semantic validity of automated findings.
Original reports are never rewritten to hide replay differences.
"""
from __future__ import annotations
from collections import Counter
from copy import deepcopy
import hashlib
import json

DEDUCTIONS={1:{'critical':10,'major':5,'minor':2,'info':0},2:{'critical':40,'major':30,'minor':10,'info':0},3:{'critical':15,'major':10,'minor':5,'info':0}}
UNORDERED={'評価内容','失敗ルール','強制0点ルール','違反'}

def canonical(obj,key=''):
    if isinstance(obj,dict):return {k:canonical(v,k) for k,v in obj.items()}
    if isinstance(obj,list):
        rows=[canonical(v) for v in obj]
        return sorted(rows,key=lambda v:json.dumps(v,sort_keys=True,ensure_ascii=False)) if key in UNORDERED else rows
    return obj

def digest(obj):
    return hashlib.sha256(json.dumps(canonical(obj),sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def checks(official):
    for si,sheet in enumerate(official['sheets']):
        for ai,area in enumerate(sheet['評価対象エリア']):
            for rule in area['評価内容']:
                yield (si,ai,rule['ルールID']),rule

def independent_scores(official):
    groups={i:[] for i in (1,2,3)}
    for _,rule in checks(official):
        if rule['判定対象外']!=(rule['信頼度']==0):raise ValueError('Skip/confidence mismatch')
        if rule['信頼度']>0:groups[int(rule['ルールID'][1])].append(rule)
    output={}
    for level,rules in groups.items():
        failures=[r for r in rules if not r['合否']]
        fatal=any(r['重大度']=='fatal' for r in failures)
        score=None if not rules else 0 if fatal else max(0,100-sum(DEDUCTIONS[level][r['重大度']] for r in failures))
        saved=official['レベル別スコア'][str(level)]
        if (score,sum(r['合否'] for r in rules),len(rules),fatal)!=(saved['スコア'],saved['合格'],saved['合計'],saved['強制0点']):raise ValueError('Independent score/count mismatch')
        if Counter((r['ルールID'],r['重大度']) for r in failures)!=Counter((r['ルールID'],r['重大度']) for r in saved['失敗ルール']):raise ValueError('Failed rule multiset mismatch')
        if Counter((r['ルールID'],r['重大度']) for r in failures if r['重大度']=='fatal')!=Counter((r['ルールID'],r['重大度']) for r in saved['強制0点ルール']):raise ValueError('Fatal rule multiset mismatch')
        output[str(level)]=score
    return output

def compare_reports(original,replayed):
    scores=independent_scores(original)
    if independent_scores(replayed)!=scores:raise ValueError('Replay score mismatch')
    old_rules=dict(checks(original));new_rules=dict(checks(replayed))
    if old_rules.keys()!=new_rules.keys():raise ValueError('Replay rule/area identities changed')
    differences=[]
    for key,old in old_rules.items():
        new=new_rules[key]
        if canonical(old)==canonical(new):continue
        # The pinned L2-04 iterates a set of possible comparison witnesses.
        # Preserve changed descriptions, but require the same cells and states.
        def without_witness(rule):
            return {**rule,'違反':[{k:v for k,v in item.items() if k!='説明'} for item in rule['違反']]}
        if key[2]!='L2-04' or canonical(without_witness(old))!=canonical(without_witness(new)):raise ValueError('Unexpected replay content change: '+str(key))
        differences.append({'sheet_index':key[0],'area_index':key[1],'rule_id':key[2],
            'original_findings_sha256':digest(old['違反']),'replay_findings_sha256':digest(new['違反']),
            'changed_descriptions':sum(a!=b for a,b in zip(sorted(x['説明'] for x in old['違反']),sorted(x['説明'] for x in new['違反']))),
            'explanation':'L2-04の比較候補の選択が異なる。指摘セル・合否・重大度・得点は一致。'})
    old_structure=deepcopy(original);new_structure=deepcopy(replayed)
    for report in (old_structure,new_structure):
        for key,rule in checks(report):
            if key[2]=='L2-04':
                for finding in rule['違反']:finding.pop('説明',None)
    if canonical(old_structure)!=canonical(new_structure):raise ValueError('Unexpected report metadata/structure change')
    return {'scores_recomputed':3,'rule_results':len(old_rules),
        'reported_finding_occurrences':sum(len(r['違反']) for r in old_rules.values()),
        'canonical_report_matches':canonical(original)==canonical(replayed),
        'original_canonical_sha256':digest(original),'replay_canonical_sha256':digest(replayed),
        'witness_differences':differences,'score_semantic_acceptance':'pending'}
