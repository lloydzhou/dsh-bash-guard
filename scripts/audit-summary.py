import json
from collections import Counter

rows = [json.loads(line) for line in open('/Users/lloyd/.dsh/bash-guard-audit.jsonl')]
print(f"总数 {len(rows)}")
print("工具分布:", dict(Counter(r.get('tool') for r in rows)))
print("结果分布:", dict(Counter(r.get('allowed') for r in rows)))
print("来源分布:", dict(Counter(f"{r.get('source')}{'/fallback' if r.get('fallback') else ''}" for r in rows)))
print("抑制数:", sum(1 for r in rows if r.get('suppressed')))
print("继承数:", sum(1 for r in rows if r.get('inherited')))
print("诊断数:", sum(1 for r in rows if r.get('diagnostic')))

def tags(cmd):
    out = []
    if '$(' in cmd or '`' in cmd: out.append('命令替换')
    if '&&' in cmd: out.append('链')
    if '|' in cmd: out.append('管道')
    if '>' in cmd: out.append('重定向')
    if ' cd ' in f' {cmd} ': out.append('cd')
    if any(k in cmd for k in ('pytest', 'npm ', 'pnpm ', 'cargo', 'uv ', 'pip ')): out.append('构建测试')
    if 'git' in cmd: out.append('git')
    if 'curl' in cmd or 'wget' in cmd or 'http' in cmd: out.append('网络')
    if 'sudo' in cmd: out.append('sudo')
    return out

tag_counter = Counter()
for r in rows:
    for tag in tags(r.get('command') or ''):
        tag_counter[tag] += 1
print("\n场景标签分布:", dict(tag_counter))

print("\nlocalRequired vs jevRequired 不一致的行（规则优化候选）:")
mismatch = 0
for r in rows:
    local, jev = r.get('localRequired'), r.get('jevRequired')
    if jev and jev != 'null' and local != jev:
        mismatch += 1
        print(f"  [{r.get('tool')}] local={local} jev={jev} allowed={r.get('allowed')}")
        print(f"    {(r.get('command') or '')[:160]}")
if mismatch == 0:
    print("  （无）")

print("\n被拒绝的操作:")
for r in rows:
    if r.get('allowed') is False:
        print(f"  [{r.get('source')}] {r.get('localRequired')} vs {(r.get('command') or '')[:120]}")
