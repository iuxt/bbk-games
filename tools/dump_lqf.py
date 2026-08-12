#!/usr/bin/env python3
"""Dump 柳清风的 magicChain / levelupChain 数据，用于排查"36级只剩妙手空空"bug。

用法: python3 tools/dump_lqf.py [lib文件]
默认: rpg/roms/fmj_rpg.lib
"""
import sys, os

def parse_lib(path):
    with open(path, "rb") as f:
        buf = f.read()
    # 资源目录 @ 0x10, 偏移表 @ 0x2000
    offsets = {}  # (resType,type,index) -> file_offset
    i = 0x10
    j = 0x2000
    while i < len(buf) and buf[i] != 0xFF:
        resType = buf[i]; i += 1
        type_   = buf[i]; i += 1
        index   = buf[i]; i += 1
        block = buf[j]; j += 1
        low   = buf[j]; j += 1
        high  = buf[j]; j += 1
        value = (block * 0x4000) | ((high << 8) | low)
        offsets[(resType, type_, index)] = value
    return buf, offsets

def gbk_str(buf, start):
    i = 0
    while buf[start + i] != 0:
        i += 1
    try:
        return buf[start:start+i].decode("gbk")
    except Exception:
        return buf[start:start+i].decode("gbk", errors="replace")

def u16(buf, off):
    return buf[off] | (buf[off+1] << 8)

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "rpg/roms/fmj_rpg.lib"
    buf, off = parse_lib(path)
    print(f"=== {path}  资源数={len(off)} ===\n")

    # 找所有 Player (ARS=3, type=1)
    players = sorted([(k,v) for k,v in off.items() if k[0]==3 and k[1]==1], key=lambda x: x[0][2])
    lqf = None
    print("=== Player 列表 (ARS type=1) ===")
    for (rt, tp, idx), v in players:
        name = gbk_str(buf, v + 0x0a)
        magicChainId = buf[v + 0x17]
        level = buf[v + 0x20]
        print(f"  idx={idx:3d}  name={name!r:12}  level={level:3d}  magicChainId={magicChainId}")
        if "柳清风" in name:
            lqf = (idx, v, magicChainId, name)

    if not lqf:
        print("\n⚠ 未找到柳清风")
        return

    idx, pv, mc_id, name = lqf
    print(f"\n=== 柳清风  idx={idx}  magicChainId={mc_id} ===")

    # magicChain (MLR=12, type=1, index=mc_id)
    mc_off = off.get((12, 1, mc_id))
    if mc_off is None:
        print(f"⚠ 找不到 magicChain (12,1,{mc_id})")
    else:
        magic_sum = buf[mc_off + 2]
        print(f"\n--- magicChain @ 0x{mc_off:x}  magicSum={magic_sum} ---")
        p = mc_off + 3
        for k in range(magic_sum):
            mt = buf[p]; mi = buf[p+1]; p += 2
            # 尝试读法术名 (MRS=4)
            mname = ""
            mres = off.get((4, mt, mi))
            if mres is not None:
                # BaseMagic.setData: 名字通常在 type,index 之后的 gbk 串，扫一下
                # 先试 offset+2 (跳过 type,index)
                try:
                    mname = gbk_str(buf, mres + 2)
                except Exception:
                    mname = ""
            print(f"  [{k}] MRS type={mt} index={mi}  name={mname!r}")

    # levelupChain (MLR=12, type=2, index=idx)
    lc_off = off.get((12, 2, idx))
    if lc_off is None:
        print(f"\n⚠ 找不到 levelupChain (12,2,{idx})")
        return
    max_level = buf[lc_off + 2]
    data = lc_off + 4
    print(f"\n--- levelupChain @ 0x{lc_off:x}  maxLevel={max_level}  (每级20字节) ---")
    print("  级 | maxHP maxMP  Atk  Def  Speed Lgli Luck #Magic(累计)  nextExp")
    prev_magic = None
    for lv in range(1, max_level+1):
        b = data + (lv-1)*20
        maxhp = u16(buf, b+0); hp=u16(buf,b+2); maxmp=u16(buf,b+4); mp=u16(buf,b+6)
        atk = u16(buf, b+8); def_=u16(buf, b+10)
        # b+12,13 未知; nextExp @ b+14
        nxt = u16(buf, b+14)
        speed=buf[b+16]; lgli=buf[b+17]; luck=buf[b+18]; magic=buf[b+19]
        flag = ""
        if prev_magic is not None and magic < prev_magic:
            flag = "  <<< 法术数倒退！"
        if lv >= 33 or (prev_magic is not None and magic != prev_magic):
            mark = " *" if lv == 36 else ""
            print(f"  {lv:3d} | {maxhp:5d} {maxmp:5d} {atk:4d} {def_:4d} {speed:4d} {lgli:4d} {luck:4d}  magic={magic:3d}{flag}{mark}")
        prev_magic = magic

if __name__ == "__main__":
    main()
