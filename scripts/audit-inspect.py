import json
from collections import Counter

rows = [json.loads(line) for line in open('/Users/lloyd/.dsh/bash-guard-audit.jsonl')]
print(f"总数 {len(rows)}")
print("结果:", dict(Counter(r.get('allowed') for r in rows)))
print("来源:", dict(Counter(r.get('source') for r in rows)))
print("工具:", dict(Counter(r.get('tool') for r in rows)))
print("引擎:", dict(Counter(r.get('engine') for r in rows)))
print("抑制:", sum(1 for r in rows if r.get('suppressed')))
print("物化:", sum(1 for r in rows if r.get('materialized')))
print("诊断:", dict(Counter(r.get('diagnostic') for r in rows if r.get('diagnostic'))))

mismatch = [(r.get('localRequired'), r.get('jevRequired'), r.get('command')) for r in rows
            if r.get('jevRequired') and r.get('localRequired') and r.get('localRequired') != r.get('jevRequired')]
print(f"\nlocal≠jev 需求位不一致: {len(mismatch)} 条")
by_pair = Counter((l, j) for l, j, _ in mismatch)
for (l, j), n in by_pair.most_common(12):
    print(f"  local={l} jev={j}: {n} 条")

denied = [r for r in rows if r.get('allowed') is False]
print(f"\n被拒绝总数: {len(denied)}")
denied_by_local = Counter((r.get('localRequired') or '?') for r in denied if r.get('source') != 'diagnostic')
print("拒绝时 localRequired 分布:", dict(denied_by_local.most_common(10)))

print("\n==== 各不一致模式样本（去重） ====")
seen = set()
for (l, j), n in by_pair.most_common(12):
    print(f"\n-- local={l} jev={j} ({n} 条) 样本:")
    shown = 0
    for r in rows:
        if (r.get('localRequired'), r.get('jevRequired')) == (l, j):
            cmd = (r.get('command') or '')[:150]
            key = cmd[:80]
            if key in seen:
                continue
            seen.add(key)
            print(f"  · {cmd}")
            shown += 1
            if shown >= 4:
                break
