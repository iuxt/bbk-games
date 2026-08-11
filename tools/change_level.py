#!/usr/bin/env python3
"""修改伏魔记存档中角色等级的工具。

用法:
  # 查看存档中的角色和等级
  python3 tools/change_level.py bbk-伏魔记-正式版-save-1.json

  # 修改等级（生成新文件，不覆盖原文件）
  python3 tools/change_level.py bbk-伏魔记-正式版-save-1.json 柳清风:50 慕容小梅:45 袁萍芷:40

  # 直接覆盖原文件
  python3 tools/change_level.py bbk-伏魔记-正式版-save-1.json 柳清风:99 --in-place
"""

import json
import sys
import os


def find_characters(data: str) -> list[dict]:
    """在 hex 数据中定位所有角色名字和等级"""
    raw = bytes.fromhex(data)
    results = []
    i = 0
    while i < len(raw):
        if 0xA1 <= raw[i] <= 0xF7 and i + 1 < len(raw) and raw[i + 1] >= 0xA1:
            start = i
            chars = []
            while i < len(raw) and 0xA1 <= raw[i] <= 0xF7 and i + 1 < len(raw) and raw[i + 1] >= 0xA1:
                chars.append(raw[i : i + 2])
                i += 2
            if len(chars) >= 2:
                try:
                    text = b"".join(chars).decode("gb2312")
                    if start >= 2:
                        name_len = raw[start - 2] | (raw[start - 1] << 8)
                        if name_len == len(chars) * 2:
                            level_off = start + len(chars) * 2
                            if level_off + 1 < len(raw):
                                level = raw[level_off] | (raw[level_off + 1] << 8)
                                if 1 <= level <= 99:
                                    results.append({
                                        "name": text,
                                        "hex_pos": level_off * 2,
                                        "level": level,
                                    })
                except Exception:
                    pass
        else:
            i += 1
    return results


def set_level(data: str, name: str, new_level: int) -> str:
    """修改指定角色的等级，返回新的 hex 字符串"""
    chars = find_characters(data)
    for c in chars:
        if c["name"] == name:
            pos = c["hex_pos"]
            new_hex = f"{new_level:02X}00"
            print(f"  {name}: Level {c['level']} → {new_level} (hex: {data[pos:pos+4]} → {new_hex})")
            return data[:pos] + new_hex + data[pos + 4 :]
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

    # 检测是否有修改指令
    changes = []
    in_place = False
    for arg in sys.argv[2:]:
        if arg == "--in-place":
            in_place = True
        elif ":" in arg:
            name, level_str = arg.split(":", 1)
            changes.append((name, int(level_str)))

    # 显示当前状态
    chars = find_characters(data)
    print("=== 当前存档角色 ===")
    for c in chars:
        print(f"  {c['name']}: Level {c['level']} (hex position {c['hex_pos']})")

    if not changes:
        print("\n用法: 在命令行中加入 角色名:新等级 来修改")
        print("例如: python3 tools/change_level.py save.json 柳清风:50 慕容小梅:45")
        return

    # 应用修改
    print("\n=== 修改等级 ===")
    new_data = data
    for name, level in changes:
        if not 1 <= level <= 99:
            print(f"  ⚠ 等级 {level} 不合理，必须在 1-99 之间，跳过 {name}")
            continue
        new_data = set_level(new_data, name, level)

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
    save["exportedAt"] = None  # 标记为已修改
    with open(out_path, "w") as f:
        json.dump(save, f, ensure_ascii=False, separators=(",", ":"))
    print("完成！")


if __name__ == "__main__":
    main()
