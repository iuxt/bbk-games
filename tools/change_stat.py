#!/usr/bin/env python3
"""修改伏魔记存档中角色属性的工具。

支持修改: level(等级), exp(经验), maxHP(最大生命), hp(当前生命),
          maxMP(最大法力), mp(当前法力), attack(攻击), defend(防御),
          speed(速度), lingli(灵力), luck(运气)

用法:
  # 查看存档中所有角色属性
  python3 tools/change_stat.py bbk-伏魔记-正式版-save-1.json

  # 修改等级（简写形式）
  python3 tools/change_stat.py bbk-伏魔记-正式版-save-1.json 柳清风:50

  # 修改经验值
  python3 tools/change_stat.py bbk-伏魔记-正式版-save-1.json 柳清风:exp=9999

  # 同时修改多个角色、多个属性
  python3 tools/change_stat.py bbk-伏魔记-正式版-save-1.json 柳清风:50 柳清风:exp=9999 慕容小梅:level=45

  # 直接覆盖原文件
  python3 tools/change_stat.py bbk-伏魔记-正式版-save-1.json 柳清风:exp=5000 --in-place
"""

import json
import sys
import os
from typing import Dict, List, Tuple

# 属性定义：字段名 → (中文名, 相对于 level 偏移的 2 字节数)
STATS = {
    "level":   ("等级",   0),
    "maxHP":   ("最大HP", +2),
    "hp":      ("当前HP", +4),
    "maxMP":   ("最大MP", +6),
    "mp":      ("当前MP", +8),
    "attack":  ("攻击",   +10),
    "defend":  ("防御",   +12),
    "speed":   ("速度",   +14),
    "lingli":  ("灵力",   +16),
    "luck":    ("运气",   +18),
    "exp":     ("经验",   +20),
}

# 哪些角色名是真正的角色（排除地图对象等误检测项）
# 如果存档中检测到的名字不在这个列表里，仍会显示但带标记
KNOWN_PLAYERS = {"柳清风", "慕容小梅", "袁萍芷"}


def read_u16_le(raw: bytes, off: int) -> int:
    return raw[off] | (raw[off + 1] << 8)


def find_characters(data: str) -> List[dict]:
    """在 hex 数据中定位所有角色，返回每个角色的属性偏移和当前值"""
    raw = bytes.fromhex(data)
    results = []
    i = 0
    while i < len(raw):
        if 0xA1 <= raw[i] <= 0xF7 and i + 1 < len(raw) and raw[i + 1] >= 0xA1:
            start = i
            chars_bytes = []
            while i < len(raw) and 0xA1 <= raw[i] <= 0xF7 and i + 1 < len(raw) and raw[i + 1] >= 0xA1:
                chars_bytes.append(raw[i : i + 2])
                i += 2
            if len(chars_bytes) >= 2:
                try:
                    text = b"".join(chars_bytes).decode("gb2312")
                    if start >= 2:
                        name_len = raw[start - 2] | (raw[start - 1] << 8)
                        if name_len == len(chars_bytes) * 2:
                            level_off = start + len(chars_bytes) * 2
                            if level_off + 22 < len(raw):  # need room for all stats
                                level = read_u16_le(raw, level_off)
                                if 1 <= level <= 99:
                                    char = {"name": text, "level_offset": level_off}
                                    # 读取所有属性
                                    for stat_key, (_, rel_off) in STATS.items():
                                        off = level_off + rel_off
                                        char[stat_key] = read_u16_le(raw, off)
                                    results.append(char)
                except Exception:
                    pass
        else:
            i += 1
    return results


def parse_changes(args: List[str]) -> List[Tuple[str, str, int]]:
    """解析命令行参数中的修改指令。

    返回: [(角色名, 属性key, 新值), ...]

    支持格式:
      角色名:数值           → level=数值 (简写)
      角色名:属性key=数值   → 指定属性
    """
    changes = []
    for arg in args:
        if ":" not in arg:
            continue
        name, rest = arg.split(":", 1)
        if "=" in rest:
            stat_key, val_str = rest.split("=", 1)
        else:
            # 简写：直接数字 = 等级
            stat_key = "level"
            val_str = rest

        if stat_key not in STATS:
            print(f"  ⚠ 未知属性 '{stat_key}'，可用: {', '.join(STATS.keys())}")
            continue

        try:
            value = int(val_str)
        except ValueError:
            print(f"  ⚠ 无法解析数值: {val_str}")
            continue

        changes.append((name, stat_key, value))
    return changes


def set_stat(data: str, name: str, stat_key: str, new_value: int,
             chars: List[dict]) -> str:
    """修改指定角色的某个属性值"""
    stat_name, rel_off = STATS[stat_key]
    for c in chars:
        if c["name"] == name:
            off = c["level_offset"] + rel_off
            old_value = c[stat_key]
            new_hex = f"{new_value & 0xFFFF:04X}"  # LE: low byte first
            # 小端序：低字节在前
            new_hex_le = f"{new_value & 0xFF:02X}{(new_value >> 8) & 0xFF:02X}"
            print(f"  {name}.{stat_name}: {old_value} → {new_value}")
            return data[:off * 2] + new_hex_le + data[off * 2 + 4:]
    print(f"  ⚠ 未找到角色: {name}")
    return data


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    save_path = sys.argv[1]

    with open(save_path) as f:
        save = json.load(f)

    data = save["data"]
    chars = find_characters(data)

    # 解析参数
    in_place = "--in-place" in sys.argv
    changes = parse_changes([a for a in sys.argv[2:] if a != "--in-place"])

    # 显示当前状态
    print("=== 当前存档角色 ===")
    for c in chars:
        tag = "" if c["name"] in KNOWN_PLAYERS else " ⚡(非角色?)"
        print(f"\n  【{c['name']}】{tag}")
        print(f"    等级: {c['level']:>4}    经验: {c['exp']:>6}")
        print(f"    HP:   {c['hp']:>4} / {c['maxHP']:<4}   MP: {c['mp']:>4} / {c['maxMP']:<4}")
        print(f"    攻击: {c['attack']:>4}    防御: {c['defend']:>4}    速度: {c['speed']:>4}")
        print(f"    灵力: {c['lingli']:>4}    运气: {c['luck']:>4}")

    if not changes:
        print("\n─" * 50)
        print("用法示例:")
        print("  python3 tools/change_stat.py save.json 柳清风:50          # 改等级")
        print("  python3 tools/change_stat.py save.json 柳清风:exp=9999    # 改经验")
        print("  python3 tools/change_stat.py save.json 柳清风:hp=999      # 改当前HP")
        print(f"  可用属性: {', '.join(STATS.keys())}")
        return

    # 应用修改
    print("\n=== 修改属性 ===")
    new_data = data
    for name, stat_key, value in changes:
        new_data = set_stat(new_data, name, stat_key, value, chars)

    if new_data == data:
        print("\n没有发生变化。")
        return

    # 保存
    if in_place:
        out_path = save_path
        print(f"\n⚠ 直接覆盖原文件: {save_path}")
    else:
        base, ext = os.path.splitext(save_path)
        out_path = f"{base}-modified{ext}"
        print(f"\n保存到新文件: {out_path}")

    save["data"] = new_data
    save["exportedAt"] = None
    with open(out_path, "w") as f:
        json.dump(save, f, ensure_ascii=False, separators=(",", ":"))
    print("完成！")


if __name__ == "__main__":
    main()
