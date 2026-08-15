# RPG Skill Damage Floor Design

## Problem

The default simplified RPG magic-damage formula scales a skill's base HP and MP damage by `(caster.lingli - target.lingli) / 100`. When a target has higher spirit power than the caster, the negative multiplier can reduce an attack skill far below its ROM-authored base damage.

## Design

In the simplified damage branch only, clamp the spirit-power difference used for attack skills at zero before calculating the bonus:

```text
bonus rate = max(caster.lingli - target.lingli, 0) / 100
damage = base damage + trunc(base damage * bonus rate)
```

This keeps the existing advantage scaling when the caster has higher spirit power, while preventing higher-spirit targets from reducing damage below the skill's authored base value. The HP and MP attack-damage paths use the same rule.

The original-formula setting, absorb/level-scaling logic, magic costs, misses, buffs, and unrelated combat formulas remain unchanged. Startup also uses the intended simplified-formula default when no stored setting exists: `initialize()` must pass `"false"` as the fallback for `useOriginalDamageFormula`. A stored explicit choice continues to override the default.

## Testing

Add Node regression coverage that executes the simplified `MagicAttack` HP and MP damage calculations with equal, lower, and higher caster spirit power. Assertions should verify:

- Equal spirit power produces the authored base damage.
- Higher caster spirit power still increases damage by the existing 1%-per-point rate.
- Higher target spirit power no longer reduces damage below the base value.
- The original damage-formula branch is not selected by the tests.
- With no stored setting, `GameSettings.initialize()` selects the simplified formula; with a stored setting, it preserves that explicit choice.
